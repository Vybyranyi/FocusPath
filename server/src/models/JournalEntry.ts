import mongoose, { Document, Schema } from 'mongoose';

export const MAX_JOURNAL_TEXT = 2000;

export interface IJournalEntry extends Document {
    userId: mongoose.Types.ObjectId;
    /** Midnight UTC of the calendar day. */
    day: Date;
    mood?: number;
    energy?: number;
    text?: string;
}

/**
 * How a day went as a whole: one entry per person per day, every field
 * optional. An entry with nothing left in it is not kept — it is the same as no
 * entry, and `JournalService` deletes it rather than storing the emptiness.
 *
 * Owned by the person, not by a habit: it survives every habit being deleted,
 * and goes with the account.
 */
const JournalEntrySchema = new Schema({
    userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
    day: { type: Date, required: true },
    mood: { type: Number, min: 1, max: 5, validate: Number.isInteger },
    energy: { type: Number, min: 1, max: 5, validate: Number.isInteger },
    text: { type: String, maxlength: MAX_JOURNAL_TEXT },
});

JournalEntrySchema.index({ userId: 1, day: 1 }, { unique: true });

JournalEntrySchema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.userId;
        delete ret.__v;
        return ret;
    },
});

const JournalEntry = mongoose.model<IJournalEntry>('JournalEntry', JournalEntrySchema);

export default JournalEntry;
