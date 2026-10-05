import mongoose from 'mongoose';
import Plan from '@models/Plan';
import { signUp, type Client } from '../testUtils';

jest.mock('@services/moderationService', () => ({
    MODERATION_MODEL: 'test-model',
    reviewPlan: jest.fn(),
}));

import { reviewPlan } from '@services/moderationService';

const mockedReview = reviewPlan as jest.MockedFunction<typeof reviewPlan>;

const dayKey = (offset: number) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};

const write = (client: Client, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

const weekly = { kind: 'weekly', times: 2 };

const createHabit = async (client: Client, overrides: Record<string, unknown> = {}) =>
    (await write(client, 'post', '/habits/')
        .send({
            title: 'Run',
            startDate: dayKey(0),
            sessions: 2,
            type: 'build',
            color: 'blue',
            icon: 'shoe',
            frequency: weekly,
            target: { value: 5, unit: 'km' },
            timeOfDay: 'morning',
            ...overrides,
        })
        .expect(201)).body.data.habit;

const publish = async (client: Client, habitId: string) =>
    (await write(client, 'post', '/plans').send({ habitId, category: 'fitness' }).expect(201)).body.data.plan;

const take = async (client: Client, planId: string, body: Record<string, unknown> = {}) =>
    (await write(client, 'post', '/habits/from-plan').send({ planId, startDate: dayKey(0), ...body }).expect(201))
        .body.data.habit;

const completed = async (planId: string) => (await Plan.findById(planId))?.completedCloneCount;

/** Counts the goal on two days, enough to finish a 2-session programme. */
const finish = async (client: Client, habit: { _id: string }) => {
    for (const offset of [0, 1]) {
        await write(client, 'patch', `/habits/${habit._id}/value`)
            .send({ date: dayKey(offset), value: 5 })
            .expect(200);
    }
};

describe('Plans and frequencies', () => {
    let author: Client;
    let taker: Client;

    beforeEach(async () => {
        mockedReview.mockResolvedValue({ language: 'en', verdict: 'allow' });
        author = await signUp({ email: 'author@example.com' });
        taker = await signUp({ email: 'taker@example.com' });
    });

    it('carries the rhythm, the goal and the part of the day into the plan', async () => {
        const habit = await createHabit(author);

        const plan = await publish(author, habit._id);

        expect(plan).toMatchObject({
            frequency: weekly,
            target: { value: 5, unit: 'km' },
            timeOfDay: 'morning',
            duration: 2,
        });
    });

    it('shows them in the library listing too', async () => {
        await publish(author, (await createHabit(author))._id);

        const response = await taker.agent.get('/plans').expect(200);

        expect(response.body.data.plans[0]).toMatchObject({ frequency: weekly, timeOfDay: 'morning' });
    });

    it('hands them on to whoever takes the plan', async () => {
        const plan = await publish(author, (await createHabit(author))._id);

        const habit = await take(taker, plan._id);

        expect(habit).toMatchObject({
            frequency: weekly,
            target: { value: 5, unit: 'km' },
            timeOfDay: 'morning',
            sessions: 2,
        });
    });

    it('lets the taker choose a different rhythm and goal', async () => {
        const plan = await publish(author, (await createHabit(author))._id);

        const habit = await take(taker, plan._id, {
            frequency: { kind: 'daily' },
            target: { value: 3, unit: 'km' },
        });

        expect(habit).toMatchObject({ frequency: { kind: 'daily' }, target: { value: 3, unit: 'km' } });
    });

    it('refuses to publish a habit with no end', async () => {
        const { sessions: _unused, ...rest } = {
            title: 'Meditate',
            startDate: dayKey(0),
            sessions: 1,
            type: 'build',
            color: 'blue',
            icon: 'lotus',
        };
        const habit = (await write(author, 'post', '/habits/').send(rest).expect(201)).body.data.habit;
        expect(habit.sessions).toBeUndefined();

        const response = await write(author, 'post', '/plans')
            .send({ habitId: habit._id, category: 'mind' })
            .expect(400);

        expect(response.body.error.message).toBe('Only a habit with an end can be published');
    });

    it('treats a plan from before frequencies as running daily', async () => {
        const legacyId = new mongoose.Types.ObjectId();
        await mongoose.connection.collection('plans').insertOne({
            _id: legacyId,
            title: 'Old plan',
            description: '',
            category: 'learning',
            language: 'en',
            type: 'build',
            duration: 2,
            color: 'blue',
            icon: 'books',
            days: [{ dayTitle: 'a' }, { dayTitle: 'b' }],
            author: { userId: new mongoose.Types.ObjectId() },
            sourceHabitId: new mongoose.Types.ObjectId(),
            contentHash: 'x',
            proven: false,
            official: false,
            status: 'published',
            cloneCount: 0,
            completedCloneCount: 0,
            moderation: { checkedAt: new Date(), model: 'm', verdict: 'allow' },
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const detail = await taker.agent.get(`/plans/${legacyId}`).expect(200);
        const list = await taker.agent.get('/plans').expect(200);

        expect(detail.body.data.plan).toMatchObject({ frequency: { kind: 'daily' }, timeOfDay: 'anytime' });
        expect(list.body.data.plans[0]).toMatchObject({ frequency: { kind: 'daily' }, timeOfDay: 'anytime' });
    });

    describe('clone statistics', () => {
        it('counts a clone that walked the plan as published', async () => {
            const plan = await publish(author, (await createHabit(author))._id);
            const habit = await take(taker, plan._id);

            await finish(taker, habit);

            expect(await completed(plan._id)).toBe(1);
        });

        it('leaves out a clone that took the plan at a different rhythm', async () => {
            const plan = await publish(author, (await createHabit(author))._id);
            const habit = await take(taker, plan._id, { frequency: { kind: 'daily' } });

            await finish(taker, habit);

            expect(await completed(plan._id)).toBe(0);
        });

        it('leaves out a clone with a different goal', async () => {
            const plan = await publish(author, (await createHabit(author))._id);
            const habit = await take(taker, plan._id, { target: { value: 1, unit: 'km' } });

            await finish(taker, habit);

            expect(await completed(plan._id)).toBe(0);
        });

        it('stops counting a clone that relaxes its rhythm part way', async () => {
            const plan = await publish(author, (await createHabit(author))._id);
            const habit = await take(taker, plan._id);
            await finish(taker, habit);
            expect(await completed(plan._id)).toBe(1);

            await write(taker, 'put', `/habits/${habit._id}`)
                .send({ frequency: { kind: 'weekly', times: 1 } })
                .expect(200);

            expect(await completed(plan._id)).toBe(0);
        });
    });
});
