import mongoose from 'mongoose';
import { SCHEMA_VERSION } from '@models/Habit';
import { migrateHabitModelV2 } from './migrateHabitModelV2';

const NOW = new Date('2026-03-18T10:00:00.000Z');
const utc = (day: number) => new Date(Date.UTC(2026, 2, day));

const habits = () => mongoose.connection.collection('habits');
const habitDays = () => mongoose.connection.collection('habitdays');

interface LegacyDayInput {
    dayTitle: string;
    date: Date;
    status: string;
    completedSteps?: mongoose.Types.ObjectId[];
}

/**
 * A habit as the previous release wrote it, inserted through the driver: the
 * model no longer has `dailyCompletions` or `duration`.
 */
const insertLegacyHabit = async (days: LegacyDayInput[], overrides: Record<string, unknown> = {}) => {
    const result = await habits().insertOne({
        title: 'Read',
        startDate: days[0].date,
        duration: days.length,
        type: 'build',
        color: 'blue',
        icon: 'books',
        userId: new mongoose.Types.ObjectId(),
        currentStreak: 0,
        isCompleted: false,
        dailyCompletions: days.map(day => ({
            _id: new mongoose.Types.ObjectId(),
            completedSteps: [],
            ...day,
        })),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    return result.insertedId;
};

const week = (): LegacyDayInput[] => [
    { dayTitle: 'Open the book', date: utc(14), status: 'done' },
    { dayTitle: 'Ten pages', date: utc(15), status: 'failed' },
    { dayTitle: 'Ten pages', date: utc(16), status: 'pending' },
    { dayTitle: 'Chapter one', date: utc(17), status: 'done' },
    { dayTitle: 'Chapter two', date: utc(18), status: 'done' },
    { dayTitle: 'Chapter three', date: utc(19), status: 'pending' },
    { dayTitle: 'Review', date: utc(20), status: 'pending' },
];

describe('migrateHabitModelV2', () => {
    it('turns the days into a daily programme of the same length', async () => {
        const id = await insertLegacyHabit(week());

        await migrateHabitModelV2(NOW);

        const habit = await habits().findOne({ _id: id });
        expect(habit?.rules).toEqual([{ effectiveFrom: utc(14), frequency: { kind: 'daily' } }]);
        expect(habit?.program.map((session: { title: string }) => session.title)).toEqual([
            'Open the book', 'Ten pages', 'Ten pages', 'Chapter one', 'Chapter two', 'Chapter three', 'Review',
        ]);
        expect(habit).toMatchObject({
            timeOfDay: 'anytime',
            pauses: [],
            restDays: [],
            schemaVersion: SCHEMA_VERSION,
        });
    });

    it('keeps a programme even when every day has the same title', async () => {
        const id = await insertLegacyHabit([
            { dayTitle: 'Read', date: utc(14), status: 'pending' },
            { dayTitle: 'Read', date: utc(15), status: 'pending' },
        ]);

        await migrateHabitModelV2(NOW);

        expect((await habits().findOne({ _id: id }))?.program).toEqual([{ title: 'Read' }, { title: 'Read' }]);
    });

    it('logs only the days that were marked or ticked', async () => {
        const step = new mongoose.Types.ObjectId();
        const days = week();
        days[2] = { ...days[2], completedSteps: [step] };
        const id = await insertLegacyHabit(days);

        const report = await migrateHabitModelV2(NOW);

        const logged = await habitDays().find({ habitId: id }).sort({ day: 1 }).toArray();
        expect(logged.map(entry => [entry.day.getUTCDate(), entry.status])).toEqual([
            [14, 'done'],
            [15, 'failed'],
            [16, undefined],
            [17, 'done'],
            [18, 'done'],
        ]);
        expect(logged[2].completedSteps).toEqual([step]);
        expect(report.daysWritten).toBe(5);
    });

    it('gives each logged day to the habit owner', async () => {
        const userId = new mongoose.Types.ObjectId();
        await insertLegacyHabit(week(), { userId });

        await migrateHabitModelV2(NOW);

        expect((await habitDays().findOne({}))?.userId).toEqual(userId);
    });

    it('works the streak and completion out afresh', async () => {
        const finished = await insertLegacyHabit(week().slice(0, 2).map(day => ({ ...day, status: 'done' })));
        const running = await insertLegacyHabit(week());

        await migrateHabitModelV2(NOW);

        // Two days, both long over: complete, and the run ended days ago.
        expect(await habits().findOne({ _id: finished })).toMatchObject({ isCompleted: true, currentStreak: 0 });
        // Done the 17th and 18th (today), the 19th and 20th still ahead.
        expect(await habits().findOne({ _id: running })).toMatchObject({ isCompleted: false, currentStreak: 2 });
    });

    /** Rolling the release back must still find what the old one wrote. */
    it('leaves the old fields exactly as they were', async () => {
        const id = await insertLegacyHabit(week());
        const before = await habits().findOne({ _id: id });

        await migrateHabitModelV2(NOW);

        const after = await habits().findOne({ _id: id });
        expect(after?.dailyCompletions).toEqual(before?.dailyCompletions);
        expect(after?.duration).toBe(7);
    });

    it('does nothing the second time', async () => {
        await insertLegacyHabit(week());
        await migrateHabitModelV2(NOW);

        const report = await migrateHabitModelV2(NOW);

        expect(report).toEqual({ habitsMigrated: 0, daysWritten: 0, plansBackfilled: 0 });
        expect(await habitDays().countDocuments()).toBe(4);
    });

    it('finishes a habit whose first attempt died after writing the log', async () => {
        const id = await insertLegacyHabit(week());
        // What an interrupted run leaves behind: a log entry, and no flag on the habit.
        await habitDays().insertOne({
            habitId: id,
            userId: (await habits().findOne({ _id: id }))?.userId,
            day: utc(14),
            status: 'done',
            completedSteps: [],
        });

        await migrateHabitModelV2(NOW);

        expect(await habitDays().countDocuments({ habitId: id })).toBe(4);
        expect((await habits().findOne({ _id: id }))?.schemaVersion).toBe(SCHEMA_VERSION);
    });

    it('says plainly that a plan from before frequencies ran daily', async () => {
        await mongoose.connection.collection('plans').insertOne({ title: 'Old plan', days: [] });

        const report = await migrateHabitModelV2(NOW);

        expect(report.plansBackfilled).toBe(1);
        expect(await mongoose.connection.collection('plans').findOne({})).toMatchObject({
            frequency: { kind: 'daily' },
            timeOfDay: 'anytime',
        });
    });
});
