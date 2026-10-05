import mongoose, { Document, Schema } from 'mongoose';
import type {
    CoachCardKind,
    CoachCardStatus,
    CoachContent,
    RecalibrationProposal,
} from '@shared/index';

export const COACH_KINDS: readonly CoachCardKind[] = ['weekly_review', 'recalibration', 'insight'];
export const COACH_STATUSES: readonly CoachCardStatus[] = [
    'candidate',
    'ready',
    'failed',
    'dismissed',
    'applied',
];

/** How many times a card's text may be asked for before it is given up on. */
export const MAX_ATTEMPTS = 2;

export interface ICoachCard extends Document {
    userId: mongoose.Types.ObjectId;
    kind: CoachCardKind;
    key: string;
    habitId?: mongoose.Types.ObjectId;
    status: CoachCardStatus;
    facts: Record<string, unknown>;
    proposal?: RecalibrationProposal;
    content?: CoachContent;
    language: string;
    /** Which pattern an insight is about, so it is not told twice. Names ids, so it never leaves the server. */
    fingerprint?: string;
    attempts: number;
    feedback?: 'helpful' | 'not_helpful';
    usage?: { model: string; inputTokens: number; outputTokens: number };
    readyAt?: Date;
    createdAt: Date;
}

/**
 * One thing the coach has to say, kept so it is said once.
 *
 * The unique index on (person, kind, key) *is* the rate limit: a review is one
 * per week, a recalibration one per habit per week, an insight one per day,
 * because the key names the period and a second card for the same period cannot
 * exist. Asking again therefore generates nothing and costs nothing.
 *
 * Built from the journal, so it goes with the account like the journal does.
 */
const CoachCardSchema = new Schema({
    userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: COACH_KINDS, required: true },
    key: { type: String, required: true },
    habitId: { type: mongoose.Types.ObjectId, ref: 'Habit' },
    status: { type: String, enum: COACH_STATUSES, required: true },
    facts: { type: Schema.Types.Mixed, default: {} },
    proposal: { type: Schema.Types.Mixed },
    content: {
        type: new Schema({
            title: { type: String, required: true },
            body: { type: String, required: true },
            win: { type: String },
            tip: { type: String },
        }, { _id: false }),
    },
    language: { type: String, required: true },
    fingerprint: { type: String },
    attempts: { type: Number, default: 0 },
    feedback: { type: String, enum: ['helpful', 'not_helpful'] },
    // Cost, never content: what was asked and answered stays out of every log.
    usage: {
        type: new Schema({
            model: String,
            inputTokens: Number,
            outputTokens: Number,
        }, { _id: false }),
    },
    readyAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: false } });

CoachCardSchema.index({ userId: 1, kind: 1, key: 1 }, { unique: true });
CoachCardSchema.index({ userId: 1, createdAt: -1 });

CoachCardSchema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.userId;
        delete ret.usage;
        delete ret.attempts;
        delete ret.fingerprint;
        delete ret.__v;
        return ret;
    },
});

const CoachCard = mongoose.model<ICoachCard>('CoachCard', CoachCardSchema);

export default CoachCard;
