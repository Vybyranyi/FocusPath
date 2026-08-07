import mongoose from 'mongoose';
import { z } from 'zod';
import { DAY_STATUSES } from '@models/Habit';

const objectId = (label: string) =>
    z.string().refine(value => mongoose.Types.ObjectId.isValid(value), `Invalid ${label}`);

export const habitParamsSchema = z.object({ id: objectId('habit ID') });
export type HabitParams = z.infer<typeof habitParamsSchema>;

export const stepParamsSchema = z.object({
    id: objectId('habit ID'),
    stepId: objectId('step ID'),
});
export type StepParams = z.infer<typeof stepParamsSchema>;

const title = z.string().trim().min(1, 'Required').max(100, 'Must be 100 characters or fewer');
const duration = z
    .number('Duration must be a number')
    .int('Duration must be a whole number of days')
    .min(1, 'Duration must be between 1 and 365 days')
    .max(365, 'Duration must be between 1 and 365 days');

const habitType = z.enum(['build', 'quit'], 'Type must be either "build" or "quit"');

const steps = z.array(
    z.object({
        title: z.string().trim().min(1, 'Step title is required'),
        completed: z.boolean().default(false),
    }),
);

/**
 * Compared at day granularity in UTC, matching how the schedule is generated,
 * with one day of slack.
 *
 * The slack is not sloppiness: the client sends the calendar day it is on, and
 * that day can trail the server's UTC day by one. A user in UTC−5 at 20:00 is
 * still on the 7th while the server has already turned over to the 8th, and a
 * strict comparison told them their own today was in the past.
 */
const isNotInPast = (date: Date): boolean => {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const earliest = new Date();
    earliest.setUTCHours(0, 0, 0, 0);
    earliest.setUTCDate(earliest.getUTCDate() - 1);
    return start.getTime() >= earliest.getTime();
};

const startDate = z.coerce
    .date('Must be a valid date')
    .refine(isNotInPast, 'Start date cannot be in the past');

export const createHabitSchema = z.object({
    title,
    description: z.string().trim().max(500, 'Must be 500 characters or fewer').optional(),
    category: z.string().trim().max(50, 'Must be 50 characters or fewer').optional(),
    steps: steps.optional(),
    startDate,
    duration,
    type: habitType,
    color: z.string().trim().min(1, 'Required'),
    icon: z.string().trim().min(1, 'Required'),
});
export type CreateHabitDto = z.infer<typeof createHabitSchema>;

export const createAIHabitSchema = z.object({
    title,
    startDate,
    // Absent, null or zero all mean "let the model choose the length".
    duration: duration.nullish(),
    type: habitType,
    color: z.string().trim().min(1, 'Required'),
    icon: z.string().trim().min(1, 'Required'),
});
export type CreateAIHabitDto = z.infer<typeof createAIHabitSchema>;

export const updateHabitSchema = z
    .object({
        title: title.optional(),
        description: z.string().trim().max(500).optional(),
        category: z.string().trim().max(50).optional(),
        steps: steps.optional(),
        // No not-in-past rule here: an existing habit may legitimately have
        // started before today, and rescheduling one is not creating one.
        startDate: z.coerce.date('Must be a valid date').optional(),
        duration: duration.optional(),
        type: habitType.optional(),
        color: z.string().trim().min(1).optional(),
        icon: z.string().trim().min(1).optional(),
    })
    .refine(
        body => Object.values(body).some(value => value !== undefined),
        'Provide at least one field to update',
    );
export type UpdateHabitDto = z.infer<typeof updateHabitSchema>;

export const markCompletionSchema = z.object({
    date: z.coerce.date('Must be a valid date').optional(),
    status: z.enum(
        DAY_STATUSES,
        'Status must be one of "pending", "done" or "failed"',
    ),
});
export type MarkCompletionDto = z.infer<typeof markCompletionSchema>;

export const updateDayTitleSchema = z.object({
    date: z.coerce.date('Must be a valid date'),
    dayTitle: z.string().trim().min(1, 'Day title is required').max(200),
});
export type UpdateDayTitleDto = z.infer<typeof updateDayTitleSchema>;

/**
 * Checked but not coerced — Express 5 will not accept a rewritten req.query, so
 * the handler reads the original string and parses it itself.
 */
export const habitsForDateQuerySchema = z.object({
    date: z.coerce.date('Must be a valid date').optional(),
});
