import mongoose from 'mongoose';
import Habit from '@models/Habit';
import HabitDay from '@models/HabitDay';
import JournalEntry from '@models/JournalEntry';
import { fromDayNumber, toDayNumber } from '@services/habitTimeline';
import { gatherNotes, loadCoachContext, NOTES_TOTAL_MAX } from '@services/coachData';

const TODAY = toDayNumber('2026-03-18');
const at = (offset: number) => fromDayNumber(TODAY + offset);
const user = new mongoose.Types.ObjectId();

const makeHabit = (overrides: Record<string, unknown> = {}) =>
    Habit.create({
        title: 'Read',
        type: 'build',
        color: 'blue',
        icon: 'books',
        userId: user,
        startDate: at(-10),
        rules: [{ effectiveFrom: at(-10), frequency: { kind: 'daily' } }],
        ...overrides,
    });

const log = (habit: { _id: unknown }, offset: number, fields: Record<string, unknown>) =>
    HabitDay.create({ habitId: habit._id, userId: user, day: at(offset), ...fields });

describe('loadCoachContext', () => {
    it('turns a daily habit into the slots that are over', async () => {
        const habit = await makeHabit({ startDate: at(-3), rules: [{ effectiveFrom: at(-3), frequency: { kind: 'daily' } }] });
        await log(habit, -3, { status: 'done' });
        await log(habit, -2, { status: 'failed' });

        const { input } = await loadCoachContext(String(user), TODAY);

        // Three days over — done, failed, and one nobody marked, which is missed. Today is still open.
        expect(input.habits[0].slots).toEqual([
            { day: TODAY - 3, outcome: 'done' },
            { day: TODAY - 2, outcome: 'failed' },
            { day: TODAY - 1, outcome: 'missed' },
        ]);
    });

    it('leaves out paused days and rest days', async () => {
        await makeHabit({
            startDate: at(-4),
            rules: [{ effectiveFrom: at(-4), frequency: { kind: 'daily' } }],
            pauses: [{ from: at(-3), to: at(-2) }],
            restDays: [at(-1)],
        });

        const { input } = await loadCoachContext(String(user), TODAY);

        expect(input.habits[0].slots).toEqual([{ day: TODAY - 4, outcome: 'missed' }]);
    });

    it('turns a weekly habit into done days and the slots a week missed', async () => {
        // Started Monday 2026-03-02; weekly(2): the week of the 2nd was done once, the week of the 9th not at all.
        const habit = await makeHabit({
            startDate: new Date('2026-03-02T00:00:00.000Z'),
            rules: [{ effectiveFrom: new Date('2026-03-02T00:00:00.000Z'), frequency: { kind: 'weekly', times: 2 } }],
        });
        await HabitDay.create({ habitId: habit._id, userId: user, day: new Date('2026-03-03T00:00:00.000Z'), status: 'done' });

        const { input } = await loadCoachContext(String(user), TODAY);
        const outcomes = input.habits[0].slots.map(slot => slot.outcome);

        // One done on the 3rd; one missed from the first week; two missed from the second.
        expect(outcomes.filter(o => o === 'done')).toHaveLength(1);
        expect(outcomes.filter(o => o === 'missed')).toHaveLength(3);
    });

    it('carries the rule in force, so a recent change can be left to settle', async () => {
        await makeHabit({
            rules: [
                { effectiveFrom: at(-10), frequency: { kind: 'daily' } },
                { effectiveFrom: at(-2), frequency: { kind: 'weekly', times: 4 } },
            ],
        });

        const { input } = await loadCoachContext(String(user), TODAY);

        expect(input.habits[0]).toMatchObject({
            frequency: { kind: 'weekly', times: 4 },
            ruleFrom: TODAY - 2,
            startDay: TODAY - 10,
        });
    });

    it('collects the reasons that were given', async () => {
        const habit = await makeHabit();
        await log(habit, -1, { status: 'failed', failureReason: { code: 'ill', text: 'Flu' } });

        const { input } = await loadCoachContext(String(user), TODAY);

        expect(input.habits[0].reasons).toEqual([{ day: TODAY - 1, code: 'ill' }]);
    });

    it('never puts the id, the words or the title of a reason where the model might see it', async () => {
        const habit = await makeHabit();
        await log(habit, -1, { status: 'failed', failureReason: { code: 'ill', text: 'secret flu' } });

        const { input } = await loadCoachContext(String(user), TODAY);

        expect(JSON.stringify(input.habits[0].reasons)).not.toContain('secret');
    });

    it('reads the journal of the last stretch, as moods and energies only', async () => {
        await JournalEntry.create({ userId: user, day: at(-1), mood: 4, energy: 2, text: 'private' });
        await JournalEntry.create({ userId: user, day: at(-200), mood: 1 });

        const { input } = await loadCoachContext(String(user), TODAY);

        expect(input.journal).toEqual([{ day: TODAY - 1, mood: 4, energy: 2 }]);
    });

    it("sees only the person's own habits and days", async () => {
        await makeHabit();
        const stranger = new mongoose.Types.ObjectId();
        await Habit.create({
            title: 'Theirs', type: 'build', color: 'x', icon: 'y', userId: stranger,
            startDate: at(-5), rules: [{ effectiveFrom: at(-5), frequency: { kind: 'daily' } }],
        });
        await JournalEntry.create({ userId: stranger, day: at(-1), mood: 1 });

        const { input } = await loadCoachContext(String(user), TODAY);

        expect(input.habits.map(habit => habit.title)).toEqual(['Read']);
        expect(input.journal).toEqual([]);
    });

    describe('what can be adjusted', () => {
        it('is active while it runs', async () => {
            const habit = await makeHabit();

            const { habits } = await loadCoachContext(String(user), TODAY);

            expect(habits.get(String(habit._id))?.active).toBe(true);
        });

        it('is not while paused today', async () => {
            const habit = await makeHabit({ pauses: [{ from: at(-1), to: at(3) }] });

            const { habits } = await loadCoachContext(String(user), TODAY);

            expect(habits.get(String(habit._id))?.active).toBe(false);
        });

        it('is not once a programme has run out', async () => {
            const habit = await makeHabit({ startDate: at(-10), program: [{ title: 'a' }, { title: 'b' }] });

            const { habits } = await loadCoachContext(String(user), TODAY);

            expect(habits.get(String(habit._id))?.active).toBe(false);
        });

        it('knows which session of a programme comes next', async () => {
            const habit = await makeHabit({
                startDate: at(-2),
                rules: [{ effectiveFrom: at(-2), frequency: { kind: 'daily' } }],
                program: Array.from({ length: 10 }, (_u, i) => ({ title: `s${i + 1}` })),
            });
            await log(habit, -2, { status: 'done' });
            await log(habit, -1, { status: 'done' });

            const { habits } = await loadCoachContext(String(user), TODAY);

            // Sessions 1 and 2 are done; today carries the third.
            expect(habits.get(String(habit._id))?.nextSession).toBe(3);
        });
    });
});

describe('gatherNotes', () => {
    it('collects notes and journal words from the last two weeks, newest first', async () => {
        const habit = await makeHabit();
        await log(habit, -1, { note: 'Read on the train' });
        await log(habit, -5, { note: 'Skipped, tired' });
        await JournalEntry.create({ userId: user, day: at(-2), text: 'Long day at work' });

        const context = await loadCoachContext(String(user), TODAY);
        const notes = await gatherNotes(context, String(user));

        expect(notes).toEqual([
            '1 days ago: [habit 1] Read on the train',
            '2 days ago: [day] Long day at work',
            '5 days ago: [habit 1] Skipped, tired',
        ]);
    });

    it('names a habit by number, never by its id or title', async () => {
        const habit = await makeHabit({ title: 'Secret Title' });
        await log(habit, -1, { note: 'fine' });

        const context = await loadCoachContext(String(user), TODAY);
        const notes = (await gatherNotes(context, String(user))).join('\n');

        expect(notes).not.toContain(String(habit._id));
        expect(notes).not.toContain('Secret Title');
    });

    it('leaves out what is older than two weeks', async () => {
        const habit = await makeHabit({ startDate: at(-40), rules: [{ effectiveFrom: at(-40), frequency: { kind: 'daily' } }] });
        await log(habit, -20, { note: 'old news' });
        await JournalEntry.create({ userId: user, day: at(-15), text: 'also old' });

        const context = await loadCoachContext(String(user), TODAY);

        expect(await gatherNotes(context, String(user))).toEqual([]);
    });

    it('cuts each note to 280 characters', async () => {
        await JournalEntry.create({ userId: user, day: at(-1), text: 'x'.repeat(1500) });

        const context = await loadCoachContext(String(user), TODAY);
        const [note] = await gatherNotes(context, String(user));

        expect(note.length).toBeLessThanOrEqual('1 days ago: '.length + 280);
    });

    it('stops at 2000 characters in all', async () => {
        for (let offset = 1; offset <= 12; offset++) {
            await JournalEntry.create({ userId: user, day: at(-offset), text: 'y'.repeat(280) });
        }

        const context = await loadCoachContext(String(user), TODAY);
        const notes = await gatherNotes(context, String(user));
        const total = notes.reduce((sum, note) => sum + note.replace(/^\d+ days ago: \[day\] /, '').length, 0);

        expect(total).toBeLessThanOrEqual(NOTES_TOTAL_MAX);
        expect(notes.length).toBeLessThan(12);
    });

    it("never reads another person's words", async () => {
        await JournalEntry.create({ userId: new mongoose.Types.ObjectId(), day: at(-1), text: 'not mine' });

        const context = await loadCoachContext(String(user), TODAY);

        expect(await gatherNotes(context, String(user))).toEqual([]);
    });
});
