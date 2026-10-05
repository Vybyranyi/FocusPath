import mongoose, { Document, Schema } from 'mongoose';
import type { DayStatus, FailureReason, ReasonCode } from '@shared/index';

/**
 * The statuses a day can be *stored* with. `pending` is the absence of a
 * record, and `missed` is derived from the date — see `DayStatus` in `shared/`.
 */
export const LOGGED_STATUSES: readonly Exclude<DayStatus, 'pending'>[] = ['done', 'failed'];

/**
 * The runtime half of `ReasonCode`, which `shared/` can only declare. A closed
 * list on purpose: free text cannot be counted, and what the coach reads is the
 * count.
 */
export const REASON_CODES: readonly ReasonCode[] = [
    'no_time',
    'forgot',
    'no_energy',
    'ill',
    'circumstances',
    'didnt_want',
    'other',
];

export const MAX_NOTE = 280;
export const MAX_REASON_TEXT = 200;

/** Largest quantity a day may hold. Wide enough for steps, narrow enough to catch a slipped finger. */
export const MAX_DAY_VALUE = 10_000;

export interface IHabitDay extends Document {
    habitId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    /** Midnight UTC of the calendar day. */
    day: Date;
    /** Set by marking a day of a habit that has no quantity. */
    status?: Exclude<DayStatus, 'pending'>;
    /** Set by counting, for a habit that has a target. */
    value?: number;
    completedSteps: mongoose.Types.ObjectId[];
    /** A few words about how it went. */
    note?: string;
    /** Only ever present on a day that is `failed`; removed when it stops being one. */
    failureReason?: FailureReason;
    /** The "why?" prompt was shown for this day, so it is not shown twice. */
    reasonPrompted?: boolean;
}

/**
 * The log of what happened, one document per habit per day *something* happened
 * on. A day with no document is pending, or missed once it is over.
 *
 * Kept out of the habit on purpose: a habit with no end would carry an array
 * that only ever grew, and ship it in every response. The log is also the one
 * thing the journal and the coach read in bulk.
 */
const HabitDaySchema = new Schema({
    habitId: { type: mongoose.Types.ObjectId, ref: 'Habit', required: true },
    // Duplicated from the habit so ownership is a property of the query itself:
    // a day can never be read or written without naming whose it is.
    userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
    day: { type: Date, required: true },
    status: { type: String, enum: LOGGED_STATUSES },
    value: { type: Number, min: 0, max: MAX_DAY_VALUE },
    completedSteps: { type: [mongoose.Types.ObjectId], default: [] },
    note: { type: String, maxlength: MAX_NOTE },
    failureReason: {
        type: new Schema({
            code: { type: String, enum: REASON_CODES, required: true },
            text: { type: String, maxlength: MAX_REASON_TEXT },
        }, { _id: false }),
    },
    reasonPrompted: { type: Boolean },
});

HabitDaySchema.index({ habitId: 1, day: 1 }, { unique: true });
HabitDaySchema.index({ userId: 1, day: 1 });

HabitDaySchema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.userId;
        delete ret.__v;
        return ret;
    },
});

const HabitDay = mongoose.model<IHabitDay>('HabitDay', HabitDaySchema);

export default HabitDay;
