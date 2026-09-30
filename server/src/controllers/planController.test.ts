import request from 'supertest';
import app from '@app';
import Plan from '@models/Plan';
// Relative, like `../testUtils`: `@/*` is mapped for Jest but not declared in
// the server's tsconfig, so the alias resolves at run time and fails to compile.
import { openReports } from '../scripts/moderationQueue';
import { signUp, validUser, type Client } from '../testUtils';

// The gate is mocked, not the network: every publication runs through it, and a
// suite that reached OpenAI would be neither fast nor deterministic.
jest.mock('@services/moderationService', () => ({
    MODERATION_MODEL: 'test-model',
    reviewPlan: jest.fn(),
}));

import { reviewPlan } from '@services/moderationService';

const mockedReview = reviewPlan as jest.MockedFunction<typeof reviewPlan>;

const todayUtc = () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
};

/** A day as it travels on the wire: `YYYY-MM-DD`, never a full instant. */
const dayKey = (offset: number) => {
    const date = todayUtc();
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};

const write = (client: Client, method: 'post' | 'put' | 'patch' | 'delete', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

const createHabit = async (client: Client, overrides: Record<string, unknown> = {}) => {
    const response = await write(client, 'post', '/habits/')
        .send({
            title: 'Read daily',
            description: 'Twenty pages a day',
            startDate: dayKey(0),
            duration: 3,
            type: 'build',
            color: 'blue',
            icon: 'books',
            ...overrides,
        })
        .expect(201);

    return response.body.data.habit;
};

const publish = async (
    client: Client,
    habitId: string,
    body: Record<string, unknown> = {},
) => {
    const response = await write(client, 'post', '/plans')
        .send({ habitId, category: 'learning', ...body })
        .expect(201);

    return response.body.data.plan;
};

describe('Plan Controller', () => {
    let client: Client;

    beforeEach(async () => {
        mockedReview.mockResolvedValue({ language: 'en', verdict: 'allow' });
        client = await signUp();
    });

    describe('POST /plans', () => {
        it('copies the content out of the habit', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            expect(plan.title).toBe('Read daily');
            expect(plan.duration).toBe(3);
            expect(plan.days).toHaveLength(3);
            expect(plan.language).toBe('en');
            expect(plan.status).toBe('published');
            expect(plan.proven).toBe(false);
            expect(plan.official).toBe(false);
        });

        it('ignores content sent in the body', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id, {
                title: 'Something else entirely',
                duration: 365,
                days: [{ dayTitle: 'forged' }],
                proven: true,
                official: true,
                cloneCount: 999,
            });

            // Publishing one plan and showing yourself another would leave the
            // content hash — which both the badge and the statistics rest on —
            // meaning nothing at all.
            expect(plan.title).toBe('Read daily');
            expect(plan.duration).toBe(3);
            expect(plan.days).toHaveLength(3);
            expect(plan.proven).toBe(false);
            expect(plan.official).toBe(false);
            expect(plan.cloneCount).toBe(0);
        });

        it('never exposes the author, the source habit, the hash or the review', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id, { displayName: 'Sam' });

            expect(plan.author).toEqual({ displayName: 'Sam' });
            expect(plan.sourceHabitId).toBeUndefined();
            expect(plan.contentHash).toBeUndefined();
            expect(plan.moderation).toBeUndefined();
            expect(plan.completedCloneCount).toBeUndefined();
        });

        it('stays anonymous unless a name is given', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            expect(plan.author.displayName).toBeUndefined();
        });

        it('links the plan back to the habit', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            const response = await client.agent.get(`/habits/${habit._id}`).expect(200);
            expect(response.body.data.habit.publishedPlanId).toBe(plan._id);
        });

        it('refuses to publish the same habit twice', async () => {
            const habit = await createHabit(client);
            await publish(client, habit._id);

            const response = await write(client, 'post', '/plans')
                .send({ habitId: habit._id, category: 'learning' })
                .expect(409);

            expect(response.body.error.code).toBe('CONFLICT');
        });

        it('fails closed when the reviewer is unreachable', async () => {
            mockedReview.mockRejectedValue(new Error('OpenAI is down'));
            const habit = await createHabit(client);

            const response = await write(client, 'post', '/plans')
                .send({ habitId: habit._id, category: 'learning' })
                .expect(503);

            expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
            expect(await Plan.countDocuments({})).toBe(0);
        });

        it('passes the reviewer’s reason back to the author', async () => {
            mockedReview.mockResolvedValue({
                language: 'en',
                verdict: 'reject',
                reason: 'Extreme fasting is not safe to publish',
            });
            const habit = await createHabit(client);

            const response = await write(client, 'post', '/plans')
                .send({ habitId: habit._id, category: 'health' })
                .expect(400);

            expect(response.body.error.code).toBe('CONTENT_REJECTED');
            expect(response.body.error.message).toBe('Extreme fasting is not safe to publish');
            expect(await Plan.countDocuments({})).toBe(0);
        });

        it('refuses a habit belonging to someone else with NOT_FOUND', async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            const habit = await createHabit(stranger);

            const response = await write(client, 'post', '/plans')
                .send({ habitId: habit._id, category: 'learning' })
                .expect(404);

            expect(response.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('GET /plans/:id', () => {
        it('gives a signed-in reader the whole plan', async () => {
            const habit = await createHabit(client, { duration: 10 });
            const plan = await publish(client, habit._id);

            const response = await client.agent.get(`/plans/${plan._id}`).expect(200);

            expect(response.body.data.plan.days).toHaveLength(10);
            expect(response.body.data.plan.daysTruncated).toBeUndefined();
        });

        it('gives a visitor with no session the first three days only', async () => {
            const habit = await createHabit(client, { duration: 10 });
            const plan = await publish(client, habit._id);

            const response = await request(app).get(`/plans/${plan._id}`).expect(200);

            expect(response.body.data.plan.days).toHaveLength(3);
            expect(response.body.data.plan.daysTruncated).toBe(true);
            // The shape of the plan is still there — only the content is held back.
            expect(response.body.data.plan.duration).toBe(10);
            expect(response.body.data.plan.category).toBe('learning');
        });

        it('reads on as a guest when the session cookie is unusable', async () => {
            const habit = await createHabit(client, { duration: 10 });
            const plan = await publish(client, habit._id);

            const response = await request(app)
                .get(`/plans/${plan._id}`)
                .set('Cookie', 'access_token=not-a-real-token')
                .expect(200);

            expect(response.body.data.plan.daysTruncated).toBe(true);
        });

        it('hides the completion rate below ten clones', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            await Plan.updateOne(
                { _id: plan._id },
                { $set: { cloneCount: 9, completedCloneCount: 9 } },
            );

            const response = await client.agent.get(`/plans/${plan._id}`).expect(200);
            expect(response.body.data.plan.completionRate).toBeUndefined();
            expect(response.body.data.plan.cloneCount).toBe(9);
        });

        it('shows the completion rate from ten clones up', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            await Plan.updateOne(
                { _id: plan._id },
                { $set: { cloneCount: 10, completedCloneCount: 6 } },
            );

            const response = await client.agent.get(`/plans/${plan._id}`).expect(200);
            expect(response.body.data.plan.completionRate).toBe(60);
        });

        it('answers NOT_FOUND once the plan is withdrawn', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            await write(client, 'delete', `/plans/${plan._id}`).expect(200);
            await client.agent.get(`/plans/${plan._id}`).expect(404);
        });
    });

    describe('when the author deletes their account', () => {
        const deleteAccount = (who: Client) =>
            write(who, 'delete', '/auth/account').send({ password: 'password123' }).expect(200);

        it('takes their plans out of the library', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            await deleteAccount(client);

            const list = await request(app).get('/plans').expect(200);
            expect(list.body.data.plans.map((p: { _id: string }) => p._id)).not.toContain(plan._id);
        });

        it('leaves nothing that names them', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id, { displayName: 'Ann' });

            await deleteAccount(client);

            const stored = await Plan.findById(plan._id);
            expect(stored?.status).toBe('unpublished');
            expect(stored?.author.displayName).toBeUndefined();
        });

        it('leaves a habit someone else took from them in place', async () => {
            const taker = await signUp({ email: 'taker@example.com' });
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);
            const taken = await write(taker, 'post', '/habits/from-plan')
                .send({ planId: plan._id, startDate: dayKey(0) })
                .expect(201);

            await deleteAccount(client);

            const still = await taker.agent.get(`/habits/${taken.body.data.habit._id}`).expect(200);
            expect(still.body.data.habit.fromPlanId).toBe(plan._id);
        });
    });

    describe('the day view', () => {
        /**
         * The day view is where a habit is published and edited from. Without
         * these two links it offered to publish a habit a second time, and could
         * not warn that an edit takes a clone out of its plan's score.
         */
        it('says which plan a habit was published as', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.habits[0].publishedPlanId).toBe(plan._id);
        });

        it('says which plan a habit was taken from', async () => {
            const author = await signUp({ email: 'author@example.com' });
            const source = await createHabit(author);
            const plan = await publish(author, source._id);
            await write(client, 'post', '/habits/from-plan')
                .send({ planId: plan._id, startDate: dayKey(0) })
                .expect(201);

            const response = await client.agent.get(`/habits/daily?date=${dayKey(0)}`).expect(200);

            expect(response.body.data.habits[0].fromPlanId).toBe(plan._id);
        });
    });

    describe('GET /plans', () => {
        it('is readable with no session at all', async () => {
            const habit = await createHabit(client);
            await publish(client, habit._id);

            const response = await request(app).get('/plans').expect(200);
            expect(response.body.data.plans).toHaveLength(1);
        });

        it('narrows to a category', async () => {
            const first = await createHabit(client, { title: 'Read daily' });
            const second = await createHabit(client, { title: 'Run daily' });
            await publish(client, first._id, { category: 'learning' });
            await publish(client, second._id, { category: 'fitness' });

            const response = await request(app).get('/plans?category=fitness').expect(200);

            expect(response.body.data.plans).toHaveLength(1);
            expect(response.body.data.plans[0].title).toBe('Run daily');
        });

        it('refuses a category that is not on the list', async () => {
            const response = await request(app).get('/plans?category=Спорт').expect(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('never ships day titles in a list', async () => {
            const habit = await createHabit(client);
            await publish(client, habit._id);

            const response = await request(app).get('/plans').expect(200);
            expect(response.body.data.plans[0].days).toBeUndefined();
        });

        it('pages with a cursor', async () => {
            for (const title of ['One', 'Two', 'Three']) {
                const habit = await createHabit(client, { title });
                await publish(client, habit._id);
            }

            const first = await request(app).get('/plans?limit=2').expect(200);
            expect(first.body.data.plans).toHaveLength(2);
            expect(first.body.data.nextCursor).toBeDefined();

            const second = await request(app)
                .get(`/plans?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`)
                .expect(200);

            expect(second.body.data.plans).toHaveLength(1);
            expect(second.body.data.nextCursor).toBeUndefined();

            const seen = [...first.body.data.plans, ...second.body.data.plans].map(
                (plan: { _id: string }) => plan._id,
            );
            expect(new Set(seen).size).toBe(3);
        });

        it('sorts the official shelf apart from the rest', async () => {
            const ordinary = await createHabit(client, { title: 'Ordinary' });
            const seeded = await createHabit(client, { title: 'Seeded' });
            await publish(client, ordinary._id);
            const official = await publish(client, seeded._id);
            await Plan.updateOne({ _id: official._id }, { $set: { official: true } });

            const officialShelf = await request(app).get('/plans?section=official').expect(200);
            expect(officialShelf.body.data.plans.map((plan: { title: string }) => plan.title)).toEqual(['Seeded']);

            const newShelf = await request(app).get('/plans?section=new').expect(200);
            expect(newShelf.body.data.plans.map((plan: { title: string }) => plan.title)).toEqual(['Ordinary']);
        });
    });

    describe('GET /plans/mine', () => {
        it('is not parsed as a plan id', async () => {
            // `/plans/mine` must be registered before `/plans/:id`, or "mine"
            // reaches the ObjectId check and the route answers 400.
            const response = await client.agent.get('/plans/mine').expect(200);
            expect(response.body.data.plans).toEqual([]);
        });

        it('returns the author’s own plans, withdrawn ones included', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);
            await write(client, 'delete', `/plans/${plan._id}`).expect(200);

            const response = await client.agent.get('/plans/mine').expect(200);

            expect(response.body.data.plans).toHaveLength(1);
            expect(response.body.data.plans[0].status).toBe('unpublished');
        });

        it('requires a session', async () => {
            await request(app).get('/plans/mine').expect(401);
        });
    });

    describe('PATCH /plans/:id', () => {
        it('edits the wrapper', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            const response = await write(client, 'patch', `/plans/${plan._id}`)
                .send({ title: 'Read every day', category: 'mind' })
                .expect(200);

            expect(response.body.data.plan.title).toBe('Read every day');
            expect(response.body.data.plan.category).toBe('mind');
        });

        it('leaves the content alone', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            const response = await write(client, 'patch', `/plans/${plan._id}`)
                .send({ title: 'Read every day', days: [{ dayTitle: 'forged' }], duration: 99 })
                .expect(200);

            expect(response.body.data.plan.days).toHaveLength(3);
            expect(response.body.data.plan.duration).toBe(3);
        });

        it('answers NOT_FOUND for someone else’s plan', async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            const habit = await createHabit(stranger);
            const plan = await publish(stranger, habit._id);

            const response = await write(client, 'patch', `/plans/${plan._id}`)
                .send({ title: 'Mine now' })
                .expect(404);

            // NOT_FOUND rather than FORBIDDEN, as everywhere: the other answer
            // would confirm that a plan with this id exists.
            expect(response.body.error.code).toBe('NOT_FOUND');
        });
    });

    describe('DELETE /plans/:id', () => {
        it('withdraws softly', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            await write(client, 'delete', `/plans/${plan._id}`).expect(200);

            // Still there, so `fromPlanId` on anyone's clone still resolves.
            const stored = await Plan.findById(plan._id);
            expect(stored?.status).toBe('unpublished');
        });

        it('answers NOT_FOUND for someone else’s plan', async () => {
            const stranger = await signUp({ email: 'stranger@example.com' });
            const habit = await createHabit(stranger);
            const plan = await publish(stranger, habit._id);

            await write(client, 'delete', `/plans/${plan._id}`).expect(404);
        });
    });

    describe('POST /plans/:id/report', () => {
        it('files one report per person', async () => {
            const author = await signUp({ email: 'author@example.com' });
            const habit = await createHabit(author);
            const plan = await publish(author, habit._id);

            await write(client, 'post', `/plans/${plan._id}/report`)
                .send({ reason: 'spam', comment: 'Links in every day' })
                .expect(201);

            await write(client, 'post', `/plans/${plan._id}/report`)
                .send({ reason: 'spam' })
                .expect(201);

            // Read through the same script that reviews the queue in practice.
            expect(await openReports()).toHaveLength(1);
        });

        it('requires a session', async () => {
            const habit = await createHabit(client);
            const plan = await publish(client, habit._id);

            await request(app).post(`/plans/${plan._id}/report`).send({ reason: 'spam' }).expect(401);
        });
    });

    describe('PATCH /auth/profile', () => {
        it('cannot raise a role', async () => {
            const response = await write(client, 'patch', '/auth/profile')
                .send({ name: 'Renamed', role: 'admin' })
                .expect(200);

            expect(response.body.data.user.name).toBe('Renamed');
            expect(response.body.data.user.role).toBe('user');
        });

        it('leaves an untouched account a plain user', async () => {
            const response = await client.agent.get('/auth/me').expect(200);
            expect(response.body.data.user.role).toBe('user');
            expect(response.body.data.user.email).toBe(validUser.email);
        });
    });
});
