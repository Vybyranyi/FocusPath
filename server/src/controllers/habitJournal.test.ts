import HabitDay from '@models/HabitDay';
import JournalEntry from '@models/JournalEntry';
import Habit from '@models/Habit';
import { signUp, validUser, type Client } from '../testUtils';

jest.mock('@services/moderationService', () => ({
    MODERATION_MODEL: 'test-model',
    reviewPlan: jest.fn().mockResolvedValue({ language: 'en', verdict: 'allow' }),
}));

const dayKey = (offset: number) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};

const write = (client: Client, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

describe('Notes, reasons and the day view', () => {
    let client: Client;

    beforeEach(async () => {
        client = await signUp();
    });

    const createHabit = async (overrides: Record<string, unknown> = {}) =>
        (await write(client, 'post', '/habits/')
            .send({ title: 'Read', startDate: dayKey(-1), sessions: 10, type: 'build', color: 'blue', icon: 'books', ...overrides })
            .expect(201)).body.data.habit;

    const mark = (id: string, offset: number, status: string) =>
        write(client, 'patch', `/habits/${id}/complete`).send({ date: dayKey(offset), status });
    const note = (id: string, offset: number, body: Record<string, unknown>) =>
        write(client, 'patch', `/habits/${id}/days/${dayKey(offset)}/note`).send(body);
    const reason = (id: string, offset: number, body: Record<string, unknown>) =>
        write(client, 'patch', `/habits/${id}/days/${dayKey(offset)}/reason`).send(body);

    const dayOf = async (id: string, offset: number) => {
        const response = await client.agent.get(`/habits/daily?date=${dayKey(offset)}`).expect(200);
        return response.body.data.habits.find((habit: { _id: string }) => habit._id === id).day;
    };

    describe('PATCH /habits/:id/days/:day/note', () => {
        it('puts a few words on a day', async () => {
            const habit = await createHabit();

            const response = await note(habit._id, 0, { note: 'Read on the train' }).expect(200);

            expect(response.body.data.day.note).toBe('Read on the train');
            expect((await dayOf(habit._id, 0)).note).toBe('Read on the train');
        });

        it('can be written on a day nothing else happened on', async () => {
            const habit = await createHabit();

            await note(habit._id, 0, { note: 'Forgot my book' }).expect(200);

            expect(await HabitDay.countDocuments()).toBe(1);
        });

        it('trims the note, and takes it away when it is empty', async () => {
            const habit = await createHabit();
            const kept = await note(habit._id, 0, { note: '  hello ' }).expect(200);
            expect(kept.body.data.day.note).toBe('hello');

            const removed = await note(habit._id, 0, { note: '' }).expect(200);

            expect(removed.body.data.day.note).toBeUndefined();
            expect(await HabitDay.countDocuments()).toBe(0);
        });

        it('sits beside the mark without disturbing it', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'done').expect(200);

            await note(habit._id, 0, { note: 'Easy' }).expect(200);
            const unmarked = await mark(habit._id, 0, 'pending').expect(200);

            expect(unmarked.body.data.day.state).toBe('pending');
            expect(unmarked.body.data.day.note).toBe('Easy');
        });

        it('refuses more than 280 characters', async () => {
            const habit = await createHabit();

            await note(habit._id, 0, { note: 'x'.repeat(281) }).expect(400);
        });

        it('refuses a day that has not come', async () => {
            const habit = await createHabit();

            await note(habit._id, 5, { note: 'later' }).expect(400);
        });

        it('refuses a day the habit has nothing to say about', async () => {
            const habit = await createHabit({ sessions: 2 });

            const response = await note(habit._id, -20, { note: 'before it began' }).expect(400);

            expect(response.body.error.message).toBe('The habit is not scheduled on that date');
        });

        it('belongs to the habit owner', async () => {
            const habit = await createHabit();
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'patch', `/habits/${habit._id}/days/${dayKey(0)}/note`)
                .send({ note: 'mine now' })
                .expect(404);
        });

        it('wants a real day in the path', async () => {
            const habit = await createHabit();

            await write(client, 'patch', `/habits/${habit._id}/days/yesterday/note`).send({ note: 'x' }).expect(400);
        });
    });

    describe('PATCH /habits/:id/days/:day/reason', () => {
        it('records why a failed day was failed', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);

            const response = await reason(habit._id, 0, { code: 'no_time', text: 'Meetings all day' }).expect(200);

            expect(response.body.data.day).toMatchObject({
                state: 'failed',
                failureReason: { code: 'no_time', text: 'Meetings all day' },
                reasonPrompted: true,
            });
        });

        it('takes a reason without words', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);

            const response = await reason(habit._id, 0, { code: 'forgot' }).expect(200);

            expect(response.body.data.day.failureReason).toEqual({ code: 'forgot' });
        });

        it('can be skipped, which only says the question was asked', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);

            const response = await reason(habit._id, 0, { skipped: true }).expect(200);

            expect(response.body.data.day.reasonPrompted).toBe(true);
            expect(response.body.data.day.failureReason).toBeUndefined();
        });

        it('keeps an earlier reason when a later prompt is skipped', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);
            await reason(habit._id, 0, { code: 'ill' }).expect(200);

            const response = await reason(habit._id, 0, { skipped: true }).expect(200);

            expect(response.body.data.day.failureReason.code).toBe('ill');
        });

        it.each(['no_time', 'forgot', 'no_energy', 'ill', 'circumstances', 'didnt_want', 'other'])('accepts %s', async code => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);

            await reason(habit._id, 0, { code }).expect(200);
        });

        it('refuses a reason outside the list', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);

            await reason(habit._id, 0, { code: 'bored' }).expect(400);
        });

        it('refuses more than 200 characters of words', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);

            await reason(habit._id, 0, { code: 'other', text: 'x'.repeat(201) }).expect(400);
        });

        it('is only for a day that was failed', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'done').expect(200);

            const response = await reason(habit._id, 0, { code: 'no_time' }).expect(400);

            expect(response.body.error.message).toBe('Only a day that was failed has a reason');
        });

        it('is not for a day that was merely missed', async () => {
            const habit = await createHabit();

            await reason(habit._id, -1, { code: 'no_time' }).expect(400);
        });

        it('goes when the day stops being failed', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);
            await reason(habit._id, 0, { code: 'no_time' }).expect(200);

            const taken = await mark(habit._id, 0, 'done').expect(200);

            expect(taken.body.data.day.failureReason).toBeUndefined();
            expect((await HabitDay.findOne({}))?.failureReason).toBeUndefined();
        });

        it('is remembered as asked even after the day stops being failed', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);
            await reason(habit._id, 0, { skipped: true }).expect(200);
            await mark(habit._id, 0, 'pending').expect(200);

            const again = await mark(habit._id, 0, 'failed').expect(200);

            expect(again.body.data.day.reasonPrompted).toBe(true);
        });

        it('follows a quantity day that crosses its limit and comes back', async () => {
            const habit = await createHabit({ type: 'quit', target: { value: 3, unit: 'cigarettes' } });
            const set = (value: number) =>
                write(client, 'patch', `/habits/${habit._id}/value`).send({ date: dayKey(0), value });

            await set(5).expect(200);
            await reason(habit._id, 0, { code: 'circumstances' }).expect(200);

            const back = await set(2).expect(200);

            expect(back.body.data.day.failureReason).toBeUndefined();
        });

        it('belongs to the habit owner', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0, 'failed').expect(200);
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'patch', `/habits/${habit._id}/days/${dayKey(0)}/reason`)
                .send({ code: 'no_time' })
                .expect(404);
        });
    });

    describe('GET /habits/daily', () => {
        it("carries the day's own journal entry", async () => {
            await write(client, 'put', `/journal/${dayKey(0)}`).send({ mood: 4, text: 'Fine' }).expect(200);

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.journal).toMatchObject({ mood: 4, text: 'Fine' });
        });

        it('says there is none when there is none', async () => {
            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.journal).toBeNull();
        });

        it("does not hand over another person's entry", async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            await write(stranger, 'put', `/journal/${dayKey(0)}`).send({ mood: 1 }).expect(200);

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.journal).toBeNull();
        });
    });

    describe('what the account does with it', () => {
        it('puts the journal and the notes in the export', async () => {
            const habit = await createHabit();
            await write(client, 'put', `/journal/${dayKey(0)}`).send({ mood: 4, text: 'Fine' }).expect(200);
            await mark(habit._id, 0, 'failed').expect(200);
            await reason(habit._id, 0, { code: 'ill', text: 'Flu' }).expect(200);
            await note(habit._id, 0, { note: 'Stayed in bed' }).expect(200);

            const exported = (await client.agent.get('/auth/export').expect(200)).body.data;

            expect(exported.journal).toHaveLength(1);
            expect(exported.journal[0]).toMatchObject({ mood: 4, text: 'Fine' });
            expect(exported.habits[0].days[0]).toMatchObject({
                note: 'Stayed in bed',
                failureReason: { code: 'ill', text: 'Flu' },
                reasonPrompted: true,
            });
            expect(JSON.stringify(exported)).not.toContain('"userId"');
        });

        it("keeps another person's journal out of the export", async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            await write(stranger, 'put', `/journal/${dayKey(0)}`).send({ mood: 1 }).expect(200);

            const exported = (await client.agent.get('/auth/export').expect(200)).body.data;

            expect(exported.journal).toEqual([]);
        });

        it('erases the journal, the notes and the days when the account goes', async () => {
            const habit = await createHabit();
            await write(client, 'put', `/journal/${dayKey(0)}`).send({ mood: 4 }).expect(200);
            await mark(habit._id, 0, 'failed').expect(200);
            await note(habit._id, 0, { note: 'x' }).expect(200);
            const stranger = await signUp({ email: 'stranger@example.com' });
            await write(stranger, 'put', `/journal/${dayKey(0)}`).send({ mood: 2 }).expect(200);

            await write(client, 'delete', '/auth/account').send({ password: validUser.password }).expect(200);

            expect(await JournalEntry.countDocuments()).toBe(1);
            expect(await HabitDay.countDocuments()).toBe(0);
            expect(await Habit.countDocuments()).toBe(0);
        });

        it('keeps the journal and the notes out of a published plan', async () => {
            const habit = await createHabit({ startDate: dayKey(0) });
            await note(habit._id, 0, { note: 'private note' }).expect(200);
            await write(client, 'put', `/journal/${dayKey(0)}`).send({ text: 'private day' }).expect(200);

            const plan = (await write(client, 'post', '/plans').send({ habitId: habit._id, category: 'learning' }).expect(201)).body.data.plan;

            expect(JSON.stringify(plan)).not.toContain('private');
        });
    });

    describe('the preference to be asked', () => {
        it('is on by default', async () => {
            const response = await client.agent.get('/auth/me').expect(200);

            expect(response.body.data.user.preferences).toEqual({ askFailureReason: true });
        });

        it('can be turned off, and back', async () => {
            const off = await write(client, 'patch', '/auth/profile').send({ preferences: { askFailureReason: false } }).expect(200);
            expect(off.body.data.user.preferences.askFailureReason).toBe(false);

            const on = await write(client, 'patch', '/auth/profile').send({ preferences: { askFailureReason: true } }).expect(200);
            expect(on.body.data.user.preferences.askFailureReason).toBe(true);
        });

        it('is enough on its own for a profile update', async () => {
            await write(client, 'patch', '/auth/profile').send({ preferences: {} }).expect(200);
        });

        it('leaves the rest of the profile alone', async () => {
            await write(client, 'patch', '/auth/profile').send({ preferences: { askFailureReason: false } }).expect(200);

            const me = await client.agent.get('/auth/me').expect(200);

            expect(me.body.data.user.name).toBe(validUser.name);
        });

        it('refuses a value that is not a boolean', async () => {
            await write(client, 'patch', '/auth/profile').send({ preferences: { askFailureReason: 'no' } }).expect(400);
        });
    });
});
