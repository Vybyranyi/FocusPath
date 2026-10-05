import mongoose, { Document, Schema } from 'mongoose';
import type { Frequency, HabitType, Target, TimeOfDay } from '@shared/index';

export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];

export const FREQUENCY_KINDS: readonly Frequency['kind'][] = ['daily', 'weekdays', 'weekly'];

/** Marks a habit as stored in the rules-and-log shape. See `migrateHabitModelV2`. */
export const SCHEMA_VERSION = 2;

export interface IHabitRule {
    effectiveFrom: Date;
    frequency: Frequency;
    target?: Target;
}

/**
 * The stored habit. What it asks for is a list of rules — each with the day it
 * took effect — rather than a row per day, and what happened is in the
 * `HabitDay` log. Everything else, from which days are scheduled to the
 * streak, is worked out by `habitTimeline`.
 *
 * `program` is present exactly when the habit has an end: its length is the
 * number of sessions, and each entry is the task of that session.
 */
export interface IHabit extends Document {
    title: string;
    description: string;
    category: string;
    type: HabitType;
    color: string;
    icon: string;
    userId: mongoose.Types.ObjectId;
    /** Midnight UTC of the first day. */
    startDate: Date;
    timeOfDay: TimeOfDay;
    rules: IHabitRule[];
    program?: Array<{ title: string }>;
    pauses: Array<{ _id: mongoose.Types.ObjectId; from: Date; to?: Date }>;
    restDays: Date[];
    steps?: Array<{
        _id?: mongoose.Types.ObjectId;
        title: string;
    }>;
    currentStreak: number;
    streakUnit: 'day' | 'week';
    isCompleted: boolean;
    schemaVersion: number;
    fromPlanId?: mongoose.Types.ObjectId;
    publishedPlanId?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

// Subdocuments with their own schemas rather than nested paths: a nested path
// cannot opt out of an `_id`, and an absent `target` has to stay absent instead
// of becoming an empty object.
export const FrequencySchema = new Schema({
    kind: { type: String, enum: FREQUENCY_KINDS, required: true },
    days: { type: [Number], default: undefined },
    times: { type: Number },
}, { _id: false });

export const TargetSchema = new Schema({
    value: { type: Number, required: true },
    unit: { type: String, required: true },
}, { _id: false });

const RuleSchema = new Schema({
    effectiveFrom: { type: Date, required: true },
    frequency: { type: FrequencySchema, required: true },
    target: { type: TargetSchema },
}, { _id: false });

const HabitSchema: Schema = new Schema({
    title: { type: String, required: true },
    startDate: { type: Date, required: true },
    type: { type: String, enum: ['build', 'quit'], required: true },
    color: { type: String },
    icon: { type: String },
    userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
    timeOfDay: { type: String, enum: TIMES_OF_DAY, default: 'anytime' },
    rules: {
        type: [RuleSchema],
        validate: [(rules: unknown[]) => rules.length > 0, 'A habit needs at least one rule'],
    },
    // Absent, not empty, for a habit with no end — so "has a programme" is a
    // question about the field and not about its length.
    program: {
        type: [{ _id: false, title: { type: String, required: true } }],
        default: undefined,
    },
    pauses: [{
        from: { type: Date, required: true },
        to: { type: Date },
    }],
    restDays: { type: [Date], default: [] },
    currentStreak: { type: Number, default: 0 },
    streakUnit: { type: String, enum: ['day', 'week'], default: 'day' },
    isCompleted: { type: Boolean, default: false },
    schemaVersion: { type: Number, default: SCHEMA_VERSION },
    description: { type: String, default: '' },
    category: { type: String, default: '' },
    // Both links travel to the client: one says "you took this from the
    // library", the other is what stops the same habit being published twice
    // and what lets the proven badge find its plan without a scan.
    fromPlanId: { type: mongoose.Types.ObjectId, ref: 'Plan', required: false },
    publishedPlanId: { type: mongoose.Types.ObjectId, ref: 'Plan', required: false },
    steps: [{
        title: { type: String, required: true }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Індекси для швидкого пошуку
HabitSchema.index({ userId: 1, startDate: 1 });
HabitSchema.index({ userId: 1, isCompleted: 1 });
// Whether this clone is the one that counts towards a plan's statistics is
// "is it the oldest of this user's clones of it", which this answers directly.
HabitSchema.index({ userId: 1, fromPlanId: 1, createdAt: 1 });

// The owner link and version key are storage details. Stripping them here means
// no handler has to remember to, and none can forget.
HabitSchema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.userId;
        delete ret.__v;
        delete ret.schemaVersion;
        return ret;
    },
});

const Habit = mongoose.model<IHabit>('Habit', HabitSchema);

export default Habit;
