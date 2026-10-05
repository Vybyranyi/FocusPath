import mongoose from 'mongoose';
import JournalEntry from '@models/JournalEntry';
import { BadRequestError } from '@errors/AppError';
import { toDayNumber, fromDayNumber } from '@services/habitTimeline';
import { MAX_JOURNAL_RANGE_DAYS, type PutJournalDto } from '@validation/journalSchemas';
import type { JournalEntry as JournalEntryView } from '@shared/index';

const dayOf = (key: string) => toDayNumber(`${key}T00:00:00.000Z`);

/**
 * Writing is for days that have begun. Yesterday's mood remembered today is
 * worth more than a blank, but a mood for tomorrow is a guess — and with a day
 * of slack, because somebody east of Greenwich is already on tomorrow while the
 * server is not.
 */
const requireNotFuture = (day: number): void => {
    if (day > toDayNumber(new Date()) + 1) {
        throw new BadRequestError('A journal entry cannot be written for a day that has not come');
    }
};

/**
 * Creates or replaces the entry for a day. Replaces, not merges: what is not
 * sent is removed, which is how a mood is taken back. An entry left with nothing
 * in it is the same as none, so it is deleted instead of stored empty.
 */
export const putEntry = async (
    userId: string,
    key: string,
    { mood, energy, text }: PutJournalDto,
): Promise<JournalEntryView | null> => {
    const day = dayOf(key);
    requireNotFuture(day);

    const filter = { userId, day: fromDayNumber(day) };
    const cleaned = text?.trim() ? text.trim() : undefined;

    if (mood === undefined && energy === undefined && cleaned === undefined) {
        await JournalEntry.deleteOne(filter);
        return null;
    }

    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    for (const [field, value] of [['mood', mood], ['energy', energy], ['text', cleaned]] as const) {
        if (value === undefined) unset[field] = '';
        else set[field] = value;
    }

    const entry = await JournalEntry.findOneAndUpdate(
        filter,
        {
            ...(Object.keys(set).length > 0 ? { $set: set } : {}),
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
            $setOnInsert: { userId, day: fromDayNumber(day) },
        },
        { upsert: true, new: true, runValidators: true },
    );

    return entry.toJSON() as unknown as JournalEntryView;
};

export const deleteEntry = async (userId: string, key: string): Promise<void> => {
    await JournalEntry.deleteOne({ userId, day: fromDayNumber(dayOf(key)) });
};

export const getEntry = async (userId: string, day: Date): Promise<JournalEntryView | null> => {
    const entry = await JournalEntry.findOne({ userId, day });
    return entry ? (entry.toJSON() as unknown as JournalEntryView) : null;
};

/**
 * The entries between two days, oldest first.
 *
 * An aggregation rather than a `find` with `$gte`: `sanitizeFilter` is on
 * mongoose-wide and wraps any all-operator value in `$eq`, so the range would
 * quietly match nothing.
 */
export const listEntries = async (
    userId: string,
    fromKey: string,
    toKey: string,
): Promise<JournalEntryView[]> => {
    const from = dayOf(fromKey);
    const to = dayOf(toKey);

    if (to < from) {
        throw new BadRequestError('The range ends before it starts');
    }
    if (to - from + 1 > MAX_JOURNAL_RANGE_DAYS) {
        throw new BadRequestError(`A range may cover at most ${MAX_JOURNAL_RANGE_DAYS} days`);
    }

    return JournalEntry.aggregate<JournalEntryView>([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                day: { $gte: fromDayNumber(from), $lte: fromDayNumber(to) },
            },
        },
        { $sort: { day: 1 } },
        { $project: { userId: 0, __v: 0 } },
    ]);
};
