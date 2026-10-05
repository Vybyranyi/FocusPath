import { createHash, randomBytes } from 'crypto';
import User, { type IUser } from '@models/User';
import Habit from '@models/Habit';
import HabitDay from '@models/HabitDay';
import CoachCard from '@models/CoachCard';
import JournalEntry from '@models/JournalEntry';
import { groupByHabit, presentExport, type LoggedDay } from '@services/habitView';
import { toDayNumber } from '@services/habitTimeline';
import Plan from '@models/Plan';
import { hashPassword, placeholderHash, verifyPassword } from '@utils/password';
import { createSessionId, verifyRefreshToken } from '@utils/tokens';
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
} from '@errors/AppError';
import { logger } from '@config/logger';
import { sendMail } from '@services/mailService';
import type {
    ChangePasswordDto,
    DeleteAccountDto,
    ForgotPasswordDto,
    LoginDto,
    RegisterDto,
    ResetPasswordDto,
    UpdateProfileDto,
} from '@validation/authSchemas';

/** Everything the caller needs to put a session on the response. */
export interface Session {
    user: IUser;
    tokenVersion: number;
    sessionId: string;
}

/** How many devices may stay signed in at once; the oldest falls off beyond this. */
const MAX_SESSIONS = 10;

const requireUser = async (userId: string | undefined, fields: string[] = []): Promise<IUser> => {
    const query = User.findById(userId);
    if (fields.length) {
        // password and refreshSessions are select:false, so they must be asked for.
        query.select(fields.map(field => `+${field}`).join(' '));
    }

    const user = await query;
    if (!user) {
        throw new NotFoundError('User not found');
    }
    return user;
};

const startSession = async (user: IUser): Promise<Session> => {
    const sessionId = createSessionId();

    user.refreshSessions = [...(user.refreshSessions ?? []), sessionId].slice(-MAX_SESSIONS);
    await user.save();

    return { user, tokenVersion: user.tokenVersion, sessionId };
};

export const register = async (dto: RegisterDto): Promise<Session> => {
    const existing = await User.findOne({ email: dto.email });
    if (existing) {
        throw new ConflictError('User already exists');
    }

    const user = await User.create({
        ...dto,
        password: await hashPassword(dto.password),
    });

    return startSession(user);
};

/**
 * One answer for "no account here" and "wrong password", and the same work done
 * either way.
 *
 * Telling the two apart is a membership oracle for any address someone cares to
 * type in: it used to be a 404 against a 400, and it would have remained a
 * timing difference even once the replies matched, because the miss returned
 * before bcrypt ran. So the comparison always happens — against the placeholder
 * hash when there is no user to compare with.
 */
export const login = async ({ email, password }: LoginDto): Promise<Session> => {
    const user = await User.findOne({ email }).select('+password +refreshSessions');

    const correct = await verifyPassword(password, user?.password ?? (await placeholderHash()));
    if (!user || !correct) {
        throw new UnauthorizedError('Invalid email or password');
    }

    return startSession(user);
};

/**
 * Exchanges a refresh token for a fresh session.
 *
 * The presented session id must still be on the user's list, and is taken off
 * it as the new one goes on. That is what makes rotation mean something: a
 * token cannot be spent twice, and a stolen one stops working the moment the
 * real client next refreshes.
 *
 * The version is checked too, so raising it — as a password change does —
 * retires every session at once.
 */
export const refreshSession = async (token: string | undefined): Promise<Session> => {
    if (!token) {
        throw new UnauthorizedError('Not authenticated');
    }

    const { userId, version, sessionId } = verifyRefreshToken(token);

    const user = await User.findById(userId).select('+refreshSessions');
    if (!user || version !== user.tokenVersion) {
        throw new UnauthorizedError('Session is no longer valid');
    }

    if (!user.refreshSessions?.includes(sessionId)) {
        throw new UnauthorizedError('Session is no longer valid');
    }

    const rotated = createSessionId();
    user.refreshSessions = [
        ...user.refreshSessions.filter(id => id !== sessionId),
        rotated,
    ].slice(-MAX_SESSIONS);
    await user.save();

    return { user, tokenVersion: user.tokenVersion, sessionId: rotated };
};

/** Ends one device's session, leaving any others signed in. */
export const endSession = async (token: string | undefined): Promise<void> => {
    if (!token) {
        return;
    }

    let claims;
    try {
        claims = verifyRefreshToken(token);
    } catch {
        // An unreadable token has nothing to revoke; the cookies still get cleared.
        return;
    }

    await User.findByIdAndUpdate(claims.userId, {
        $pull: { refreshSessions: claims.sessionId },
    });
};

export const getProfile = (userId: string | undefined): Promise<IUser> => requireUser(userId);

export const updateProfile = async (
    userId: string | undefined,
    { currentPassword, preferences, ...profile }: UpdateProfileDto,
): Promise<IUser> => {
    // A preference is set by its own path, so changing one never replaces its
    // siblings — the object it lives in will hold more of them.
    const changes: Record<string, unknown> & Pick<UpdateProfileDto, 'email'> = { ...profile };
    for (const [key, value] of Object.entries(preferences ?? {})) {
        if (value !== undefined) changes[`preferences.${key}`] = value;
    }

    const user = await requireUser(userId, ['password']);

    /**
     * Only a real move counts. The profile form posts every field it knows, so
     * the address also arrives on a rename and on an avatar upload, and keying
     * off its mere presence would ask for a password on every edit.
     *
     * Compared against the stored address folded to lower case: schemas
     * normalise what arrives, but a row written before they did may still hold
     * mixed case, and that is not the user changing anything.
     */
    const movesEmail =
        changes.email !== undefined && changes.email !== user.email.toLowerCase();

    if (movesEmail) {
        // The rule changing a password and deleting the account already follow:
        // a session on its own must not be enough. The address is what the
        // account is known by, and every future recovery path will run through
        // it, so taking it over cannot be cheaper than either of those.
        if (!currentPassword) {
            const message = 'Current password is required to change your email address';
            throw new ValidationError(message, { currentPassword: [message] });
        }

        if (!(await verifyPassword(currentPassword, user.password))) {
            throw new BadRequestError('Current password is incorrect', {
                currentPassword: ['Current password is incorrect'],
            });
        }

        /**
         * Fetched by address and compared here rather than asked for with
         * `_id: { $ne: userId }`.
         *
         * `sanitizeFilter` is on mongoose-wide, and it wraps any value whose keys
         * all begin with `$` in `$eq` — it cannot tell an operator this code
         * meant from one that arrived in a request body. So that filter became
         * `_id: { $eq: { $ne: userId } }`, which cannot cast to an ObjectId, and
         * every profile save carrying an address answered 400 `Invalid value for
         * '_id'`. The client sends the whole form, address included, so that was
         * every save and every avatar upload.
         *
         * `mongoose.trusted()` would also work, at the cost of opting a query out
         * of the protection. Not needing an operator at all is better.
         */
        const holder = await User.findOne({ email: changes.email });
        if (holder && holder.id !== userId) {
            throw new ConflictError('Email already in use');
        }
    }

    // Safe to apply wholesale: the schema allows only profile fields and has
    // already dropped anything else the request carried, and `currentPassword`
    // — the one field that is not a profile field — is destructured away above.
    const updated = await User.findByIdAndUpdate(userId, changes, {
        new: true,
        runValidators: true,
    });

    if (!updated) {
        throw new NotFoundError('User not found');
    }

    return updated;
};

/**
 * Changing a password ends every session, on every device. The caller gets a
 * new one in return, so the person doing it is not signed out of the device
 * they are holding.
 */
export const changePassword = async (
    userId: string | undefined,
    { currentPassword, newPassword }: ChangePasswordDto,
): Promise<Session> => {
    const user = await requireUser(userId, ['password', 'refreshSessions']);

    if (!(await verifyPassword(currentPassword, user.password))) {
        throw new BadRequestError('Current password is incorrect');
    }

    user.password = await hashPassword(newPassword);
    user.tokenVersion += 1;
    user.refreshSessions = [];
    // A reset link still in someone's inbox would otherwise undo this change.
    user.passwordResetHash = undefined;
    user.passwordResetExpires = undefined;

    return startSession(user);
};

/**
 * Everything the account holds, in one document the person can keep.
 *
 * Deleting an account removes all of it, and until now there was no way to
 * take any of it along first — months of history could be kept only by not
 * leaving. The same `toJSON` that shapes every response shapes this, so
 * nothing is exported that the account's own screens would not show.
 */
export const exportAccount = async (userId: string | undefined) => {
    const user = await requireUser(userId);
    const [habits, logs, journal, coachCards, plans] = await Promise.all([
        Habit.find({ userId }).sort({ createdAt: 1 }),
        HabitDay.find({ userId }).lean<LoggedDay[]>(),
        JournalEntry.find({ userId }).sort({ day: 1 }),
        CoachCard.find({ userId }).sort({ createdAt: 1 }),
        Plan.find({ 'author.userId': userId }).sort({ createdAt: 1 }),
    ]);

    // Each habit carries its programme and every day that was logged on it —
    // the history is the part of an account that cannot be rebuilt.
    const byHabit = groupByHabit(logs);
    const today = toDayNumber(new Date());

    return {
        exportedAt: new Date().toISOString(),
        user,
        habits: habits.map(habit => presentExport(habit, byHabit.get(String(habit._id)) ?? [], today)),
        journal,
        coachCards,
        plans,
    };
};

/** How long a reset link works. Long enough to find the mail, short enough to go stale. */
export const RESET_TTL_MS = 30 * 60 * 1000;

const hashResetToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Where links in mail point.
 *
 * Deliberately never built from the request. The `Host` header is whatever the
 * sender typed, so a reset requested with `Host: evil.example` would mail the
 * account's owner a working token on the attacker's site — the classic reset
 * poisoning. Outside production it falls back to the first allowed origin,
 * which is the Vite dev server; in production it must be configured.
 */
const appUrl = (): string | null => {
    const configured =
        process.env.APP_URL ??
        (process.env.NODE_ENV === 'production'
            ? undefined
            : process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173');
    return configured ? configured.replace(/\/+$/, '') : null;
};

/**
 * Mails a reset link, if there is an account to reset.
 *
 * The reply is the same either way — the handler answers 200 regardless — so
 * this cannot be used to learn which addresses have accounts, the same rule
 * `login` follows. The mail is sent without being awaited for the same reason:
 * an SMTP round trip on only the "exists" path would be a timing tell.
 *
 * The token travels in the link's fragment (`#token=`), not its query. A
 * fragment is never sent to a server and never appears in a Referer, so the
 * reset page can load images from a CDN without handing the token to it.
 */
export const requestPasswordReset = async ({ email }: ForgotPasswordDto): Promise<void> => {
    const user = await User.findOne({ email });
    if (!user) return;

    const base = appUrl();
    if (!base) {
        logger.error('Password reset requested but APP_URL is not configured');
        return;
    }

    const token = randomBytes(32).toString('base64url');

    // An update rather than a save: the document was loaded without its
    // unselected fields, and this touches only the two it needs.
    await User.updateOne(
        { _id: user._id },
        {
            $set: {
                passwordResetHash: hashResetToken(token),
                passwordResetExpires: new Date(Date.now() + RESET_TTL_MS),
            },
        },
    );

    void sendMail({
        to: user.email,
        subject: 'Reset your FocusPath password',
        text: [
            `Hi ${user.name},`,
            '',
            'Someone asked to reset the password for your FocusPath account.',
            `If it was you, open this link within ${RESET_TTL_MS / 60_000} minutes to choose a new one:`,
            '',
            `${base}/reset-password#token=${token}`,
            '',
            'If it was not you, ignore this message — your password stays as it is.',
        ].join('\n'),
    }).catch(error => logger.error({ err: error }, 'Failed to send password reset mail'));
};

/**
 * Sets a new password from a reset link, and signs the person in.
 *
 * Looked up by the token's hash, with the expiry compared here rather than in
 * the query: `sanitizeFilter` would wrap a `$gt` written in this file exactly
 * as it wraps one arriving in a body, and the lookup would never match.
 *
 * Everything a password change does happens here too. Every other session
 * ends, because a reset is what someone does when they think an account is not
 * only theirs any more.
 */
export const resetPassword = async ({ token, newPassword }: ResetPasswordDto): Promise<Session> => {
    const user = await User.findOne({ passwordResetHash: hashResetToken(token) }).select(
        '+password +refreshSessions +passwordResetExpires',
    );

    if (!user || !user.passwordResetExpires || user.passwordResetExpires.getTime() < Date.now()) {
        throw new BadRequestError('This reset link is invalid or has expired');
    }

    user.password = await hashPassword(newPassword);
    user.tokenVersion += 1;
    user.refreshSessions = [];
    user.passwordResetHash = undefined;
    user.passwordResetExpires = undefined;

    return startSession(user);
};

/**
 * Removes the account and everything belonging to it, after proving the person
 * asking knows the password — a stolen session should not be able to do this.
 */
export const deleteAccount = async (
    userId: string | undefined,
    { password }: DeleteAccountDto,
): Promise<void> => {
    const user = await requireUser(userId, ['password']);

    if (!(await verifyPassword(password, user.password))) {
        throw new BadRequestError('Password is incorrect');
    }

    // Plans leave the library with their author. They used to stay published,
    // signed with the display name of someone who had asked for everything of
    // theirs to be removed. Withdrawn rather than deleted: the habits other
    // people took from them keep their `fromPlanId`, and moderation keeps its
    // record — but nothing of this person stays public, and nothing names them.
    await Plan.updateMany(
        { 'author.userId': userId },
        { $set: { status: 'unpublished' }, $unset: { 'author.displayName': '' } },
    );
    await Habit.deleteMany({ userId });
    await HabitDay.deleteMany({ userId });
    // The most private thing the account holds: gone with it, not softly.
    await JournalEntry.deleteMany({ userId });
    // Built from that journal, so they go with it.
    await CoachCard.deleteMany({ userId });
    await User.findByIdAndDelete(userId);
};
