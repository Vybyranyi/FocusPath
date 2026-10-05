import mongoose, { Document, Schema } from 'mongoose';
import type { User, UserPreferences } from '@shared/index';

/**
 * The stored user. Field names and unions come from the shared `User` contract
 * so the two cannot drift; only the storage-level differences are restated here
 * — dates are `Date` in Mongo, and the password hash exists solely on this side.
 */
export interface IUser
    extends Document,
    Omit<User, '_id' | 'birthday' | 'preferences' | 'createdAt' | 'updatedAt'> {
    birthday: Date;
    password: string;
    /**
     * Bumped to invalidate every refresh token issued so far. Changing a
     * password raises it, which ends other sessions instead of leaving them
     * live for the rest of the token's lifetime.
     */
    tokenVersion: number;
    /**
     * Ids of the refresh tokens currently accepted, one per signed-in device.
     * Rotation replaces an entry; logout removes one; changing a password
     * empties the list. Without this, "rotation" would only mean issuing a new
     * token while the old one stayed just as valid.
     */
    refreshSessions: string[];
    /**
     * SHA-256 of the one outstanding password-reset token, never the token
     * itself — the database is not a place a working reset link should be
     * readable from. Cleared on use, and replaced by any newer request.
     */
    passwordResetHash?: string;
    passwordResetExpires?: Date;
    preferences: UserPreferences;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema: Schema = new Schema({
    name: { type: String, required: true },
    surname: { type: String, required: true },
    birthday: { type: Date, required: true },
    gender: { type: String, enum: ["male", "female"], required: true },
    // Normalised here as well as in the schemas, because the unique index is what
    // ultimately decides whether two rows are the same address, and not every
    // write goes through a Zod schema — seedAdmin does not.
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    // Excluded from every query by default. The two places that genuinely need
    // it — signing in and changing a password — ask for it with .select('+password').
    password: { type: String, required: true, minlength: 8, select: false },
    avatar: { type: String, required: false },
    // Not a secret, so it stays in the response. It is also not something a
    // request may set: `updateProfileSchema` is a whitelist and does not list
    // it, which makes the protection structural rather than a check to forget.
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Absent means anonymous, which is the default for everyone. Only shown on
    // a published plan, and only because its author asked for it.
    displayName: { type: String, required: false, trim: true, maxlength: 30 },
    tokenVersion: { type: Number, default: 0 },
    refreshSessions: { type: [String], default: [], select: false },
    passwordResetHash: { type: String, select: false, index: { sparse: true } },
    passwordResetExpires: { type: Date, select: false },
    preferences: {
        // Asked by default: the moment of a lapse is the one moment the reason is
        // known, and someone who never sees the question can never answer it.
        askFailureReason: { type: Boolean, default: true },
    },
}, { timestamps: true });

// Strips the hash on the way out so no controller has to remember to, and drops
// __v, which the client has no use for.
UserSchema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.password;
        delete ret.tokenVersion;
        delete ret.refreshSessions;
        delete ret.passwordResetHash;
        delete ret.passwordResetExpires;
        delete ret.__v;
        return ret;
    },
});

const User = mongoose.model<IUser>('User', UserSchema);

export default User;