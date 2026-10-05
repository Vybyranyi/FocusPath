import JournalEntry from '@models/JournalEntry';
import { signUp, type Client } from '../testUtils';

const dayKey = (offset: number) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};

const write = (client: Client, method: 'put' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

describe('Journal', () => {
    let client: Client;

    beforeEach(async () => {
        client = await signUp();
    });

    const put = (day: string, body: Record<string, unknown>) => write(client, 'put', `/journal/${day}`).send(body);

    describe('PUT /journal/:day', () => {
        it('writes the entry of a day', async () => {
            const response = await put(dayKey(0), { mood: 4, energy: 2, text: 'Long day' }).expect(200);

            expect(response.body.data.entry).toMatchObject({
                day: `${dayKey(0)}T00:00:00.000Z`,
                mood: 4,
                energy: 2,
                text: 'Long day',
            });
        });

        it('never exposes the owner link', async () => {
            const response = await put(dayKey(0), { mood: 4 }).expect(200);

            expect(response.body.data.entry).not.toHaveProperty('userId');
            expect(response.body.data.entry).not.toHaveProperty('__v');
        });

        it('lets any field be left out', async () => {
            const response = await put(dayKey(0), { text: 'Only words' }).expect(200);

            expect(response.body.data.entry.mood).toBeUndefined();
        });

        /** What is not sent is removed — that is how a mood is taken back. */
        it('replaces the entry rather than merging into it', async () => {
            await put(dayKey(0), { mood: 4, energy: 3, text: 'First' }).expect(200);

            const response = await put(dayKey(0), { mood: 2 }).expect(200);

            expect(response.body.data.entry).toMatchObject({ mood: 2 });
            expect(response.body.data.entry.energy).toBeUndefined();
            expect(response.body.data.entry.text).toBeUndefined();
            expect(await JournalEntry.countDocuments()).toBe(1);
        });

        it('trims the text, and treats blank words as none', async () => {
            const kept = await put(dayKey(0), { text: '  hello  ' }).expect(200);
            expect(kept.body.data.entry.text).toBe('hello');

            const blank = await put(dayKey(0), { text: '   ' }).expect(200);
            expect(blank.body.data.entry).toBeNull();
        });

        it('keeps nothing when nothing is left in it', async () => {
            await put(dayKey(0), { mood: 4 }).expect(200);

            const response = await put(dayKey(0), {}).expect(200);

            expect(response.body.data.entry).toBeNull();
            expect(await JournalEntry.countDocuments()).toBe(0);
        });

        it('may be written for a day in the past', async () => {
            await put(dayKey(-40), { mood: 3 }).expect(200);
        });

        it('may not be written for a day that has not come', async () => {
            const response = await put(dayKey(5), { mood: 3 }).expect(400);

            expect(response.body.error.message).toBe('A journal entry cannot be written for a day that has not come');
        });

        it('allows a day of slack for somebody ahead of the server', async () => {
            await put(dayKey(1), { mood: 3 }).expect(200);
        });

        it.each([0, 6, 2.5])('refuses a mood of %s', async mood => {
            const response = await put(dayKey(0), { mood }).expect(400);

            expect(response.body.error.details).toHaveProperty('mood');
        });

        it('refuses an energy outside 1–5', async () => {
            await put(dayKey(0), { energy: 9 }).expect(400);
        });

        it('refuses more than two thousand characters', async () => {
            await put(dayKey(0), { text: 'x'.repeat(2001) }).expect(400);
        });

        it.each(['today', '2026-3-1', '2026-13-45', '2026-02-30T00:00:00Z'])('refuses the day %s', async day => {
            await put(day, { mood: 3 }).expect(400);
        });

        it('requires a session', async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            await stranger.agent.post('/auth/logout').set('X-CSRF-Token', stranger.csrf).expect(200);

            await stranger.agent.put(`/journal/${dayKey(0)}`).send({ mood: 3 }).expect(401);
        });
    });

    describe('DELETE /journal/:day', () => {
        it('takes an entry away', async () => {
            await put(dayKey(0), { mood: 3 }).expect(200);

            await write(client, 'delete', `/journal/${dayKey(0)}`).expect(200);

            expect(await JournalEntry.countDocuments()).toBe(0);
        });

        it('has nothing to say about a day with no entry', async () => {
            await write(client, 'delete', `/journal/${dayKey(0)}`).expect(200);
        });
    });

    describe('GET /journal', () => {
        const range = (from: string, to: string) => client.agent.get(`/journal?from=${from}&to=${to}`);

        it('lists the entries between two days, oldest first, both ends included', async () => {
            for (const offset of [-3, -1, 0]) await put(dayKey(offset), { mood: 3 }).expect(200);
            await put(dayKey(-10), { mood: 1 }).expect(200);

            const response = await range(dayKey(-3), dayKey(0)).expect(200);

            expect(response.body.data.entries.map((entry: { day: string }) => entry.day.slice(0, 10))).toEqual([
                dayKey(-3),
                dayKey(-1),
                dayKey(0),
            ]);
        });

        it('says nothing it was not asked for', async () => {
            await put(dayKey(0), { mood: 3 }).expect(200);

            const response = await range(dayKey(-3), dayKey(-1)).expect(200);

            expect(response.body.data.entries).toEqual([]);
        });

        it('never carries the owner link', async () => {
            await put(dayKey(0), { mood: 3 }).expect(200);

            const response = await range(dayKey(-1), dayKey(0)).expect(200);

            expect(response.body.data.entries[0]).not.toHaveProperty('userId');
        });

        it('reads at most 92 days', async () => {
            await range(dayKey(-91), dayKey(0)).expect(200);
            const response = await range(dayKey(-92), dayKey(0)).expect(400);

            expect(response.body.error.message).toBe('A range may cover at most 92 days');
        });

        it('refuses a range that ends before it starts', async () => {
            await range(dayKey(0), dayKey(-1)).expect(400);
        });

        it('wants both ends', async () => {
            const response = await client.agent.get(`/journal?from=${dayKey(0)}`).expect(400);

            expect(response.body.error.details).toHaveProperty('to');
        });
    });

    describe('ownership', () => {
        it("keeps one person's entries from another", async () => {
            await put(dayKey(0), { mood: 5, text: 'secret' }).expect(200);
            const stranger = await signUp({ email: 'stranger@example.com' });

            const response = await stranger.agent.get(`/journal?from=${dayKey(-1)}&to=${dayKey(0)}`).expect(200);

            expect(response.body.data.entries).toEqual([]);
        });

        it("does not let one person's write touch another's day", async () => {
            await put(dayKey(0), { mood: 5 }).expect(200);
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'put', `/journal/${dayKey(0)}`).send({ mood: 1 }).expect(200);
            await write(stranger, 'delete', `/journal/${dayKey(0)}`).expect(200);

            const mine = await client.agent.get(`/journal?from=${dayKey(0)}&to=${dayKey(0)}`).expect(200);
            expect(mine.body.data.entries[0].mood).toBe(5);
        });
    });
});
