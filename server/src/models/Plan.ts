import mongoose, { Document, Schema } from 'mongoose';
import type { Frequency, Plan, PlanCategory, PlanStatus, Target, TimeOfDay } from '@shared/index';
import { FrequencySchema, TargetSchema, TIMES_OF_DAY } from '@models/Habit';

/**
 * The runtime half of `PlanCategory`.
 *
 * It lives here rather than in `shared/` because that package holds declaration
 * files only — they are never emitted, so neither app gains a build step from
 * importing one, and a runtime array cannot live in one at all. Same arrangement
 * as `DAY_STATUSES` on the habit.
 */
export const PLAN_CATEGORIES: readonly PlanCategory[] = [
    'health',
    'fitness',
    'mind',
    'learning',
    'productivity',
    'money',
    'sleep',
    'nutrition',
    'digital',
    'social',
    'creativity',
    'other',
];

export const PLAN_STATUSES: readonly PlanStatus[] = ['published', 'unpublished', 'removed'];

/** Below this many clones the completion rate is not shown at all — see `toJSON`. */
export const MIN_CLONES_FOR_RATE = 10;

/**
 * The stored plan. The public shape comes from the shared `Plan` contract; what
 * is restated here is what storage adds and the response must never carry — the
 * author's user id, the source habit, the content hash and the moderation trail.
 */
export interface IPlan
    extends Document,
    Omit<Plan, '_id' | 'author' | 'provenAt' | 'days' | 'daysTruncated' | 'completionRate' | 'frequency' | 'target' | 'timeOfDay' | 'createdAt' | 'updatedAt'> {
    /** The tasks of the plan, one per session. The name predates frequencies. */
    days: Array<{ dayTitle: string }>;
    frequency: Frequency;
    target?: Target;
    timeOfDay: TimeOfDay;
    author: {
        userId: mongoose.Types.ObjectId;
        displayName?: string;
    };
    /**
     * Where the content came from. The plan is a snapshot and never follows the
     * habit again; this is kept purely so the proven badge can find its source
     * and check that the schedule still matches what was published.
     */
    sourceHabitId: mongoose.Types.ObjectId;
    /** `contentHash` of the content as published. See `services/planContent.ts`. */
    contentHash: string;
    provenAt?: Date;
    completedCloneCount: number;
    moderation: {
        checkedAt: Date;
        model: string;
        verdict: string;
        reason?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}

const PlanSchema: Schema = new Schema({
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '' },
    category: { type: String, enum: PLAN_CATEGORIES, required: true },
    // ISO 639-1, decided by the moderation call rather than asked of the user:
    // it costs one field now and cannot be recovered later, when the collection
    // holds five hundred untagged plans and the only way back is to guess.
    language: { type: String, required: true, lowercase: true, trim: true },
    type: { type: String, enum: ['build', 'quit'], required: true },
    // Equals `days.length`, kept so the library's listing and filters did not
    // have to change when a day became a session.
    duration: { type: Number, required: true, min: 1, max: 365 },
    // How the plan is walked. Plans from before frequencies existed have none
    // stored, which the migration fills in — and the default covers until it has.
    frequency: { type: FrequencySchema, default: () => ({ kind: 'daily' }) },
    target: { type: TargetSchema },
    timeOfDay: { type: String, enum: TIMES_OF_DAY, default: 'anytime' },
    color: { type: String, required: true },
    icon: { type: String, required: true },
    days: [{
        _id: false,
        dayTitle: { type: String, required: true },
    }],
    author: {
        userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
        displayName: { type: String, required: false, trim: true, maxlength: 30 },
    },
    sourceHabitId: { type: mongoose.Types.ObjectId, ref: 'Habit', required: true },
    contentHash: { type: String, required: true },
    proven: { type: Boolean, default: false },
    provenAt: { type: Date, required: false },
    official: { type: Boolean, default: false },
    status: { type: String, enum: PLAN_STATUSES, default: 'published', required: true },
    cloneCount: { type: Number, default: 0 },
    completedCloneCount: { type: Number, default: 0 },
    moderation: {
        checkedAt: { type: Date, required: true },
        model: { type: String, required: true },
        verdict: { type: String, required: true },
        reason: { type: String, required: false },
    },
}, { timestamps: true });

PlanSchema.index({ status: 1, category: 1, language: 1, createdAt: -1 });
PlanSchema.index({ status: 1, proven: -1, completedCloneCount: -1 });
PlanSchema.index({ 'author.userId': 1, createdAt: -1 });
PlanSchema.index({ sourceHabitId: 1 });

/**
 * The model strips its own secrets, for the same reason `User` and `Habit` do:
 * so that no controller has to remember to, and none can forget.
 *
 * The completion rate is derived here as well, because the floor under it is
 * part of what the field *means*. Below ten clones the number is either 100% or
 * 0% and says nothing about the plan, so there is no number — and
 * `completedCloneCount` leaves with it, or the ratio it was hiding could simply
 * be divided out.
 */
PlanSchema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
        const clones = typeof ret.cloneCount === 'number' ? ret.cloneCount : 0;
        const completed = typeof ret.completedCloneCount === 'number' ? ret.completedCloneCount : 0;

        if (clones >= MIN_CLONES_FOR_RATE) {
            ret.completionRate = Math.round((completed / clones) * 100);
        }

        delete ret.completedCloneCount;
        delete ret.sourceHabitId;
        delete ret.contentHash;
        delete ret.moderation;
        delete ret.__v;

        if (ret.author && typeof ret.author === 'object') {
            delete (ret.author as Record<string, unknown>).userId;
        }

        return ret;
    },
});

const Plan = mongoose.model<IPlan>('Plan', PlanSchema);

export default Plan;
