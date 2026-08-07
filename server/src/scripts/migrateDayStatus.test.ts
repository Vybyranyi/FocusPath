import mongoose from 'mongoose';
import Habit from '@models/Habit';
import { migrateDayStatuses } from './migrateDayStatus';

/**
 * Inserted through the driver rather than the model, because the model no
 * longer has the field being migrated away from. This is what a document
 * written by the previous release actually looks like.
 */
const insertLegacyHabit = async (completions: boolean[]) => {
    const result = await mongoose.connection.collection('habits').insertOne({
        title: 'Read daily',
        startDate: new Date('2026-03-15T00:00:00.000Z'),
        duration: completions.length,
        type: 'build',
        color: 'blue',
        icon: 'books',
        userId: new mongoose.Types.ObjectId(),
        currentStreak: 0,
        isCompleted: false,
        dailyCompletions: completions.map((completed, index) => ({
            _id: new mongoose.Types.ObjectId(),
            dayTitle: `Day ${index + 1}`,
            date: new Date(Date.UTC(2026, 2, 15 + index)),
            completed,
        })),
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return result.insertedId;
};

const readRaw = async (id: mongoose.Types.ObjectId) =>
    mongoose.connection.collection('habits').findOne({ _id: id });

describe('migrateDayStatuses', () => {
    it('turns a completed day into done and everything else into pending', async () => {
        const id = await insertLegacyHabit([true, false, true]);

        await migrateDayStatuses();

        const habit = await readRaw(id);
        expect(habit!.dailyCompletions.map((day: { status: string }) => day.status)).toEqual([
            'done',
            'pending',
            'done',
        ]);
    });

    /**
     * Never `failed`. A boolean could not tell "I did not do this" apart from
     * "this day has not happened yet" — that is the whole reason for the enum —
     * so the intent behind an old `false` is not recoverable and is not invented.
     */
    it('never invents a failure that was not recorded', async () => {
        const id = await insertLegacyHabit([false, false]);

        await migrateDayStatuses();

        const habit = await readRaw(id);
        const statuses = habit!.dailyCompletions.map((day: { status: string }) => day.status);
        expect(statuses).not.toContain('failed');
    });

    it('removes the field it replaced', async () => {
        const id = await insertLegacyHabit([true, false]);

        await migrateDayStatuses();

        const habit = await readRaw(id);
        expect(
            habit!.dailyCompletions.every((day: Record<string, unknown>) => !('completed' in day)),
        ).toBe(true);
    });

    it('leaves an already migrated habit alone', async () => {
        const id = await insertLegacyHabit([true, false]);
        await migrateDayStatuses();
        const first = await readRaw(id);

        await migrateDayStatuses();

        expect(await readRaw(id)).toEqual(first);
    });

    it('reports having nothing to do on an empty collection', async () => {
        await expect(migrateDayStatuses()).resolves.toEqual({
            habits: 0,
            markedDone: 0,
            markedPending: 0,
        });
    });

    it('reads the habits it is going to touch', async () => {
        await insertLegacyHabit([true, true, false]);

        await expect(migrateDayStatuses()).resolves.toMatchObject({ habits: 1 });
    });

    it('does not disturb a habit the current release wrote', async () => {
        const habit = await Habit.create({
            title: 'Already new',
            startDate: new Date('2026-03-15T00:00:00.000Z'),
            duration: 1,
            type: 'build',
            color: 'blue',
            icon: 'books',
            userId: new mongoose.Types.ObjectId(),
            dailyCompletions: [
                {
                    dayTitle: 'Day 1',
                    date: new Date('2026-03-15T00:00:00.000Z'),
                    status: 'failed',
                },
            ],
        });

        await migrateDayStatuses();

        const reread = await Habit.findById(habit._id);
        expect(reread!.dailyCompletions[0].status).toBe('failed');
    });
});
