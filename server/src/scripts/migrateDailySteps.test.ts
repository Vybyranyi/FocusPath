import mongoose from 'mongoose';
import { migrateDailySteps } from './migrateDailySteps';

/**
 * Inserted through the driver, because the model no longer has the per-habit
 * flag — this is what a document written by the previous release looks like.
 */
const insertLegacyHabit = async () => {
    const result = await mongoose.connection.collection('habits').insertOne({
        title: 'Morning routine',
        startDate: new Date('2026-03-15T00:00:00.000Z'),
        duration: 2,
        type: 'build',
        color: 'blue',
        icon: 'sunrise',
        userId: new mongoose.Types.ObjectId(),
        currentStreak: 0,
        isCompleted: false,
        steps: [
            { _id: new mongoose.Types.ObjectId(), title: 'Stretch', completed: true },
            { _id: new mongoose.Types.ObjectId(), title: 'Water', completed: false },
        ],
        dailyCompletions: [0, 1].map(offset => ({
            _id: new mongoose.Types.ObjectId(),
            dayTitle: 'Morning routine',
            date: new Date(Date.UTC(2026, 2, 15 + offset)),
            status: 'pending',
        })),
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return result.insertedId;
};

const readRaw = async (id: mongoose.Types.ObjectId) =>
    mongoose.connection.collection('habits').findOne({ _id: id });

describe('migrateDailySteps', () => {
    it('drops the per-habit flag and keeps the step itself', async () => {
        const id = await insertLegacyHabit();

        await migrateDailySteps();

        const habit = await readRaw(id);
        expect(habit?.steps).toHaveLength(2);
        expect(habit?.steps.every((step: Record<string, unknown>) => !('completed' in step))).toBe(true);
        expect(habit?.steps.map((step: { title: string }) => step.title)).toEqual(['Stretch', 'Water']);
    });

    /** The old flag was never about a day, so no day may claim it. */
    it('starts every day with nothing ticked', async () => {
        const id = await insertLegacyHabit();

        await migrateDailySteps();

        const habit = await readRaw(id);
        expect(
            habit?.dailyCompletions.every(
                (day: { completedSteps: unknown[] }) => Array.isArray(day.completedSteps) && day.completedSteps.length === 0,
            ),
        ).toBe(true);
    });

    it('does nothing the second time', async () => {
        await insertLegacyHabit();
        await migrateDailySteps();

        const report = await migrateDailySteps();

        expect(report).toEqual({ stepsCleaned: 0, daysInitialised: 0 });
    });
});
