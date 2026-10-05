import HabitDay from '@models/HabitDay';
import { signUp, type Client } from '../testUtils';

/** Today at midnight UTC — the earliest start date a new habit is allowed. */
const todayUtc = () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
};

const daysFromToday = (days: number) => {
    const date = todayUtc();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString();
};

/** A day as it travels on the wire: `YYYY-MM-DD`, never a full instant. */
const dayKey = (days: number) => daysFromToday(days).slice(0, 10);

const validHabit = () => ({
    title: 'Read daily',
    startDate: daysFromToday(0),
    sessions: 5,
    type: 'build',
    color: 'blue',
    icon: 'books',
});

/** A write as the real client makes it: session cookies plus the echoed CSRF value. */
const write = (client: Client, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

const createHabit = async (client: Client, overrides: Record<string, unknown> = {}) => {
    const response = await write(client, 'post', '/habits/')
        .send({ ...validHabit(), ...overrides })
        .expect(201);

    return response.body.data.habit;
};

describe('Habit Controller', () => {
    let client: Client;

    beforeEach(async () => {
        client = await signUp();
    });

    /** The habit as the day view shows it on one day, or undefined if it is not there. */
    const onDay = async (habitId: string, offset: number, today?: number) => {
        const query = today === undefined ? '' : `&today=${dayKey(today)}`;
        const response = await client.agent.get(`/habits/daily?date=${dayKey(offset)}${query}`).expect(200);

        return response.body.data.habits.find((habit: { _id: string }) => habit._id === habitId);
    };

    const mark = (habitId: string, offset: number, status: string) =>
        write(client, 'patch', `/habits/${habitId}/complete`).send({ date: dayKey(offset), status });

    describe('POST /habits/', () => {
        it('makes a programme of the length asked for, running daily', async () => {
            const habit = await createHabit(client, { sessions: 7 });

            expect(habit).toMatchObject({
                sessions: 7,
                frequency: { kind: 'daily' },
                timeOfDay: 'anytime',
                currentStreak: 0,
                isCompleted: false,
            });
            expect(habit.rules).toHaveLength(1);
            expect(habit.progress).toMatchObject({ done: 0, decided: 0, sessionsTotal: 7 });
        });

        it('puts the end of a programme on its last session', async () => {
            const habit = await createHabit(client, { sessions: 5 });

            expect(habit.endDate).toBe(daysFromToday(4));
        });

        it('has no end when no number of sessions is given', async () => {
            const { sessions: _unused, ...openEnded } = validHabit();
            const response = await write(client, 'post', '/habits/').send(openEnded).expect(201);

            expect(response.body.data.habit.sessions).toBeUndefined();
            expect(response.body.data.habit.endDate).toBeUndefined();
        });

        it('stores the rhythm, the target and the part of the day it was given', async () => {
            const habit = await createHabit(client, {
                frequency: { kind: 'weekdays', days: [5, 1, 3] },
                target: { value: 8, unit: 'glasses' },
                timeOfDay: 'morning',
            });

            expect(habit).toMatchObject({
                frequency: { kind: 'weekdays', days: [1, 3, 5] },
                target: { value: 8, unit: 'glasses' },
                timeOfDay: 'morning',
            });
        });

        it('never exposes the owner link or the storage details', async () => {
            const habit = await createHabit(client);

            for (const hidden of ['userId', '__v', 'schemaVersion', 'program', 'dailyCompletions']) {
                expect(habit).not.toHaveProperty(hidden);
            }
        });

        it('refuses a start date in the past', async () => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), startDate: daysFromToday(-2) })
                .expect(400);

            expect(response.body.error.details.startDate).toEqual([
                'Start date cannot be in the past',
            ]);
        });

        /**
         * One day of slack, on purpose. The client sends the calendar day it is
         * on, and west of Greenwich that trails the server's UTC day: a user in
         * UTC−5 at 20:00 is still on the 7th while the server has turned over
         * to the 8th. Without the slack their own today was "in the past".
         */
        it('accepts a start date one day behind the server', async () => {
            await write(client, 'post', '/habits/')
                .send({ ...validHabit(), startDate: daysFromToday(-1) })
                .expect(201);
        });

        it.each([0, 366, 1.5])('refuses %s sessions', async sessions => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), sessions })
                .expect(400);

            expect(response.body.error.details).toHaveProperty('sessions');
        });

        it('refuses a type outside the allowed set', async () => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), type: 'sideways' })
                .expect(400);

            expect(response.body.error.details.type).toEqual([
                'Type must be either "build" or "quit"',
            ]);
        });

        it.each([
            ['an unknown kind', { kind: 'monthly' }],
            ['no days', { kind: 'weekdays', days: [] }],
            ['a day past Sunday', { kind: 'weekdays', days: [8] }],
            ['a repeated day', { kind: 'weekdays', days: [2, 2] }],
            ['eight times a week', { kind: 'weekly', times: 8 }],
            ['no times', { kind: 'weekly' }],
        ])('refuses a frequency with %s', async (_name, frequency) => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), frequency })
                .expect(400);

            expect(Object.keys(response.body.error.details).some(key => key.startsWith('frequency'))).toBe(true);
        });

        it.each([
            ['a target of zero', { value: 0, unit: 'km' }],
            ['a negative target', { value: -1, unit: 'km' }],
            ['a target past the limit', { value: 10_001, unit: 'km' }],
            ['two decimals', { value: 1.25, unit: 'km' }],
            ['no unit', { value: 5, unit: ' ' }],
            ['a unit that is too long', { value: 5, unit: 'x'.repeat(21) }],
        ])('refuses %s', async (_name, target) => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), target })
                .expect(400);

            expect(Object.keys(response.body.error.details).some(key => key.startsWith('target'))).toBe(true);
        });

        it('reports a failure inside a step at its own path', async () => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), steps: [{ title: 'ok' }, { title: '' }] })
                .expect(400);

            // Passed as an array so Jest treats the dots as part of the key
            // rather than as a lookup path into the object.
            expect(response.body.error.details).toHaveProperty(['steps.1.title']);
        });

        it('requires a session', async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            await write(stranger, 'post', '/auth/logout').expect(200);

            await stranger.agent.post('/habits/').send(validHabit()).expect(401);
        });
    });

    describe('ownership', () => {
        it("does not let one user read another user's habit", async () => {
            const habit = await createHabit(client);
            const stranger = await signUp({ email: 'stranger@example.com' });

            await stranger.agent.get(`/habits/${habit._id}`).expect(404);
        });

        it("does not let one user delete another user's habit", async () => {
            const habit = await createHabit(client);
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'delete', `/habits/${habit._id}`).expect(404);
            await client.agent.get(`/habits/${habit._id}`).expect(200);
        });

        it("does not let one user mark another user's habit", async () => {
            const habit = await createHabit(client);
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'done' })
                .expect(404);
        });

        it("lists only the requesting user's habits", async () => {
            await createHabit(client);
            const stranger = await signUp({ email: 'stranger@example.com' });

            const response = await stranger.agent.get('/habits/').expect(200);

            expect(response.body.data.habits).toEqual([]);
        });

        it("does not show another user's habit on a day", async () => {
            await createHabit(client);
            const stranger = await signUp({ email: 'stranger@example.com' });
            await createHabit(stranger, { title: 'Not yours' });

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.habits.map((habit: { title: string }) => habit.title)).toEqual(['Read daily']);
        });
    });

    describe('GET /habits/:id', () => {
        it('refuses an id that is not an ObjectId', async () => {
            const response = await client.agent.get('/habits/not-an-id').expect(400);

            expect(response.body.error.details.id).toEqual(['Invalid habit ID']);
        });

        it('reports a well-formed id that matches nothing as not found', async () => {
            await client.agent.get('/habits/507f1f77bcf86cd799439011').expect(404);
        });
    });

    describe('GET /habits/daily', () => {
        it('returns the habit with that day worked out', async () => {
            const created = await createHabit(client, { sessions: 3 });

            const habit = await onDay(created._id, 0);

            expect(habit.day).toMatchObject({
                state: 'pending',
                completedSteps: [],
                session: { index: 1, total: 3, title: 'Read daily' },
            });
            expect(habit.progress.done).toBe(0);
        });

        it('omits habits whose schedule has not started', async () => {
            await createHabit(client, { startDate: daysFromToday(5) });

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.habits).toEqual([]);
        });

        it('omits a day past the end of the programme', async () => {
            const created = await createHabit(client, { sessions: 3 });

            expect(await onDay(created._id, 2)).toBeDefined();
            expect(await onDay(created._id, 3)).toBeUndefined();
        });

        it('shows a habit with no end on every day from its start', async () => {
            const { sessions: _unused, ...openEnded } = validHabit();
            const created = (await write(client, 'post', '/habits/').send(openEnded).expect(201)).body.data.habit;

            expect(await onDay(created._id, 400)).toBeDefined();
        });

        it('refuses a date it cannot parse', async () => {
            const response = await client.agent
                .get('/habits/daily?date=not-a-date')
                .expect(400);

            expect(response.body.error.details).toHaveProperty('date');
        });

        /**
         * The contract the client has to hold up: a bare day key names one day,
         * and the entry that comes back is that same day at midnight UTC. Sent
         * as a full instant instead, a local midnight would arrive as the day
         * before — which is how a habit created today came back missing.
         */
        it('answers a bare day key with that exact day', async () => {
            const created = await createHabit(client, { sessions: 3 });

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);
            const habit = response.body.data.habits.find((entry: { _id: string }) => entry._id === created._id);

            expect(habit.day.date).toBe(`${dayKey(0)}T00:00:00.000Z`);
            expect(response.body.data.date).toBe(`${dayKey(0)}T00:00:00.000Z`);
        });

        it('gives neighbouring days their own session', async () => {
            const created = await createHabit(client, { sessions: 3 });

            const today = await onDay(created._id, 0);
            const tomorrow = await onDay(created._id, 1);

            expect(today.day.session.index).toBe(1);
            expect(tomorrow.day.session.index).toBe(2);
        });

        /**
         * `missed` is the server's to say now. A day that is over and was never
         * marked is missed; asked from a client that is still on the day before,
         * it is only pending — otherwise somebody west of Greenwich is told they
         * missed a day they are still living.
         */
        it('calls an unmarked past day missed', async () => {
            const created = await createHabit(client, { startDate: daysFromToday(-1) });

            expect((await onDay(created._id, -1)).day.state).toBe('missed');
        });

        it('believes a client that is a day behind the server', async () => {
            const created = await createHabit(client, { startDate: daysFromToday(-1) });

            expect((await onDay(created._id, -1, -1)).day.state).toBe('pending');
        });

        it('does not believe a client that is further off than a timezone', async () => {
            const created = await createHabit(client, { startDate: daysFromToday(-1) });

            expect((await onDay(created._id, -1, -30)).day.state).toBe('missed');
        });
    });

    describe('PATCH /habits/:id/complete', () => {
        it('marks a scheduled day and counts it', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            const response = await mark(habit._id, 0, 'done').expect(200);

            expect(response.body.data.day.state).toBe('done');
            expect(response.body.data.habit.progress.done).toBe(1);
        });

        it('accepts a full instant for the day, as it always has', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0), status: 'done' })
                .expect(200);

            expect((await onDay(habit._id, 0)).day.state).toBe('done');
        });

        it('marks that day alone', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            await mark(habit._id, 1, 'done').expect(200);

            expect((await onDay(habit._id, 0)).day.state).toBe('pending');
            expect((await onDay(habit._id, 1)).day.state).toBe('done');
            expect((await onDay(habit._id, 2)).day.state).toBe('pending');
        });

        it('refuses a day outside the programme', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            const response = await mark(habit._id, 30, 'done').expect(400);

            expect(response.body.error.message).toBe('The habit is not scheduled on that date');
        });

        /**
         * The state a boolean could not hold. "I did not do this" and "this day
         * has not happened yet" were both `false`, so the verdict could only
         * live in the component that made it and died on the next refetch.
         */
        it('remembers a day the user marked failed', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            await mark(habit._id, 0, 'failed').expect(200);

            expect((await onDay(habit._id, 0)).day.state).toBe('failed');
        });

        it('does not count a failed day as progress', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            const response = await mark(habit._id, 0, 'failed').expect(200);

            expect(response.body.data.habit.progress).toMatchObject({ done: 0, decided: 1, percentage: 0 });
        });

        it('lets a day be taken back to pending', async () => {
            const habit = await createHabit(client, { sessions: 3 });
            await mark(habit._id, 0, 'done').expect(200);

            const response = await mark(habit._id, 0, 'pending').expect(200);

            expect(response.body.data.day.state).toBe('pending');
            expect(await HabitDay.countDocuments()).toBe(0);
        });

        it('refuses a status outside the enum', async () => {
            const habit = await createHabit(client);

            const response = await mark(habit._id, 0, 'skipped').expect(400);

            expect(response.body.error.details).toHaveProperty('status');
        });

        it('requires a status', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0) })
                .expect(400);

            expect(response.body.error.details).toHaveProperty('status');
        });

        it('finishes the programme once every session is behind it', async () => {
            const habit = await createHabit(client, { sessions: 2 });

            await mark(habit._id, 0, 'done').expect(200);
            const response = await mark(habit._id, 1, 'done').expect(200);

            expect(response.body.data.habit.isCompleted).toBe(true);
            expect((await client.agent.get(`/habits/${habit._id}`).expect(200)).body.data.habit.isCompleted).toBe(true);
        });

        it('refuses a habit that is counted rather than marked', async () => {
            const habit = await createHabit(client, { target: { value: 8, unit: 'glasses' } });

            const response = await mark(habit._id, 0, 'done').expect(400);

            expect(response.body.error.message).toBe('This habit is counted, not marked — set its value instead');
        });
    });

    describe('PUT /habits/:id', () => {
        const update = (habitId: string, changes: Record<string, unknown>) =>
            write(client, 'put', `/habits/${habitId}`).send(changes).expect(200);

        it('shortens a programme and keeps what was done', async () => {
            const habit = await createHabit(client, { sessions: 5 });
            await mark(habit._id, 0, 'done').expect(200);
            await mark(habit._id, 1, 'done').expect(200);

            const response = await update(habit._id, { sessions: 3 });

            // Setting the field alone used to leave five scheduled days behind,
            // which stayed completable while being invisible to the day view.
            expect(response.body.data.habit.sessions).toBe(3);
            expect(response.body.data.habit.progress.done).toBe(2);
            expect(await onDay(habit._id, 3)).toBeUndefined();
        });

        it('lengthens a programme', async () => {
            const habit = await createHabit(client, { sessions: 3 });
            await mark(habit._id, 0, 'done').expect(200);

            const response = await update(habit._id, { sessions: 6 });

            expect(response.body.data.habit.sessions).toBe(6);
            expect(response.body.data.habit.endDate).toBe(daysFromToday(5));
            expect((await onDay(habit._id, 0)).day.state).toBe('done');
            expect((await onDay(habit._id, 5)).day.session.title).toBe('Read daily');
        });

        it('will not give a habit with no end a length', async () => {
            const { sessions: _unused, ...openEnded } = validHabit();
            const habit = (await write(client, 'post', '/habits/').send(openEnded).expect(201)).body.data.habit;

            const response = await write(client, 'put', `/habits/${habit._id}`).send({ sessions: 10 }).expect(400);

            expect(response.body.error.message).toBe('A habit with no end cannot be given a length');
        });

        it('shifts every date when the start moves, keeping progress', async () => {
            const habit = await createHabit(client, { sessions: 3 });
            await mark(habit._id, 0, 'done').expect(200);

            const response = await update(habit._id, { startDate: daysFromToday(10) });

            expect(response.body.data.habit.startDate).toBe(daysFromToday(10));
            expect(response.body.data.habit.endDate).toBe(daysFromToday(12));
            // Session one of the plan is still session one, and still done.
            expect((await onDay(habit._id, 10)).day.state).toBe('done');
            expect(await onDay(habit._id, 0)).toBeUndefined();
        });

        it('leaves the programme alone when neither the start nor the length changes', async () => {
            const habit = await createHabit(client, { sessions: 4 });
            await mark(habit._id, 0, 'done').expect(200);
            await mark(habit._id, 1, 'done').expect(200);

            const response = await update(habit._id, { title: 'Renamed' });

            expect(response.body.data.habit.title).toBe('Renamed');
            expect(response.body.data.habit.sessions).toBe(4);
            expect(response.body.data.habit.progress.done).toBe(2);
        });

        it('carries a rename into the sessions still titled after the habit', async () => {
            const habit = await createHabit(client, { sessions: 3 });
            await write(client, 'patch', `/habits/${habit._id}/day`)
                .send({ session: 2, title: 'Read one chapter' })
                .expect(200);

            await update(habit._id, { title: 'Read every evening' });

            const titles = await Promise.all(
                [0, 1, 2].map(async offset => (await onDay(habit._id, offset)).day.session.title),
            );
            // The two defaulted sessions follow the rename; the one written by hand stays.
            expect(titles).toEqual(['Read every evening', 'Read one chapter', 'Read every evening']);
        });

        it('changes the part of the day', async () => {
            const habit = await createHabit(client);

            const response = await update(habit._id, { timeOfDay: 'evening' });

            expect(response.body.data.habit.timeOfDay).toBe('evening');
        });

        it('refuses an update that changes nothing', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'put', `/habits/${habit._id}`)
                .send({})
                .expect(400);

            expect(response.body.error.message).toBe('Provide at least one field to update');
        });

        describe('changing the rhythm', () => {
            it('starts a new rule today and keeps the old one for the past', async () => {
                const habit = await createHabit(client, { startDate: daysFromToday(-1), sessions: undefined });

                const response = await update(habit._id, { frequency: { kind: 'weekly', times: 3 } });

                const { rules, frequency } = response.body.data.habit;
                expect(frequency).toEqual({ kind: 'weekly', times: 3 });
                expect(rules).toHaveLength(2);
                expect(rules[0].frequency).toEqual({ kind: 'daily' });
                expect(rules[1].effectiveFrom).toBe(daysFromToday(0));
            });

            it('replaces the rule of the same day instead of stacking another', async () => {
                const habit = await createHabit(client, { startDate: daysFromToday(-1), sessions: undefined });
                await update(habit._id, { frequency: { kind: 'weekly', times: 3 } });

                const response = await update(habit._id, { frequency: { kind: 'weekly', times: 4 } });

                expect(response.body.data.habit.rules).toHaveLength(2);
                expect(response.body.data.habit.frequency).toEqual({ kind: 'weekly', times: 4 });
            });

            it('records nothing when the rhythm does not change', async () => {
                const habit = await createHabit(client);

                const response = await update(habit._id, { frequency: { kind: 'daily' } });

                expect(response.body.data.habit.rules).toHaveLength(1);
            });

            it('takes a target away with null and keeps the rhythm', async () => {
                const habit = await createHabit(client, { target: { value: 8, unit: 'glasses' } });

                const response = await update(habit._id, { target: null });

                expect(response.body.data.habit.target).toBeUndefined();
                expect(response.body.data.habit.frequency).toEqual({ kind: 'daily' });
            });

            it('keeps a start in the future as the day the first rule takes effect', async () => {
                const habit = await createHabit(client, { startDate: daysFromToday(5) });

                const response = await update(habit._id, { frequency: { kind: 'weekly', times: 2 } });

                expect(response.body.data.habit.rules).toHaveLength(1);
                expect(response.body.data.habit.rules[0].effectiveFrom).toBe(daysFromToday(5));
            });
        });
    });

    describe('PATCH /habits/:id/day', () => {
        const rename = (habitId: string, body: Record<string, unknown>) =>
            write(client, 'patch', `/habits/${habitId}/day`).send(body);

        it('renames a session of the programme', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            await rename(habit._id, { session: 2, title: 'Read one chapter' }).expect(200);

            expect((await onDay(habit._id, 1)).day.session.title).toBe('Read one chapter');
        });

        it('refuses a session the programme does not have', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            await rename(habit._id, { session: 4, title: 'Too far' }).expect(400);
        });

        it('has nothing to rename on a habit with no end', async () => {
            const { sessions: _unused, ...openEnded } = validHabit();
            const habit = (await write(client, 'post', '/habits/').send(openEnded).expect(201)).body.data.habit;

            await rename(habit._id, { session: 1, title: 'Nope' }).expect(400);
        });

        it('requires a title', async () => {
            const habit = await createHabit(client);

            await rename(habit._id, { session: 1, title: ' ' }).expect(400);
        });
    });

    describe('streak', () => {
        it('counts a day done today', async () => {
            const habit = await createHabit(client, { sessions: 3 });

            const response = await mark(habit._id, 0, 'done').expect(200);

            expect(response.body.data.habit.currentStreak).toBe(1);
            expect(response.body.data.habit.streakUnit).toBe('day');
        });

        it('does not count a day that today has not reached', async () => {
            const habit = await createHabit(client, { sessions: 5 });

            const response = await mark(habit._id, 3, 'done').expect(200);

            expect(response.body.data.habit.currentStreak).toBe(0);
        });

        it('drops back when a completion is undone', async () => {
            const habit = await createHabit(client, { sessions: 3 });
            await mark(habit._id, 0, 'done').expect(200);

            const response = await mark(habit._id, 0, 'pending').expect(200);

            expect(response.body.data.habit.currentStreak).toBe(0);
        });

        /**
         * Today's grace covers a day not yet decided. Saying outright that you
         * failed it is a decision, and it ends the run.
         */
        it('ends the run when today is marked failed', async () => {
            const habit = await createHabit(client, { sessions: 3 });
            await mark(habit._id, 0, 'done').expect(200);

            const response = await mark(habit._id, 0, 'failed').expect(200);

            expect(response.body.data.habit.currentStreak).toBe(0);
        });

        it('is worked out when read, not trusted from the last write', async () => {
            const habit = await createHabit(client, { startDate: daysFromToday(-1), sessions: undefined });
            await mark(habit._id, -1, 'done').expect(200);
            // Yesterday done, today undecided: the run is alive.
            expect((await client.agent.get(`/habits/${habit._id}`)).body.data.habit.currentStreak).toBe(1);

            await mark(habit._id, 0, 'failed').expect(200);

            expect((await client.agent.get(`/habits/${habit._id}`)).body.data.habit.currentStreak).toBe(0);
        });
    });

    describe('PATCH /habits/:id/steps/:stepId', () => {
        const tick = (habitId: string, stepId: string, date = dayKey(0)) =>
            write(client, 'patch', `/habits/${habitId}/steps/${stepId}`).send({ date });

        it('flips a step on the given day and reports its new state', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Open the book' }, { title: 'Read' }] });
            const stepId = habit.steps[0]._id;

            const first = await tick(habit._id, stepId).expect(200);
            expect(first.body.data.completed).toBe(true);
            expect(first.body.data.day.completedSteps).toEqual([stepId]);

            const second = await tick(habit._id, stepId).expect(200);
            expect(second.body.data.completed).toBe(false);
            expect(second.body.data.day.completedSteps).toEqual([]);
            expect(await HabitDay.countDocuments()).toBe(0);
        });

        /**
         * A single flag per habit meant a step ticked on Monday stayed ticked
         * for the rest of the run — a daily checklist you could fill in once.
         */
        it('keeps every day to its own ticks', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Open the book' }, { title: 'Read' }] });

            await tick(habit._id, habit.steps[0]._id, dayKey(0)).expect(200);

            expect((await onDay(habit._id, 0)).day.completedSteps).toHaveLength(1);
            expect((await onDay(habit._id, 1)).day.completedSteps).toEqual([]);
        });

        it('does the day once its last step is ticked', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Open the book' }, { title: 'Read' }] });

            await tick(habit._id, habit.steps[0]._id).expect(200);
            const response = await tick(habit._id, habit.steps[1]._id).expect(200);

            expect(response.body.data.day.state).toBe('done');
            expect(response.body.data.habit.currentStreak).toBe(1);
        });

        it('leaves a day the user already marked as they marked it', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Read' }] });
            await mark(habit._id, 0, 'failed').expect(200);

            const response = await tick(habit._id, habit.steps[0]._id).expect(200);

            expect(response.body.data.day.state).toBe('failed');
        });

        it('refuses a day outside the programme', async () => {
            const habit = await createHabit(client, { sessions: 3, steps: [{ title: 'Read' }] });

            await tick(habit._id, habit.steps[0]._id, dayKey(10)).expect(400);
        });

        it('requires the day', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Read' }] });

            await write(client, 'patch', `/habits/${habit._id}/steps/${habit.steps[0]._id}`)
                .send({})
                .expect(400);
        });

        it('reports a step that does not belong to the habit as not found', async () => {
            const habit = await createHabit(client);

            await tick(habit._id, '507f1f77bcf86cd799439011').expect(404);
        });

        it('shows the day view each day its own ticks', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Read' }] });
            await tick(habit._id, habit.steps[0]._id).expect(200);

            expect((await onDay(habit._id, 0)).day.completedSteps).toEqual([habit.steps[0]._id]);
            expect((await onDay(habit._id, 1)).day.completedSteps).toEqual([]);
        });
    });

    describe('editing steps', () => {
        const update = (habitId: string, changes: Record<string, unknown>) =>
            write(client, 'put', `/habits/${habitId}`).send(changes).expect(200);

        const tickToday = (habitId: string, stepId: string) =>
            write(client, 'patch', `/habits/${habitId}/steps/${stepId}`)
                .send({ date: dayKey(0) })
                .expect(200);

        it('keeps the ticks of a step renamed under its own id', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Stretch' }] });
            const stepId = habit.steps[0]._id;
            await tickToday(habit._id, stepId);

            const response = await update(habit._id, { steps: [{ _id: stepId, title: 'Stretch 10 minutes' }] });

            expect(response.body.data.habit.steps).toEqual([{ _id: stepId, title: 'Stretch 10 minutes' }]);
            expect((await onDay(habit._id, 0)).day.completedSteps).toEqual([stepId]);
        });

        it('drops the ticks of a step that was removed', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Stretch' }, { title: 'Water' }] });
            await tickToday(habit._id, habit.steps[0]._id);

            await update(habit._id, { steps: [{ _id: habit.steps[1]._id, title: 'Water' }] });

            expect((await onDay(habit._id, 0)).day.completedSteps).toEqual([]);
            // A day left with nothing on it is not kept.
            expect(await HabitDay.countDocuments()).toBe(0);
        });

        it('does not trust an id the habit never had', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Stretch' }] });
            const foreign = '507f1f77bcf86cd799439011';

            const response = await update(habit._id, { steps: [{ _id: foreign, title: 'Stretch' }] });

            expect(response.body.data.habit.steps[0]._id).not.toBe(foreign);
        });

        it('refuses more than twenty steps', async () => {
            const habit = await createHabit(client);
            const many = Array.from({ length: 21 }, (_unused, index) => ({ title: `Step ${index}` }));

            await write(client, 'put', `/habits/${habit._id}`).send({ steps: many }).expect(400);
        });
    });

    describe('GET /habits', () => {
        it('shows each habit its own progress', async () => {
            const first = await createHabit(client, { title: 'First', sessions: 3 });
            await createHabit(client, { title: 'Second', sessions: 3 });
            await mark(first._id, 0, 'done').expect(200);

            const response = await client.agent.get('/habits/').expect(200);
            const byTitle = Object.fromEntries(
                response.body.data.habits.map((habit: { title: string }) => [habit.title, habit]),
            );

            expect(byTitle.First.progress.done).toBe(1);
            expect(byTitle.Second.progress.done).toBe(0);
        });
    });

    describe('DELETE /habits/:id', () => {
        it('removes the habit and returns its id', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'delete', `/habits/${habit._id}`).expect(200);

            expect(response.body.data.habitId).toBe(habit._id);

            await client.agent.get(`/habits/${habit._id}`).expect(404);
        });

        it('takes the days of the habit with it', async () => {
            const habit = await createHabit(client);
            await mark(habit._id, 0, 'done').expect(200);
            expect(await HabitDay.countDocuments()).toBe(1);

            await write(client, 'delete', `/habits/${habit._id}`).expect(200);

            expect(await HabitDay.countDocuments()).toBe(0);
        });

        it("leaves another habit's days alone", async () => {
            const kept = await createHabit(client, { title: 'Kept' });
            const gone = await createHabit(client, { title: 'Gone' });
            await mark(kept._id, 0, 'done').expect(200);
            await mark(gone._id, 0, 'done').expect(200);

            await write(client, 'delete', `/habits/${gone._id}`).expect(200);

            expect(await HabitDay.countDocuments()).toBe(1);
        });
    });
});
