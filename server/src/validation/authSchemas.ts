import { z } from 'zod';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '@utils/password';
import { validateAvatar } from '@utils/avatar';

/**
 * Requiring a string here is what actually closes NoSQL injection: an operator
 * object such as {"$ne": null} fails the type check long before it can reach a
 * query. sanitizeFilter remains as a second line, not the first.
 */
// Trimmed before the format check, not after: z.email().trim() would reject a
// perfectly good address that arrived with a trailing space, and no form on the
// client trims for us.
//
// Folded to lower case for the same reason it is trimmed — the domain is
// case-insensitive and mailboxes in practice are too, so `Ann@example.com` and
// `ann@example.com` are one address. Storing them as written made them two
// accounts that the unique index had no reason to object to, let someone claim a
// case variant of an address already in use, and locked out anyone who signed up
// with a capital and later typed their address in lower case.
const email = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Must be a valid email address'));

const password = z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`)
    .refine(
        value => Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES,
        // bcrypt discards anything past this, which would make two different
        // long passwords authenticate one another.
        `Password must not exceed ${MAX_PASSWORD_BYTES} bytes`,
    );

const name = z.string().trim().min(1, 'Required').max(50, 'Must be 50 characters or fewer');

/** Reuses the size and MIME rules so there is one definition of a valid avatar. */
const avatar = z.string().superRefine((value, ctx) => {
    const problem = validateAvatar(value);
    if (problem) {
        ctx.addIssue({ code: 'custom', message: problem });
    }
});

export const registerSchema = z.object({
    name,
    surname: name,
    birthday: z.coerce.date('Must be a valid date'),
    gender: z.enum(['male', 'female']),
    email,
    password,
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
    // Deliberately not the strict email format: an existing account should get
    // "invalid credentials", not a lecture about its address. Lower-cased all
    // the same, or an address stored by the rule above would not be found by
    // someone typing it with a capital.
    email: z.string('Email is required').trim().toLowerCase().min(1, 'Email is required'),
    password: z.string('Password is required').min(1, 'Password is required'),
});
export type LoginDto = z.infer<typeof loginSchema>;

/**
 * What the request may actually change. `currentPassword` travels alongside them
 * but is not one of them, so it is listed apart: it must not be the sole content
 * of an update, and the service strips it rather than writing it to the document.
 */
const PROFILE_FIELDS = ['name', 'surname', 'birthday', 'gender', 'email', 'avatar', 'preferences'] as const;

export const updateProfileSchema = z
    .object({
        name: name.optional(),
        surname: name.optional(),
        birthday: z.coerce.date('Must be a valid date').optional(),
        gender: z.enum(['male', 'female']).optional(),
        email: email.optional(),
        avatar: avatar.optional(),
        /** Settings, each optional: only what is sent changes. */
        preferences: z
            .object({
                askFailureReason: z.boolean().optional(),
                coachLanguage: z
                    .string()
                    .trim()
                    .toLowerCase()
                    .regex(/^[a-z]{2}$/, 'Must be a two-letter language code')
                    .optional(),
                coachReadsNotes: z.boolean().optional(),
            })
            .optional(),
        /**
         * Required only to move the address, and only the service can tell
         * whether it is moving — it needs the stored one to compare against.
         */
        currentPassword: z.string().min(1, 'Current password is required').optional(),
    })
    .refine(
        body => PROFILE_FIELDS.some(field => body[field] !== undefined),
        'Provide at least one field to update',
    );
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const deleteAccountSchema = z.object({
    password: z.string('Password is required').min(1, 'Password is required'),
});
export type DeleteAccountDto = z.infer<typeof deleteAccountSchema>;

export const changePasswordSchema = z.object({
    currentPassword: z.string('Current password is required').min(1, 'Current password is required'),
    newPassword: password,
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

/**
 * Asking for a reset link. The address is held to the same rules as at
 * registration, so `Ann@Example.com ` finds the account stored as
 * `ann@example.com`.
 */
export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
    // Only its shape is checked here; whether it is a live token is the
    // service's question, answered by hashing it.
    token: z.string('Reset token is required').trim().min(1, 'Reset token is required').max(200),
    newPassword: password,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
