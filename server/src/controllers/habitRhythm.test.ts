import Habit from '@models/Habit';
import HabitDay from '@models/HabitDay';
import { signUp, type Client } from '../testUtils';

const todayUtc = () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
};

const dayKey = (offset: number) => {
    const date = todayUtc();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};

const write = (client: Client, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

describe('Habit rhythm, quantity, pauses and rest days', () => {
    let client: Client;

    beforeEach(async () => {
        client = await signUp();
    });

    const createHabit = async (overrides: Record<string, unknown> = {}) =>
        (await write(client, 'post', '/habits/')
            .send({
                title: 'Drink water',
                startDate: dayKey(0),
                sessions: 10,
                type: 'build',
                color: 'blue',
                icon: 'droplet',
                ...overrides,
            })
            .expect(201)).body.data.habit;

    const onDay = async (habitId: string, offset: number) => {
        const response = await client.agent.get(`/habits/daily?date=${dayKey(offset)}`).expect(200);
        return response.body.data.habits.find((habit: { _id: string }) => habit._id === habitId);
    };

    const mark = (habitId: string, offset: number, status = 'done') =>
        write(client, 'patch', `/habits/${habitId}/complete`).send({ date: dayKey(offset), status });

    const setValue = (habitId: string, offset: number, value: number) =>
        write(client, 'patch', `/habits/${habitId}/value`).send({ date: dayKey(offset), value });

    describe('a habit with a target', () => {
        const glasses = { value: 8, unit: 'glasses' };

        it('is done once a build day reaches the target', async () => {
            const habit = await createHabit({ target: glasses });

            const below = await setValue(habit._id, 0, 5).expect(200);
            expect(below.body.data.day).toMatchObject({ state: 'pending', value: 5, target: glasses });

            const reached = await setValue(habit._id, 0, 8).expect(200);
            expect(reached.body.data.day.state).toBe('done');
            expect(reached.body.data.habit.currentStreak).toBe(1);
            expect(reached.body.data.habit.progress.done).toBe(1);
        });

        it('takes a day back to nothing, and keeps no record of it', async () => {
            const habit = await createHabit({ target: glasses });
            await setValue(habit._id, 0, 3).expect(200);

            const response = await setValue(habit._id, 0, 0).expect(200);

            expect(response.body.data.day.value).toBeUndefined();
            expect(await HabitDay.countDocuments()).toBe(0);
        });

        it('lets a day hold one decimal place', async () => {
            const habit = await createHabit({ target: { value: 5, unit: 'km' } });

            const response = await setValue(habit._id, 0, 2.5).expect(200);

            expect(response.body.data.day.value).toBe(2.5);
        });

        it.each([-1, 10_001, 1.25])('refuses a value of %s', async value => {
            const habit = await createHabit({ target: glasses });

            const response = await setValue(habit._id, 0, value).expect(400);

            expect(response.body.error.details).toHaveProperty('value');
        });

        it('refuses a habit that has no target', async () => {
            const habit = await createHabit();

            const response = await setValue(habit._id, 0, 3).expect(400);

            expect(response.body.error.message).toBe('This habit has no target to count towards');
        });

        it('refuses a day outside the programme', async () => {
            const habit = await createHabit({ target: glasses, sessions: 3 });

            await setValue(habit._id, 20, 8).expect(400);
        });

        it('does not let a checklist finish a counted day', async () => {
            const habit = await createHabit({ target: glasses, steps: [{ title: 'Fill the bottle' }] });

            const response = await write(client, 'patch', `/habits/${habit._id}/steps/${habit.steps[0]._id}`)
                .send({ date: dayKey(0) })
                .expect(200);

            expect(response.body.data.day.state).toBe('pending');
        });

        describe('when it is a limit to quit', () => {
            const cigarettes = { value: 5, unit: 'cigarettes' };

            it('keeps a day within the limit pending until the day is over', async () => {
                const habit = await createHabit({ type: 'quit', target: cigarettes });

                const response = await setValue(habit._id, 0, 3).expect(200);

                expect(response.body.data.day.state).toBe('pending');
            });

            it('fails the day the moment the limit is passed', async () => {
                const habit = await createHabit({ type: 'quit', target: cigarettes });

                const response = await setValue(habit._id, 0, 6).expect(200);

                expect(response.body.data.day.state).toBe('failed');
                expect(response.body.data.habit.currentStreak).toBe(0);
            });

            /** A clean day has to be said — until it is, the day is just missed. */
            it('records a clean day as a value of zero', async () => {
                const habit = await createHabit({ type: 'quit', target: cigarettes });

                const response = await setValue(habit._id, 0, 0).expect(200);

                expect(response.body.data.day.value).toBe(0);
                expect(await HabitDay.countDocuments()).toBe(1);
            });

            it('counts a day within the limit once it is over', async () => {
                const habit = await createHabit({ type: 'quit', target: cigarettes, startDate: dayKey(-1) });
                await setValue(habit._id, -1, 4).expect(200);

                const yesterday = await onDay(habit._id, -1);

                expect(yesterday.day.state).toBe('done');
                expect(yesterday.currentStreak).toBe(1);
            });
        });
    });

    describe('a habit on chosen weekdays', () => {
        it('is on the day view only on those days', async () => {
            // Every weekday but today's: on the week's other six days it shows up.
            const today = ((todayUtc().getUTCDay() + 6) % 7) + 1;
            const others = [1, 2, 3, 4, 5, 6, 7].filter(day => day !== today);
            const habit = await createHabit({ sessions: undefined, frequency: { kind: 'weekdays', days: others } });

            expect(await onDay(habit._id, 0)).toBeUndefined();
            expect(await onDay(habit._id, 1)).toBeDefined();
        });

        it('numbers sessions by scheduled days only', async () => {
            const tomorrow = (((todayUtc().getUTCDay() + 1) % 7 + 6) % 7) + 1;
            const habit = await createHabit({ frequency: { kind: 'weekdays', days: [tomorrow] }, sessions: 4 });

            expect((await onDay(habit._id, 1)).day.session.index).toBe(1);
            expect((await onDay(habit._id, 8)).day.session.index).toBe(2);
            expect(await onDay(habit._id, 2)).toBeUndefined();
        });

        it('refuses to mark a day it is not scheduled on', async () => {
            const today = ((todayUtc().getUTCDay() + 6) % 7) + 1;
            const habit = await createHabit({
                sessions: undefined,
                frequency: { kind: 'weekdays', days: [today === 7 ? 1 : today + 1] },
            });

            const response = await mark(habit._id, 0).expect(400);

            expect(response.body.error.message).toBe('The habit is not scheduled on that date');
        });
    });

    describe('a habit a number of times a week', () => {
        const weekly = (times: number) => ({ frequency: { kind: 'weekly', times }, sessions: undefined });

        it('shows on every day, with how the week stands', async () => {
            const habit = await createHabit(weekly(3));

            const shown = await onDay(habit._id, 0);

            expect(shown.day.week).toEqual({ done: 0, target: 3 });
            expect(shown.streakUnit).toBe('week');
        });

        it('counts a day done towards the week', async () => {
            const habit = await createHabit(weekly(3));

            const response = await mark(habit._id, 0).expect(200);

            expect(response.body.data.day.week).toEqual({ done: 1, target: 3 });
        });

        it('does not call an unmarked day missed', async () => {
            const habit = await createHabit({ ...weekly(3), startDate: dayKey(-1) });

            expect((await onDay(habit._id, -1)).day.state).toBe('pending');
        });

        it('takes no more days once the week is met', async () => {
            // A week of one is met by a single day, whichever day it is.
            const habit = await createHabit(weekly(1));
            await mark(habit._id, 0).expect(200);

            const response = await mark(habit._id, 1).expect(400);

            expect(response.body.error.message).toBe('The weekly target is already reached');
        });

        it('still lets the day that met the week be taken back', async () => {
            const habit = await createHabit(weekly(1));
            await mark(habit._id, 0).expect(200);

            const response = await mark(habit._id, 0, 'pending').expect(200);

            expect(response.body.data.day.week).toEqual({ done: 0, target: 1 });
        });

        it('counts a streak in weeks', async () => {
            const habit = await createHabit(weekly(1));

            const response = await mark(habit._id, 0).expect(200);

            expect(response.body.data.habit).toMatchObject({ currentStreak: 1, streakUnit: 'week' });
        });

        it('numbers the sessions of a programme within the week', async () => {
            const habit = await createHabit({ frequency: { kind: 'weekly', times: 3 }, sessions: 6 });

            expect((await onDay(habit._id, 0)).day.session).toMatchObject({ index: 1, total: 6 });
            await mark(habit._id, 0).expect(200);
            expect((await onDay(habit._id, 0)).day.session.index).toBe(1);
            expect((await onDay(habit._id, 1)).day.session.index).toBe(2);
        });
    });

    describe('pauses', () => {
        const pause = (habitId: string, body: Record<string, unknown>) =>
            write(client, 'post', `/habits/${habitId}/pauses`).send(body);

        it('turns the days it covers into days that do not count', async () => {
            const habit = await createHabit();

            const response = await pause(habit._id, { from: dayKey(2), to: dayKey(3) }).expect(201);

            expect(response.body.data.habit.pauses).toHaveLength(1);
            expect((await onDay(habit._id, 2)).day.state).toBe('paused');
            expect((await onDay(habit._id, 3)).day.state).toBe('paused');
            expect((await onDay(habit._id, 4)).day.state).toBe('pending');
        });

        it('pushes the end of the programme out by its length', async () => {
            const habit = await createHabit({ sessions: 5 });
            expect(habit.endDate).toBe(`${dayKey(4)}T00:00:00.000Z`);

            const response = await pause(habit._id, { from: dayKey(1), to: dayKey(3) }).expect(201);

            expect(response.body.data.habit.endDate).toBe(`${dayKey(7)}T00:00:00.000Z`);
        });

        it('takes no session for a paused day', async () => {
            const habit = await createHabit({ sessions: 5 });
            await pause(habit._id, { from: dayKey(1), to: dayKey(2) }).expect(201);

            expect((await onDay(habit._id, 3)).day.session.index).toBe(2);
        });

        it('refuses to mark a paused day', async () => {
            const habit = await createHabit();
            await pause(habit._id, { from: dayKey(2), to: dayKey(2) }).expect(201);

            const response = await mark(habit._id, 2).expect(400);

            expect(response.body.error.message).toBe('The habit is paused on that date');
        });

        it('can be left open', async () => {
            const habit = await createHabit({ sessions: undefined });

            const response = await pause(habit._id, { from: dayKey(2) }).expect(201);

            expect(response.body.data.habit.pauses[0].to).toBeUndefined();
            expect((await onDay(habit._id, 30)).day.state).toBe('paused');
        });

        it('cannot begin in the past', async () => {
            const habit = await createHabit();

            const response = await pause(habit._id, { from: dayKey(-3), to: dayKey(2) }).expect(400);

            expect(response.body.error.message).toBe('A pause cannot begin in the past');
        });

        it('cannot end before it starts', async () => {
            const habit = await createHabit();

            const response = await pause(habit._id, { from: dayKey(3), to: dayKey(2) }).expect(400);

            expect(response.body.error.details).toHaveProperty('to');
        });

        it('cannot overlap another pause', async () => {
            const habit = await createHabit();
            await pause(habit._id, { from: dayKey(2), to: dayKey(4) }).expect(201);

            await pause(habit._id, { from: dayKey(4), to: dayKey(6) }).expect(409);
        });

        it('cannot begin on a day that is already marked', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0).expect(200);

            const response = await pause(habit._id, { from: dayKey(0), to: dayKey(2) }).expect(400);

            expect(response.body.error.message).toBe('That day is already marked');
        });

        it('keeps a run alive across the days it covers', async () => {
            const habit = await createHabit({ startDate: dayKey(-1), sessions: undefined });
            await mark(habit._id, -1).expect(200);

            const response = await pause(habit._id, { from: dayKey(0), to: dayKey(3) }).expect(201);

            expect(response.body.data.habit.currentStreak).toBe(1);
        });

        describe('ending one', () => {
            const end = (habitId: string, pauseId: string, to: string) =>
                write(client, 'patch', `/habits/${habitId}/pauses/${pauseId}`).send({ to });

            it('closes an open pause', async () => {
                const habit = await createHabit({ sessions: undefined });
                const opened = await pause(habit._id, { from: dayKey(1) }).expect(201);
                const pauseId = opened.body.data.habit.pauses[0]._id;

                const response = await end(habit._id, pauseId, dayKey(4)).expect(200);

                expect(response.body.data.habit.pauses[0].to).toBe(`${dayKey(4)}T00:00:00.000Z`);
                expect((await onDay(habit._id, 5)).day.state).toBe('pending');
            });

            it('resumes a pause that began days ago, from yesterday on', async () => {
                const habit = await createHabit({ sessions: undefined });
                // Begun five days ago, which no request could have asked for.
                await Habit.updateOne(
                    { _id: habit._id },
                    { $set: { startDate: new Date(`${dayKey(-8)}T00:00:00.000Z`) }, $push: { pauses: { from: new Date(`${dayKey(-5)}T00:00:00.000Z`) } } },
                );
                const pauseId = (await Habit.findById(habit._id))!.pauses[0]._id.toString();

                await end(habit._id, pauseId, dayKey(-1)).expect(200);

                expect((await onDay(habit._id, 0)).day.state).toBe('pending');
                expect((await onDay(habit._id, -2)).day.state).toBe('paused');
            });

            it('does not shorten a pause back into the past', async () => {
                const habit = await createHabit({ sessions: undefined });
                await Habit.updateOne(
                    { _id: habit._id },
                    { $set: { startDate: new Date(`${dayKey(-8)}T00:00:00.000Z`) }, $push: { pauses: { from: new Date(`${dayKey(-5)}T00:00:00.000Z`) } } },
                );
                const pauseId = (await Habit.findById(habit._id))!.pauses[0]._id.toString();

                const response = await end(habit._id, pauseId, dayKey(-3)).expect(400);

                expect(response.body.error.message).toBe('A pause cannot be shortened to before yesterday');
            });

            it('answers NOT_FOUND for a pause the habit does not have', async () => {
                const habit = await createHabit();

                await end(habit._id, '507f1f77bcf86cd799439011', dayKey(3)).expect(404);
            });
        });

        describe('removing one', () => {
            it('takes back a pause that has not begun', async () => {
                const habit = await createHabit();
                const added = await pause(habit._id, { from: dayKey(3), to: dayKey(4) }).expect(201);
                const pauseId = added.body.data.habit.pauses[0]._id;

                const response = await write(client, 'delete', `/habits/${habit._id}/pauses/${pauseId}`).expect(200);

                expect(response.body.data.habit.pauses).toEqual([]);
                expect((await onDay(habit._id, 3)).day.state).toBe('pending');
            });

            it('refuses a pause that has begun', async () => {
                const habit = await createHabit();
                await Habit.updateOne(
                    { _id: habit._id },
                    { $set: { startDate: new Date(`${dayKey(-8)}T00:00:00.000Z`) }, $push: { pauses: { from: new Date(`${dayKey(-5)}T00:00:00.000Z`), to: new Date(`${dayKey(2)}T00:00:00.000Z`) } } },
                );
                const pauseId = (await Habit.findById(habit._id))!.pauses[0]._id.toString();

                const response = await write(client, 'delete', `/habits/${habit._id}/pauses/${pauseId}`).expect(400);

                expect(response.body.error.message).toBe('A pause that has begun cannot be removed — end it instead');
            });
        });

        it("does not touch another user's habit", async () => {
            const habit = await createHabit();
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'post', `/habits/${habit._id}/pauses`)
                .send({ from: dayKey(2), to: dayKey(3) })
                .expect(404);
        });
    });

    describe('rest days', () => {
        const rest = (habitId: string, date: string) =>
            write(client, 'post', `/habits/${habitId}/rest-days`).send({ date });

        it('turns a day into one that does not count', async () => {
            const habit = await createHabit();

            const response = await rest(habit._id, dayKey(2)).expect(201);

            expect(response.body.data.habit.restDays).toEqual([`${dayKey(2)}T00:00:00.000Z`]);
            expect((await onDay(habit._id, 2)).day.state).toBe('rest');
        });

        it('takes no session for the day', async () => {
            const habit = await createHabit({ sessions: 5 });
            await rest(habit._id, dayKey(1)).expect(201);

            expect((await onDay(habit._id, 2)).day.session.index).toBe(2);
        });

        it('refuses to mark a rest day', async () => {
            const habit = await createHabit();
            await rest(habit._id, dayKey(1)).expect(201);

            const response = await mark(habit._id, 1).expect(400);

            expect(response.body.error.message).toBe('That date is a rest day');
        });

        it('allows one a week, not two', async () => {
            const habit = await createHabit();
            await rest(habit._id, dayKey(1)).expect(201);

            const response = await rest(habit._id, dayKey(1)).expect(400);

            expect(response.body.error.message).toBe('Only one rest day a week');
        });

        it('allows one in another week', async () => {
            const habit = await createHabit();
            await rest(habit._id, dayKey(1)).expect(201);

            await rest(habit._id, dayKey(8)).expect(201);
        });

        it('cannot be set in the past', async () => {
            const habit = await createHabit({ startDate: dayKey(-1) });

            const response = await rest(habit._id, dayKey(-3)).expect(400);

            expect(response.body.error.message).toBe('A rest day cannot be set in the past');
        });

        it('cannot be set on a day already marked', async () => {
            const habit = await createHabit();
            await mark(habit._id, 0).expect(200);

            const response = await rest(habit._id, dayKey(0)).expect(400);

            expect(response.body.error.message).toBe('That day is already marked');
        });

        it('is only for a habit scheduled every day', async () => {
            const habit = await createHabit({ frequency: { kind: 'weekly', times: 3 }, sessions: undefined });

            const response = await rest(habit._id, dayKey(1)).expect(400);

            expect(response.body.error.message).toBe('Rest days are only for habits scheduled every day');
        });

        it('cannot be set past the end of the programme', async () => {
            const habit = await createHabit({ sessions: 2 });

            await rest(habit._id, dayKey(9)).expect(400);
        });

        it('can be taken back', async () => {
            const habit = await createHabit();
            await rest(habit._id, dayKey(2)).expect(201);

            const response = await write(client, 'delete', `/habits/${habit._id}/rest-days/${dayKey(2)}`).expect(200);

            expect(response.body.data.habit.restDays).toEqual([]);
            expect((await onDay(habit._id, 2)).day.state).toBe('pending');
        });

        it('answers NOT_FOUND for a day that is not a rest day', async () => {
            const habit = await createHabit();

            await write(client, 'delete', `/habits/${habit._id}/rest-days/${dayKey(2)}`).expect(404);
        });

        it('refuses a date that is not one', async () => {
            const habit = await createHabit();

            await write(client, 'delete', `/habits/${habit._id}/rest-days/tomorrow`).expect(400);
        });

        it('keeps a run alive across the day', async () => {
            const habit = await createHabit({ startDate: dayKey(-1), sessions: undefined });
            await mark(habit._id, -1).expect(200);

            const response = await rest(habit._id, dayKey(0)).expect(201);

            expect(response.body.data.habit.currentStreak).toBe(1);
        });
    });
});
