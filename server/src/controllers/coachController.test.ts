jest.mock('@services/coachAiService', () => ({
    ...jest.requireActual('@services/coachAiService'),
    writeCoachText: jest.fn(),
}));

import CoachCard from '@models/CoachCard';
import Habit from '@models/Habit';
import HabitDay from '@models/HabitDay';
import JournalEntry from '@models/JournalEntry';
import { writeCoachText } from '@services/coachAiService';
import { signUp, validUser, type Client } from '../testUtils';

const mockedWrite = writeCoachText as jest.MockedFunction<typeof writeCoachText>;

const dayAt = (offset: number) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
};

const write = (client: Client, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

const usage = { model: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50 };

const answers = {
    review: { content: { title: 'A good week', body: 'You kept going.', win: 'A streak.', tip: 'Keep Monday.' }, usage },
    insight: { content: { title: 'Mondays', body: 'Mondays go badly.' }, usage },
    recalibration: { content: { title: 'Ease off', body: 'Try a gentler plan.' }, usage },
};

describe('The coach', () => {
    let client: Client;

    beforeEach(async () => {
        mockedWrite.mockReset();
        mockedWrite.mockImplementation(async request =>
            request.kind === 'weekly_review'
                ? answers.review
                : request.kind === 'insight'
                    ? answers.insight
                    : {
                        ...answers.recalibration,
                        tasks: request.rewrite ? request.rewrite.current.map((_t, i) => `Gentler ${i + 1}`) : undefined,
                    },
        );
        client = await signUp();
    });

    /** A habit that has been running for `days` days, with the given days done. */
    const makeHabit = async (days: number, doneOffsets: number[] = [], extra: Record<string, unknown> = {}) => {
        const habit = await Habit.create({
            title: 'Read',
            type: 'build',
            color: 'blue',
            icon: 'books',
            userId: client.userId,
            startDate: dayAt(-days),
            rules: [{ effectiveFrom: dayAt(-days), frequency: { kind: 'daily' } }],
            ...extra,
        });
        for (const offset of doneOffsets) {
            await HabitDay.create({ habitId: habit._id, userId: client.userId, day: dayAt(offset), status: 'done' });
        }
        return habit;
    };

    /** Every day from `from` to -1 done, except the offsets in `except`. */
    const doneThrough = (from: number, except: number[] = []) =>
        Array.from({ length: -from }, (_u, i) => from + i).filter(offset => !except.includes(offset));

    const refresh = () => write(client, 'post', '/coach/refresh');
    const cards = async () => (await client.agent.get('/coach/cards').expect(200)).body.data.cards;

    describe('POST /coach/refresh', () => {
        it('says nothing, and asks no model, when there is nothing to say', async () => {
            const response = await refresh().expect(200);

            expect(response.body.data.cards).toEqual([]);
            expect(mockedWrite).not.toHaveBeenCalled();
        });

        it('says nothing about a habit with under a week behind it', async () => {
            await makeHabit(3, doneThrough(-3));

            const response = await refresh().expect(200);

            expect(response.body.data.cards).toEqual([]);
            expect(mockedWrite).not.toHaveBeenCalled();
        });

        it('reviews the week that has ended', async () => {
            await makeHabit(21, doneThrough(-21));

            const response = await refresh().expect(200);

            const review = response.body.data.cards.find((card: { kind: string }) => card.kind === 'weekly_review');
            expect(review).toMatchObject({
                status: 'ready',
                content: { title: 'A good week' },
                facts: { habits: [{ title: 'Read', percentage: 100 }] },
            });
            expect(review.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        /** Asked again, it finds every card already there — which costs nothing. */
        it('does not review the same week twice', async () => {
            await makeHabit(21, doneThrough(-21));
            await refresh().expect(200);
            const calls = mockedWrite.mock.calls.length;

            const again = await refresh().expect(200);

            expect(again.body.data.cards).toEqual([]);
            expect(mockedWrite).toHaveBeenCalledTimes(calls);
            expect(await CoachCard.countDocuments({ kind: 'weekly_review' })).toBe(1);
        });

        it('lets two refreshes arriving together reach the model only once', async () => {
            await makeHabit(21, doneThrough(-21));

            await Promise.all([refresh(), refresh(), refresh()]);

            expect(await CoachCard.countDocuments({ kind: 'weekly_review' })).toBe(1);
            expect(mockedWrite.mock.calls.filter(([request]) => request.kind === 'weekly_review')).toHaveLength(1);
        });

        it('writes nothing, and keeps no stand-in, when the model is unavailable', async () => {
            await makeHabit(21, doneThrough(-21));
            mockedWrite.mockRejectedValue(new Error('down'));

            const response = await refresh().expect(200);

            expect(response.body.data.cards).toEqual([]);
            const stored = await CoachCard.findOne({ kind: 'weekly_review' });
            expect(stored).toMatchObject({ status: 'failed', attempts: 1 });
            expect(stored?.content).toBeUndefined();
        });

        it('tries a failed review once more, and then gives up', async () => {
            await makeHabit(21, doneThrough(-21));
            mockedWrite.mockRejectedValue(new Error('down'));

            await refresh().expect(200);
            await refresh().expect(200);
            await refresh().expect(200);
            await refresh().expect(200);

            expect(await CoachCard.findOne({ kind: 'weekly_review' })).toMatchObject({ status: 'failed', attempts: 2 });
            expect(mockedWrite.mock.calls.filter(([request]) => request.kind === 'weekly_review')).toHaveLength(2);
        });

        it('lets only one of several refreshes retry a failed review', async () => {
            await makeHabit(21, doneThrough(-21));
            mockedWrite.mockRejectedValue(new Error('down'));
            await refresh().expect(200);
            mockedWrite.mockClear();
            mockedWrite.mockImplementation(async () => answers.review);

            await Promise.all([refresh(), refresh(), refresh()]);

            expect(mockedWrite.mock.calls.filter(([request]) => request.kind === 'weekly_review')).toHaveLength(1);
        });

        it('succeeds on the second try if the model comes back', async () => {
            await makeHabit(21, doneThrough(-21));
            mockedWrite.mockRejectedValueOnce(new Error('down'));

            await refresh().expect(200);
            const second = await refresh().expect(200);

            expect(second.body.data.cards[0]).toMatchObject({ kind: 'weekly_review', status: 'ready' });
        });

        describe('an offer to ease a habit', () => {
            it('is made after three slots in a row failed or missed, with no model asked', async () => {
                // Done up to four days ago, then three days nobody marked.
                await makeHabit(10, doneThrough(-10, [-1, -2, -3]));

                const response = await refresh().expect(200);

                const offer = response.body.data.cards.find((card: { kind: string }) => card.kind === 'recalibration');
                expect(offer).toMatchObject({
                    status: 'candidate',
                    proposal: { habitTitle: 'Read', to: { frequency: { kind: 'weekly', times: 5 } } },
                });
                expect(mockedWrite.mock.calls.filter(([request]) => request.kind === 'recalibration')).toHaveLength(0);
            });

            it('is not made after two', async () => {
                await makeHabit(10, doneThrough(-10, [-1, -2]));

                const response = await refresh().expect(200);

                expect(response.body.data.cards.filter((card: { kind: string }) => card.kind === 'recalibration')).toEqual([]);
            });

            it('is not made for a habit that was changed this week', async () => {
                await makeHabit(10, doneThrough(-10, [-1, -2, -3]), {
                    rules: [
                        { effectiveFrom: dayAt(-10), frequency: { kind: 'daily' } },
                        { effectiveFrom: dayAt(-2), frequency: { kind: 'daily' }, target: { value: 5, unit: 'km' } },
                    ],
                });

                const response = await refresh().expect(200);

                expect(response.body.data.cards.filter((card: { kind: string }) => card.kind === 'recalibration')).toEqual([]);
            });

            it('is not made for a habit that is paused', async () => {
                await makeHabit(10, doneThrough(-10, [-1, -2, -3]), { pauses: [{ from: dayAt(-1), to: dayAt(5) }] });

                const response = await refresh().expect(200);

                expect(response.body.data.cards.filter((card: { kind: string }) => card.kind === 'recalibration')).toEqual([]);
            });

            it('is made once a week, however often it is asked', async () => {
                await makeHabit(10, doneThrough(-10, [-1, -2, -3]));

                await refresh().expect(200);
                await refresh().expect(200);

                expect(await CoachCard.countDocuments({ kind: 'recalibration' })).toBe(1);
            });

            it('is made the moment a third failure is written, with no refresh', async () => {
                const habit = await makeHabit(5, [-5, -4]);
                await HabitDay.create({ habitId: habit._id, userId: client.userId, day: dayAt(-3), status: 'failed' });
                await HabitDay.create({ habitId: habit._id, userId: client.userId, day: dayAt(-2), status: 'failed' });

                await write(client, 'patch', `/habits/${habit._id}/complete`)
                    .send({ date: dayAt(-1).toISOString().slice(0, 10), status: 'failed' })
                    .expect(200);

                expect(await CoachCard.countDocuments({ kind: 'recalibration', status: 'candidate' })).toBe(1);
                expect(mockedWrite).not.toHaveBeenCalled();
            });

            it('does not make a mark fail if the coach cannot make its card', async () => {
                const habit = await makeHabit(5, [-5, -4]);
                const spy = jest.spyOn(CoachCard, 'create').mockRejectedValueOnce(new Error('db down') as never);
                await HabitDay.create({ habitId: habit._id, userId: client.userId, day: dayAt(-3), status: 'failed' });
                await HabitDay.create({ habitId: habit._id, userId: client.userId, day: dayAt(-2), status: 'failed' });

                await write(client, 'patch', `/habits/${habit._id}/complete`)
                    .send({ date: dayAt(-1).toISOString().slice(0, 10), status: 'failed' })
                    .expect(200);

                spy.mockRestore();
            });
        });

        describe('an insight', () => {
            const giveReasons = async (habit: { _id: unknown }, codes: string[]) => {
                for (const [index, code] of codes.entries()) {
                    await HabitDay.create({
                        habitId: habit._id, userId: client.userId, day: dayAt(-1 - index), status: 'failed',
                        failureReason: { code },
                    });
                }
            };

            it('is told when a reason dominates five answers', async () => {
                const habit = await makeHabit(10, doneThrough(-10, [-1, -2, -3, -4, -5]));
                await giveReasons(habit, ['no_time', 'no_time', 'no_time', 'forgot', 'ill']);

                const response = await refresh().expect(200);

                const insight = response.body.data.cards.find((card: { kind: string }) => card.kind === 'insight');
                expect(insight).toMatchObject({
                    status: 'ready',
                    facts: { pattern: 'top_reason', reason: 'no_time', timesGiven: 3 },
                });
            });

            it('is silent below its threshold', async () => {
                const habit = await makeHabit(10, doneThrough(-10, [-1, -2, -3, -4]));
                await giveReasons(habit, ['no_time', 'no_time', 'no_time', 'forgot']);

                const response = await refresh().expect(200);

                expect(response.body.data.cards.filter((card: { kind: string }) => card.kind === 'insight')).toEqual([]);
            });

            it('is told once a day', async () => {
                const habit = await makeHabit(10, doneThrough(-10, [-1, -2, -3, -4, -5]));
                await giveReasons(habit, ['ill', 'ill', 'ill', 'ill', 'forgot']);

                await refresh().expect(200);
                await refresh().expect(200);

                expect(await CoachCard.countDocuments({ kind: 'insight' })).toBe(1);
            });

            it('is not told again inside a month, about the same pattern', async () => {
                const habit = await makeHabit(10, doneThrough(-10, [-1, -2, -3, -4, -5]));
                await giveReasons(habit, ['ill', 'ill', 'ill', 'ill', 'forgot']);
                await CoachCard.create({
                    userId: client.userId, kind: 'insight', key: dayAt(-3).toISOString().slice(0, 10),
                    status: 'ready', language: 'en', fingerprint: 'top_reason:ill',
                });

                const response = await refresh().expect(200);

                expect(response.body.data.cards.filter((card: { kind: string }) => card.kind === 'insight')).toEqual([]);
            });

            it('is told again once a month has passed', async () => {
                const habit = await makeHabit(10, doneThrough(-10, [-1, -2, -3, -4, -5]));
                await giveReasons(habit, ['ill', 'ill', 'ill', 'ill', 'forgot']);
                const old = await CoachCard.create({
                    userId: client.userId, kind: 'insight', key: dayAt(-40).toISOString().slice(0, 10),
                    status: 'ready', language: 'en', fingerprint: 'top_reason:ill',
                });
                // Through the driver: `createdAt` is immutable to the model, as it should be.
                await CoachCard.collection.updateOne({ _id: old._id }, { $set: { createdAt: dayAt(-40) } });

                const response = await refresh().expect(200);

                expect(response.body.data.cards.some((card: { kind: string }) => card.kind === 'insight')).toBe(true);
            });
        });

        describe('what the model is sent', () => {
            const requestOf = (kind: string) =>
                mockedWrite.mock.calls.map(([request]) => request).find(request => request.kind === kind);

            beforeEach(async () => {
                const habit = await makeHabit(21, doneThrough(-21, [-9]), { title: 'Read the book' });
                await HabitDay.updateOne({ habitId: habit._id, day: dayAt(-8) }, { $set: { note: 'Felt great' } });
                await JournalEntry.create({ userId: client.userId, day: dayAt(-1), mood: 4, text: 'a private day' });
            });

            it('names no person, address or id', async () => {
                await refresh().expect(200);

                const sent = JSON.stringify(mockedWrite.mock.calls);
                for (const secret of [validUser.name, validUser.surname, validUser.email, client.userId]) {
                    expect(sent).not.toContain(secret);
                }
                expect(sent).not.toMatch(/[0-9a-f]{24}/);
            });

            it('carries no notes by default', async () => {
                await refresh().expect(200);

                expect(requestOf('weekly_review')?.notes).toBeUndefined();
                expect(JSON.stringify(mockedWrite.mock.calls)).not.toContain('Felt great');
                expect(JSON.stringify(mockedWrite.mock.calls)).not.toContain('a private day');
            });

            it('carries the person’s own words once they have said it may', async () => {
                await write(client, 'patch', '/auth/profile').send({ preferences: { coachReadsNotes: true } }).expect(200);

                await refresh().expect(200);

                expect(requestOf('weekly_review')?.notes?.join('\n')).toContain('a private day');
            });

            it('writes in the language chosen', async () => {
                await write(client, 'patch', '/auth/profile').send({ preferences: { coachLanguage: 'uk' } }).expect(200);

                const response = await refresh().expect(200);

                expect(requestOf('weekly_review')?.language).toBe('uk');
                expect(response.body.data.cards[0].language).toBe('uk');
            });

            it('goes by the language of the habits when none is chosen', async () => {
                await Habit.updateMany({}, { $set: { title: 'Читати книгу' } });

                await refresh().expect(200);

                expect(requestOf('weekly_review')?.language).toBe('uk');
            });
        });
    });

    describe('GET /coach/cards', () => {
        it('lists the cards, newest first', async () => {
            await CoachCard.create({ userId: client.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });
            await new Promise(resolve => setTimeout(resolve, 5));
            await CoachCard.create({ userId: client.userId, kind: 'insight', key: 'b', status: 'ready', language: 'en' });

            expect((await cards()).map((card: { key: string }) => card.key)).toEqual(['b', 'a']);
        });

        it('leaves out a card that could not be written', async () => {
            await CoachCard.create({ userId: client.userId, kind: 'insight', key: 'a', status: 'failed', language: 'en' });

            expect(await cards()).toEqual([]);
        });

        it('shows offers that are still only offers', async () => {
            await CoachCard.create({ userId: client.userId, kind: 'recalibration', key: 'a:1', status: 'candidate', language: 'en' });

            expect((await cards())[0].status).toBe('candidate');
        });

        it('never carries the owner, the cost, the attempts or the fingerprint', async () => {
            await CoachCard.create({
                userId: client.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en',
                fingerprint: 'weekday_failures:abc:1', attempts: 1, usage: { model: 'm', inputTokens: 1, outputTokens: 1 },
            });

            const [card] = await cards();

            for (const hidden of ['userId', 'usage', 'attempts', 'fingerprint', '__v']) {
                expect(card).not.toHaveProperty(hidden);
            }
        });

        it('pages with a cursor', async () => {
            for (const key of ['a', 'b', 'c']) {
                await CoachCard.create({ userId: client.userId, kind: 'insight', key, status: 'ready', language: 'en' });
                await new Promise(resolve => setTimeout(resolve, 5));
            }

            const first = (await client.agent.get('/coach/cards?limit=2').expect(200)).body.data;
            const second = (await client.agent.get(`/coach/cards?limit=2&before=${encodeURIComponent(first.nextCursor)}`).expect(200)).body.data;

            expect(first.cards.map((card: { key: string }) => card.key)).toEqual(['c', 'b']);
            expect(second.cards.map((card: { key: string }) => card.key)).toEqual(['a']);
            expect(second.nextCursor).toBeUndefined();
        });

        it('refuses a limit that is not a number, and a cursor that is not a date', async () => {
            await client.agent.get('/coach/cards?limit=lots').expect(400);
            await client.agent.get('/coach/cards?before=yesterday-ish').expect(400);
        });

        it("shows only the person's own", async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            await CoachCard.create({ userId: stranger.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });

            expect(await cards()).toEqual([]);
        });

        it('requires a session', async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            await stranger.agent.post('/auth/logout').set('X-CSRF-Token', stranger.csrf).expect(200);

            await stranger.agent.get('/coach/cards').expect(401);
        });
    });

    describe('opening an offer', () => {
        const offer = async (habitExtra: Record<string, unknown> = {}) => {
            await makeHabit(10, doneThrough(-10, [-1, -2, -3]), habitExtra);
            return (await refresh().expect(200)).body.data.cards.find((card: { kind: string }) => card.kind === 'recalibration');
        };

        const open = (id: string) => write(client, 'post', `/coach/cards/${id}/open`);

        it('has the model explain it, and keeps what it said', async () => {
            const candidate = await offer();

            const response = await open(candidate._id).expect(200);

            expect(response.body.data.card).toMatchObject({ status: 'ready', content: { title: 'Ease off' } });
            const request = mockedWrite.mock.calls.map(([r]) => r).find(r => r.kind === 'recalibration');
            expect(request?.facts).toMatchObject({ failedInARow: 3, proposal: { to: { frequency: { kind: 'weekly', times: 5 } } } });
        });

        it('asks for new tasks for a programme, and shows both sets', async () => {
            const candidate = await offer({ program: Array.from({ length: 30 }, (_u, i) => ({ title: `Task ${i + 1}` })) });
            expect(candidate.proposal.rewrite.current).toHaveLength(7);

            const response = await open(candidate._id).expect(200);

            expect(response.body.data.card.proposal.rewrite.proposed).toEqual(
                Array.from({ length: 7 }, (_u, i) => `Gentler ${i + 1}`),
            );
        });

        it('asks nothing again for a card already opened', async () => {
            const candidate = await offer();
            await open(candidate._id).expect(200);
            const calls = mockedWrite.mock.calls.length;

            await open(candidate._id).expect(200);

            expect(mockedWrite).toHaveBeenCalledTimes(calls);
        });

        it('answers 503 and stays an offer when the model is down, then gives up after a second try', async () => {
            const candidate = await offer();
            mockedWrite.mockRejectedValue(new Error('down'));

            await open(candidate._id).expect(503);
            expect(await CoachCard.findById(candidate._id)).toMatchObject({ status: 'candidate', attempts: 1 });

            await open(candidate._id).expect(503);
            expect(await CoachCard.findById(candidate._id)).toMatchObject({ status: 'failed', attempts: 2 });
        });

        it("answers NOT_FOUND for another person's card", async () => {
            const candidate = await offer();
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'post', `/coach/cards/${candidate._id}/open`).expect(404);
        });

        it('refuses an id that is not one', async () => {
            await open('nope').expect(400);
        });
    });

    describe('applying an offer', () => {
        const readyOffer = async (habitExtra: Record<string, unknown> = {}) => {
            const habit = await makeHabit(10, doneThrough(-10, [-1, -2, -3]), habitExtra);
            const candidate = (await refresh().expect(200)).body.data.cards.find((card: { kind: string }) => card.kind === 'recalibration');
            await write(client, 'post', `/coach/cards/${candidate._id}/open`).expect(200);
            return { habit, card: candidate };
        };

        const apply = (id: string) => write(client, 'post', `/coach/cards/${id}/apply`);

        it('changes the habit through the ordinary edit: a new rule from today, the past untouched', async () => {
            const { habit, card } = await readyOffer();

            const response = await apply(card._id).expect(200);

            expect(response.body.data.habit.frequency).toEqual({ kind: 'weekly', times: 5 });
            expect(response.body.data.habit.rules).toHaveLength(2);
            expect(response.body.data.habit.rules[0].frequency).toEqual({ kind: 'daily' });
            expect(response.body.data.card.status).toBe('applied');
            expect((await Habit.findById(habit._id))?.rules).toHaveLength(2);
        });

        it('eases a goal when the habit has one', async () => {
            const { card } = await readyOffer({
                rules: [{ effectiveFrom: dayAt(-10), frequency: { kind: 'daily' }, target: { value: 8, unit: 'glasses' } }],
            });

            const response = await apply(card._id).expect(200);

            expect(response.body.data.habit.target).toEqual({ value: 6, unit: 'glasses' });
            expect(response.body.data.habit.frequency).toEqual({ kind: 'daily' });
        });

        it('rewrites the next sessions of a programme', async () => {
            const { card } = await readyOffer({ program: Array.from({ length: 30 }, (_u, i) => ({ title: `Task ${i + 1}` })) });
            const from = card.proposal.rewrite.fromSession;

            await apply(card._id).expect(200);

            const program = (await Habit.findOne({}))?.program?.map(session => session.title);
            expect(program?.[from - 1]).toBe('Gentler 1');
            expect(program?.[from + 5]).toBe('Gentler 7');
            expect(program?.[from + 6]).toBe(`Task ${from + 7}`);
            expect(program?.[0]).toBe('Task 1');
        });

        it('cannot be applied twice', async () => {
            const { card } = await readyOffer();
            await apply(card._id).expect(200);

            await apply(card._id).expect(409);
        });

        it('wants the offer opened first, so the person has seen what changes', async () => {
            await makeHabit(10, doneThrough(-10, [-1, -2, -3]));
            const candidate = (await refresh().expect(200)).body.data.cards.find((card: { kind: string }) => card.kind === 'recalibration');

            const response = await apply(candidate._id).expect(409);

            expect(response.body.error.message).toMatch(/open the offer first/i);
        });

        it('is refused once the habit has been changed since', async () => {
            const { habit, card } = await readyOffer();
            await write(client, 'put', `/habits/${habit._id}`).send({ frequency: { kind: 'weekly', times: 3 } }).expect(200);

            const response = await apply(card._id).expect(409);

            expect(response.body.error.message).toBe('The habit has changed since this was suggested');
        });

        it('is refused once the habit is gone', async () => {
            const { habit, card } = await readyOffer();
            await write(client, 'delete', `/habits/${habit._id}`).expect(200);

            await apply(card._id).expect(409);
        });

        it('is for offers only', async () => {
            const insight = await CoachCard.create({ userId: client.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });

            await apply(String(insight._id)).expect(409);
        });

        it('is refused after the offer was dismissed', async () => {
            const { card } = await readyOffer();
            await write(client, 'post', `/coach/cards/${card._id}/dismiss`).expect(200);

            await apply(card._id).expect(409);
        });

        it("cannot be done to another person's habit", async () => {
            const { card } = await readyOffer();
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'post', `/coach/cards/${card._id}/apply`).expect(404);
        });
    });

    describe('dismissing and rating', () => {
        const card = () => CoachCard.create({ userId: client.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });

        it('closes a card', async () => {
            const made = await card();

            const response = await write(client, 'post', `/coach/cards/${made._id}/dismiss`).expect(200);

            expect(response.body.data.card.status).toBe('dismissed');
        });

        it('leaves an applied card applied', async () => {
            const made = await CoachCard.create({ userId: client.userId, kind: 'recalibration', key: 'x:1', status: 'applied', language: 'en' });

            const response = await write(client, 'post', `/coach/cards/${made._id}/dismiss`).expect(200);

            expect(response.body.data.card.status).toBe('applied');
        });

        it('records whether a card helped, and lets the person change their mind', async () => {
            const made = await card();

            const yes = await write(client, 'post', `/coach/cards/${made._id}/feedback`).send({ helpful: true }).expect(200);
            expect(yes.body.data.card.feedback).toBe('helpful');

            const no = await write(client, 'post', `/coach/cards/${made._id}/feedback`).send({ helpful: false }).expect(200);
            expect(no.body.data.card.feedback).toBe('not_helpful');
        });

        it('wants a yes or a no', async () => {
            const made = await card();

            await write(client, 'post', `/coach/cards/${made._id}/feedback`).send({ helpful: 'maybe' }).expect(400);
        });

        it("will not touch another person's card", async () => {
            const made = await card();
            const stranger = await signUp({ email: 'stranger@example.com' });

            await write(stranger, 'post', `/coach/cards/${made._id}/dismiss`).expect(404);
            await write(stranger, 'post', `/coach/cards/${made._id}/feedback`).send({ helpful: true }).expect(404);
        });
    });

    describe('what the account does with it', () => {
        it('puts the cards in the export, and nobody else’s', async () => {
            await CoachCard.create({ userId: client.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en', content: { title: 'T', body: 'B' } });
            const stranger = await signUp({ email: 'stranger@example.com' });
            await CoachCard.create({ userId: stranger.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });

            const exported = (await client.agent.get('/auth/export').expect(200)).body.data;

            expect(exported.coachCards).toHaveLength(1);
            expect(exported.coachCards[0].content.title).toBe('T');
            expect(JSON.stringify(exported)).not.toContain('"userId"');
        });

        it('erases them with the account', async () => {
            await CoachCard.create({ userId: client.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });
            const stranger = await signUp({ email: 'stranger@example.com' });
            await CoachCard.create({ userId: stranger.userId, kind: 'insight', key: 'a', status: 'ready', language: 'en' });

            await write(client, 'delete', '/auth/account').send({ password: validUser.password }).expect(200);

            expect(await CoachCard.countDocuments()).toBe(1);
        });
    });

    describe('the coach’s preferences', () => {
        it('default to reading no notes, in no particular language', async () => {
            const me = (await client.agent.get('/auth/me').expect(200)).body.data.user;

            expect(me.preferences.coachReadsNotes).toBe(false);
            expect(me.preferences.coachLanguage).toBeUndefined();
        });

        it('can be set, without disturbing the others', async () => {
            await write(client, 'patch', '/auth/profile').send({ preferences: { coachLanguage: 'UK', coachReadsNotes: true } }).expect(200);
            await write(client, 'patch', '/auth/profile').send({ preferences: { askFailureReason: false } }).expect(200);

            const me = (await client.agent.get('/auth/me').expect(200)).body.data.user;

            expect(me.preferences).toEqual({ askFailureReason: false, coachLanguage: 'uk', coachReadsNotes: true });
        });

        it.each(['ukr', 'u', '12', ''])('refuse a language of %j', async coachLanguage => {
            await write(client, 'patch', '/auth/profile').send({ preferences: { coachLanguage } }).expect(400);
        });
    });
});
