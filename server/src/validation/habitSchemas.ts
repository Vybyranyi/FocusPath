import { z } from 'zod';
import { TIMES_OF_DAY } from '@models/Habit';
import { MAX_DAY_VALUE, MAX_NOTE, MAX_REASON_TEXT, REASON_CODES } from '@models/HabitDay';
import { dayKey } from '@validation/journalSchemas';
import { objectId } from '@validation/common';

export const habitParamsSchema = z.object({ id: objectId('habit ID') });
export type HabitParams = z.infer<typeof habitParamsSchema>;

export const stepParamsSchema = z.object({
    id: objectId('habit ID'),
    stepId: objectId('step ID'),
});
export type StepParams = z.infer<typeof stepParamsSchema>;

const title = z.string().trim().min(1, 'Required').max(100, 'Must be 100 characters or fewer');
const sessions = z
    .number('Sessions must be a number')
    .int('Sessions must be a whole number')
    .min(1, 'Sessions must be between 1 and 365')
    .max(365, 'Sessions must be between 1 and 365');

/** A quantity with at most one decimal place, so "2.5 km" fits and 0.1 + 0.2 does not. */
const oneDecimal = (value: number): boolean => Math.round(value * 10) / 10 === value;

const frequency = z.discriminatedUnion(
    'kind',
    [
        z.object({ kind: z.literal('daily') }),
        z.object({
            kind: z.literal('weekdays'),
            days: z
                .array(z.number().int().min(1, 'Days run from 1 (Monday) to 7 (Sunday)').max(7, 'Days run from 1 (Monday) to 7 (Sunday)'))
                .min(1, 'Choose at least one day')
                .refine(days => new Set(days).size === days.length, 'Days must not repeat')
                .transform(days => [...days].sort((a, b) => a - b)),
        }),
        z.object({
            kind: z.literal('weekly'),
            times: z
                .number('Times must be a number')
                .int('Times must be a whole number')
                .min(1, 'Times per week must be between 1 and 7')
                .max(7, 'Times per week must be between 1 and 7'),
        }),
    ],
    'Frequency must be daily, weekdays or weekly',
);

const target = z.object({
    value: z
        .number('Target must be a number')
        .positive('Target must be greater than zero')
        .max(MAX_DAY_VALUE, `Target must be at most ${MAX_DAY_VALUE}`)
        .refine(oneDecimal, 'Target may have one decimal place at most'),
    unit: z.string().trim().min(1, 'Unit is required').max(20, 'Unit must be 20 characters or fewer'),
});

const timeOfDay = z.enum(TIMES_OF_DAY, 'Time of day must be morning, afternoon, evening or anytime');

/**
 * The client's own idea of today, as a day key. Only a day within one of the
 * server's is believed — see `resolveToday` — because a user west of Greenwich
 * is still on yesterday for hours after the server has turned over, and
 * "missed" must not be said of a day they are still living.
 */
const clientToday = z.coerce.date('Today must be a valid date').optional();

const habitType = z.enum(['build', 'quit'], 'Type must be either "build" or "quit"');

const MAX_STEPS = 20;

const stepTitle = z
    .string()
    .trim()
    .min(1, 'Step title is required')
    .max(100, 'Must be 100 characters or fewer');

/**
 * A habit's daily checklist, as titles only. Whether a step is done is a fact
 * about a day, recorded on the schedule — a `completed` flag here was what made
 * a step ticked once stay ticked for the rest of the run.
 *
 * Capped, like every other list a user can grow: an unbounded array is copied
 * into every response for this habit.
 */
const steps = z.array(z.object({ title: stepTitle })).max(MAX_STEPS, `At most ${MAX_STEPS} steps`);

/**
 * Steps as an edit sends them. An `_id` names a step that already exists, so
 * renaming it keeps the ticks made against it; a step without one is new.
 */
const editedSteps = z
    .array(z.object({ _id: objectId('step ID').optional(), title: stepTitle }))
    .max(MAX_STEPS, `At most ${MAX_STEPS} steps`);

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
    // Absent means the habit has no end.
    sessions: sessions.nullish(),
    frequency: frequency.default({ kind: 'daily' }),
    target: target.optional(),
    timeOfDay: timeOfDay.default('anytime'),
    type: habitType,
    color: z.string().trim().min(1, 'Required'),
    icon: z.string().trim().min(1, 'Required'),
});
export type CreateHabitDto = z.infer<typeof createHabitSchema>;

/**
 * Taking a plan from the library.
 *
 * Its own schema and its own endpoint rather than an optional `planId` on
 * `createHabitSchema`: that would turn the create schema into a union where
 * half the fields are conditionally required, and the type `z.infer` produces
 * from such a union is unusable — which defeats the whole point of the schema
 * being the single source of truth. `POST /habits/ai` is the same shape of
 * precedent, with its own schema and its own controller.
 *
 * The content is not in the body. Only the start date and the presentation may
 * be chosen; the title, the days and the length are read from the plan.
 */
export const createHabitFromPlanSchema = z.object({
    planId: objectId('plan ID'),
    startDate,
    // Allowed, but a clone whose length, rhythm or target differs no longer
    // matches the plan's content hash and so drops out of its completion
    // statistics. Someone who did 30 sessions of a 90-session plan did not walk
    // that plan.
    sessions: sessions.optional(),
    frequency: frequency.optional(),
    // `null` takes the plan's goal away; absent keeps it.
    target: target.nullable().optional(),
    color: z.string().trim().min(1).optional(),
    icon: z.string().trim().min(1).optional(),
});
export type CreateHabitFromPlanDto = z.infer<typeof createHabitFromPlanSchema>;

export const createAIHabitSchema = z.object({
    title,
    // Accepted here as well as on the manual route: the create form collects
    // both for either button, and a habit that arrives without a category has
    // nothing to offer the publish sheet later.
    description: z.string().trim().max(500, 'Must be 500 characters or fewer').optional(),
    category: z.string().trim().max(50, 'Must be 50 characters or fewer').optional(),
    steps: steps.optional(),
    startDate,
    // Absent, null or zero all mean "let the model choose the length". A habit
    // with no end cannot be asked for here: there is no plan to write for it.
    sessions: z.union([sessions, z.literal(0)]).nullish(),
    frequency: frequency.default({ kind: 'daily' }),
    target: target.optional(),
    timeOfDay: timeOfDay.default('anytime'),
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
        steps: editedSteps.optional(),
        // No not-in-past rule here: an existing habit may legitimately have
        // started before today, and rescheduling one is not creating one.
        startDate: z.coerce.date('Must be a valid date').optional(),
        // Lengthens or shortens a programme. A habit with no end cannot be given
        // one, nor a programme taken down to none — see `updateHabit`.
        sessions: sessions.optional(),
        // Either one starts a new rule today; the past keeps the rule it ran under.
        frequency: frequency.optional(),
        // `null` takes the target away.
        target: target.nullable().optional(),
        timeOfDay: timeOfDay.optional(),
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
    today: clientToday,
    status: z.enum(
        ['pending', 'done', 'failed'],
        'Status must be one of "pending", "done" or "failed"',
    ),
});
export type MarkCompletionDto = z.infer<typeof markCompletionSchema>;

/** Which day a step is being ticked on. A step is done on a day, not once and for all. */
export const toggleStepSchema = z.object({
    date: z.coerce.date('Must be a valid date'),
    today: clientToday,
});
export type ToggleStepDto = z.infer<typeof toggleStepSchema>;

/**
 * Renames a session of a programme. It is the session that is named, not a
 * calendar day: with pauses and rest days in the way, the two no longer line up.
 */
export const updateSessionTitleSchema = z.object({
    session: sessions,
    title: z.string().trim().min(1, 'Title is required').max(200),
});
export type UpdateSessionTitleDto = z.infer<typeof updateSessionTitleSchema>;

/** The quantity counted on one day of a habit that has a target. */
export const setValueSchema = z.object({
    date: z.coerce.date('Must be a valid date'),
    today: clientToday,
    value: z
        .number('Value must be a number')
        .min(0, 'Value cannot be negative')
        .max(MAX_DAY_VALUE, `Value must be at most ${MAX_DAY_VALUE}`)
        .refine(oneDecimal, 'Value may have one decimal place at most'),
});
export type SetValueDto = z.infer<typeof setValueSchema>;

export const pauseParamsSchema = z.object({
    id: objectId('habit ID'),
    pauseId: objectId('pause ID'),
});
export type PauseParams = z.infer<typeof pauseParamsSchema>;

export const addPauseSchema = z
    .object({
        from: z.coerce.date('Must be a valid date'),
        to: z.coerce.date('Must be a valid date').optional(),
    })
    .refine(body => !body.to || body.to >= body.from, {
        message: 'A pause cannot end before it starts',
        path: ['to'],
    });
export type AddPauseDto = z.infer<typeof addPauseSchema>;

/** Ends a pause — or moves its end. Resuming a habit is `to` = yesterday. */
export const endPauseSchema = z.object({
    to: z.coerce.date('Must be a valid date'),
});
export type EndPauseDto = z.infer<typeof endPauseSchema>;

export const addRestDaySchema = z.object({
    date: z.coerce.date('Must be a valid date'),
});
export type AddRestDayDto = z.infer<typeof addRestDaySchema>;

// A string, not coerced: route params are typed as strings throughout, and the
// handler turns this one into a day itself.
export const restDayParamsSchema = z.object({
    id: objectId('habit ID'),
    date: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'Must be a valid date'),
});
export type RestDayParams = z.infer<typeof restDayParamsSchema>;

/**
 * Checked but not coerced — Express 5 will not accept a rewritten req.query, so
 * the handler reads the original string and parses it itself.
 */
export const habitsForDateQuerySchema = z.object({
    date: z.coerce.date('Must be a valid date').optional(),
    today: clientToday,
});

export const dayNoteParamsSchema = z.object({ id: objectId('habit ID'), day: dayKey });
export type DayNoteParams = z.infer<typeof dayNoteParamsSchema>;

/** A few words about how a day went. An empty note takes it away. */
export const setNoteSchema = z.object({
    note: z.string('A note is required').trim().max(MAX_NOTE, `Must be ${MAX_NOTE} characters or fewer`),
});
export type SetNoteDto = z.infer<typeof setNoteSchema>;

/**
 * Why a day was failed — or that the question was asked and set aside, so it is
 * not asked again. A closed list of codes, because only a closed list can be
 * counted.
 */
export const setReasonSchema = z.union([
    z.object({
        code: z.enum(REASON_CODES as [string, ...string[]], 'Pick one of the listed reasons'),
        text: z.string().trim().max(MAX_REASON_TEXT, `Must be ${MAX_REASON_TEXT} characters or fewer`).optional(),
    }),
    z.object({ skipped: z.literal(true) }),
]);
export type SetReasonDto =
    | { code: (typeof REASON_CODES)[number]; text?: string }
    | { skipped: true };
