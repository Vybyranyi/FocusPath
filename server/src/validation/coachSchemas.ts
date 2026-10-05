import { z } from 'zod';
import { objectId } from '@validation/common';

export const cardParamsSchema = z.object({ id: objectId('card ID') });
export type CardParams = z.infer<typeof cardParamsSchema>;

/**
 * Checked but not coerced — Express 5 will not take a rewritten `req.query`, so
 * the handler reads the strings and parses them itself.
 */
export const cardsQuerySchema = z.object({
    limit: z.string().regex(/^\d+$/, 'Limit must be a whole number').optional(),
    before: z
        .string()
        .refine(value => !Number.isNaN(Date.parse(value)), 'Must be a valid date')
        .optional(),
});

export const DEFAULT_CARDS = 20;
export const MAX_CARDS = 50;

export const feedbackSchema = z.object({ helpful: z.boolean('Helpful must be true or false') });
export type FeedbackDto = z.infer<typeof feedbackSchema>;
