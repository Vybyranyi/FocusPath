import { z } from 'zod';
import { MAX_JOURNAL_TEXT } from '@models/JournalEntry';

/**
 * A day as it travels on the wire. Kept a string — route params are typed as
 * strings throughout, and a coerced `Date` would be one more place for a local
 * midnight to sneak in. The service turns it into a day itself.
 */
export const dayKey = z
    .string('A day is required')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a day as YYYY-MM-DD')
    .refine(value => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'Must be a real day');

export const journalDayParamsSchema = z.object({ day: dayKey });
export type JournalDayParams = z.infer<typeof journalDayParamsSchema>;

/**
 * What a day's entry holds. Every field is optional, and it *replaces* the
 * entry: a field left out is removed, which is how someone takes back a mood.
 */
export const putJournalSchema = z.object({
    mood: z.number().int('Mood must be a whole number').min(1, 'Mood runs from 1 to 5').max(5, 'Mood runs from 1 to 5').optional(),
    energy: z.number().int('Energy must be a whole number').min(1, 'Energy runs from 1 to 5').max(5, 'Energy runs from 1 to 5').optional(),
    text: z.string().trim().max(MAX_JOURNAL_TEXT, `Must be ${MAX_JOURNAL_TEXT} characters or fewer`).optional(),
});
export type PutJournalDto = z.infer<typeof putJournalSchema>;

/** Checked but not coerced — Express 5 will not take a rewritten `req.query`. */
export const journalRangeQuerySchema = z.object({ from: dayKey, to: dayKey });

/** The most days one request may read; about a quarter. */
export const MAX_JOURNAL_RANGE_DAYS = 92;
