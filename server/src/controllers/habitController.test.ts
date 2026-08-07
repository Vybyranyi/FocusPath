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
    duration: 5,
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

    describe('POST /habits/', () => {
        it('generates one scheduled day per day of the duration', async () => {
            const habit = await createHabit(client, { duration: 7 });

            expect(habit.dailyCompletions).toHaveLength(7);
            expect(
                habit.dailyCompletions.every((day: { status: string }) => day.status === 'pending'),
            ).toBe(true);
            expect(habit.currentStreak).toBe(0);
        });

        it('never exposes the owner link', async () => {
            const habit = await createHabit(client);

            expect(habit).not.toHaveProperty('userId');
            expect(habit).not.toHaveProperty('__v');
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

        it.each([0, 366, 1.5])('refuses a duration of %s', async duration => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), duration })
                .expect(400);

            expect(response.body.error.details).toHaveProperty('duration');
        });

        it('refuses a type outside the allowed set', async () => {
            const response = await write(client, 'post', '/habits/')
                .send({ ...validHabit(), type: 'sideways' })
                .expect(400);

            expect(response.body.error.details.type).toEqual([
                'Type must be either "build" or "quit"',
            ]);
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

        it("lists only the requesting user's habits", async () => {
            await createHabit(client);
            const stranger = await signUp({ email: 'stranger@example.com' });

            const response = await stranger.agent.get('/habits/').expect(200);

            expect(response.body.data.habits).toEqual([]);
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
        it('returns the entry for the requested day', async () => {
            await createHabit(client, { duration: 3 });

            const response = await client.agent
                .get(`/habits/daily?date=${daysFromToday(0).slice(0, 10)}`)
                .expect(200);

            expect(response.body.data.habits).toHaveLength(1);
            expect(response.body.data.habits[0].dayInfo).toMatchObject({ status: 'pending' });
            expect(response.body.data.habits[0].completedCount).toBe(0);
        });

        it('omits habits whose schedule has not started', async () => {
            await createHabit(client, { startDate: daysFromToday(5) });

            const response = await client.agent
                .get(`/habits/daily?date=${daysFromToday(0).slice(0, 10)}`)
                .expect(200);

            expect(response.body.data.habits).toEqual([]);
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
            await createHabit(client, { duration: 3 });

            const response = await client.agent
                .get(`/habits/daily?date=${dayKey(0)}`)
                .expect(200);

            expect(response.body.data.habits[0].dayInfo.date).toBe(`${dayKey(0)}T00:00:00.000Z`);
            expect(response.body.data.date).toBe(`${dayKey(0)}T00:00:00.000Z`);
        });

        it('gives neighbouring days their own entries', async () => {
            await createHabit(client, { duration: 3 });

            const today = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);
            const tomorrow = await client.agent.get(`/habits/daily?date=${dayKey(1)}`).expect(200);

            expect(today.body.data.habits[0].dayInfo.date).not.toBe(
                tomorrow.body.data.habits[0].dayInfo.date,
            );
            expect(today.body.data.habits[0].dayInfo._id).not.toBe(
                tomorrow.body.data.habits[0].dayInfo._id,
            );
        });
    });

    describe('PATCH /habits/:id/complete', () => {
        it('marks a scheduled day and counts it', async () => {
            const habit = await createHabit(client, { duration: 3 });

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0), status: 'done' })
                .expect(200);

            const done = response.body.data.habit.dailyCompletions.filter(
                (day: { status: string }) => day.status === 'done',
            );
            expect(done).toHaveLength(1);
        });

        it('accepts a bare day key and marks that day alone', async () => {
            const habit = await createHabit(client, { duration: 3 });

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(1), status: 'done' })
                .expect(200);

            const days = response.body.data.habit.dailyCompletions;
            expect(days.map((day: { status: string }) => day.status)).toEqual([
                'pending',
                'done',
                'pending',
            ]);
        });

        it('refuses a day outside the schedule', async () => {
            const habit = await createHabit(client, { duration: 3 });

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(30), status: 'done' })
                .expect(400);

            expect(response.body.error.message).toBe('Date is outside habit duration');
        });

        /**
         * The state a boolean could not hold. "I did not do this" and "this day
         * has not happened yet" were both `false`, so the verdict could only
         * live in the component that made it and died on the next refetch.
         */
        it('remembers a day the user marked failed', async () => {
            const habit = await createHabit(client, { duration: 3 });

            await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'failed' })
                .expect(200);

            const response = await client.agent
                .get(`/habits/daily?date=${dayKey(0)}`)
                .expect(200);

            expect(response.body.data.habits[0].dayInfo.status).toBe('failed');
        });

        it('does not count a failed day as progress', async () => {
            const habit = await createHabit(client, { duration: 3 });

            await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'failed' })
                .expect(200);

            const response = await client.agent
                .get(`/habits/daily?date=${dayKey(0)}`)
                .expect(200);

            expect(response.body.data.habits[0].completedCount).toBe(0);
        });

        it('lets a day be taken back to pending', async () => {
            const habit = await createHabit(client, { duration: 3 });

            await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'done' })
                .expect(200);

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'pending' })
                .expect(200);

            expect(response.body.data.habit.dailyCompletions[0].status).toBe('pending');
        });

        it('refuses a status outside the enum', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'skipped' })
                .expect(400);

            expect(response.body.error.details).toHaveProperty('status');
        });

        it('requires a status', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0) })
                .expect(400);

            expect(response.body.error.details).toHaveProperty('status');
        });

        it('marks the habit complete once every day is done', async () => {
            const habit = await createHabit(client, { duration: 2 });

            for (const offset of [0, 1]) {
                await write(client, 'patch', `/habits/${habit._id}/complete`)
                    .send({ date: daysFromToday(offset), status: 'done' })
                    .expect(200);
            }

            const response = await client.agent.get(`/habits/${habit._id}`).expect(200);

            expect(response.body.data.habit.isCompleted).toBe(true);
        });
    });

    describe('PUT /habits/:id', () => {
        /** Marks the first `count` days of the plan as done. */
        const completeFirstDays = async (habitId: string, count: number) => {
            for (let offset = 0; offset < count; offset++) {
                await write(client, 'patch', `/habits/${habitId}/complete`)
                    .send({ date: daysFromToday(offset), status: 'done' })
                    .expect(200);
            }
        };

        const update = (habitId: string, changes: Record<string, unknown>) =>
            write(client, 'put', `/habits/${habitId}`).send(changes).expect(200);

        it('rebuilds the plan when the duration is shortened', async () => {
            const habit = await createHabit(client, { duration: 5 });
            await completeFirstDays(habit._id, 2);

            const response = await update(habit._id, { duration: 3 });

            // Setting the field alone used to leave five scheduled days behind,
            // which stayed completable while being invisible to the day view.
            expect(response.body.data.habit.dailyCompletions).toHaveLength(3);
            expect(
                response.body.data.habit.dailyCompletions
                    .slice(0, 2)
                    .every((day: { status: string }) => day.status === 'done'),
            ).toBe(true);
        });

        it('rebuilds the plan when the duration is extended', async () => {
            const habit = await createHabit(client, { duration: 3 });
            await completeFirstDays(habit._id, 1);

            const response = await update(habit._id, { duration: 6 });

            expect(response.body.data.habit.dailyCompletions).toHaveLength(6);
            expect(response.body.data.habit.dailyCompletions[0].status).toBe('done');
            expect(response.body.data.habit.dailyCompletions[5].status).toBe('pending');
        });

        it('shifts every scheduled date when the start moves, keeping progress', async () => {
            const habit = await createHabit(client, { duration: 3 });
            await completeFirstDays(habit._id, 1);

            const response = await update(habit._id, { startDate: daysFromToday(10) });

            const dates = response.body.data.habit.dailyCompletions.map(
                (day: { date: string }) => day.date.slice(0, 10),
            );
            expect(dates[0]).toBe(daysFromToday(10).slice(0, 10));
            expect(dates[2]).toBe(daysFromToday(12).slice(0, 10));
            // Day one of the plan is still day one, and still done.
            expect(response.body.data.habit.dailyCompletions[0].status).toBe('done');
        });

        it('leaves the plan alone when neither the start nor the length changes', async () => {
            const habit = await createHabit(client, { duration: 4 });
            await completeFirstDays(habit._id, 2);

            const response = await update(habit._id, { title: 'Renamed' });

            expect(response.body.data.habit.title).toBe('Renamed');
            expect(response.body.data.habit.dailyCompletions).toHaveLength(4);
            expect(response.body.data.habit.dailyCompletions[1].status).toBe('done');
        });

        it('refuses an update that changes nothing', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'put', `/habits/${habit._id}`)
                .send({})
                .expect(400);

            expect(response.body.error.message).toBe('Provide at least one field to update');
        });
    });

    describe('streak', () => {
        it('counts a day done today', async () => {
            const habit = await createHabit(client, { duration: 3 });

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0), status: 'done' })
                .expect(200);

            expect(response.body.data.habit.currentStreak).toBe(1);
        });

        it('does not count a day of the plan that today has not reached', async () => {
            const habit = await createHabit(client, { duration: 5 });

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(3), status: 'done' })
                .expect(200);

            expect(response.body.data.habit.currentStreak).toBe(0);
        });

        it('drops back when a completion is undone', async () => {
            const habit = await createHabit(client, { duration: 3 });

            await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0), status: 'done' })
                .expect(200);

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: daysFromToday(0), status: 'pending' })
                .expect(200);

            expect(response.body.data.habit.currentStreak).toBe(0);
        });

        /**
         * Today's grace covers a day not yet decided. Saying outright that you
         * failed it is a decision, and it ends the run.
         */
        it('ends the run when today is marked failed', async () => {
            const habit = await createHabit(client, { duration: 3 });

            await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'done' })
                .expect(200);

            const response = await write(client, 'patch', `/habits/${habit._id}/complete`)
                .send({ date: dayKey(0), status: 'failed' })
                .expect(200);

            expect(response.body.data.habit.currentStreak).toBe(0);
        });
    });

    describe('PATCH /habits/:id/steps/:stepId', () => {
        it('flips a step and reports its new state', async () => {
            const habit = await createHabit(client, { steps: [{ title: 'Open the book' }] });
            const stepId = habit.steps[0]._id;

            const first = await write(
                client,
                'patch',
                `/habits/${habit._id}/steps/${stepId}`,
            ).expect(200);
            expect(first.body.data.completed).toBe(true);

            const second = await write(
                client,
                'patch',
                `/habits/${habit._id}/steps/${stepId}`,
            ).expect(200);
            expect(second.body.data.completed).toBe(false);
        });

        it('reports a step that does not belong to the habit as not found', async () => {
            const habit = await createHabit(client);

            await write(
                client,
                'patch',
                `/habits/${habit._id}/steps/507f1f77bcf86cd799439011`,
            ).expect(404);
        });
    });

    describe('DELETE /habits/:id', () => {
        it('removes the habit and returns its id', async () => {
            const habit = await createHabit(client);

            const response = await write(client, 'delete', `/habits/${habit._id}`).expect(200);

            expect(response.body.data.habitId).toBe(habit._id);

            await client.agent.get(`/habits/${habit._id}`).expect(404);
        });
    });
});
