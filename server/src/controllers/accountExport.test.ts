jest.mock('@services/moderationService', () => ({
    MODERATION_MODEL: 'test-model',
    reviewPlan: jest.fn().mockResolvedValue({ language: 'en', verdict: 'allow' }),
}));

import request from 'supertest';
import app from '@app';
import { signUp, validUser, type Client } from '../testUtils';

const write = (client: Client, method: 'post' | 'patch', path: string) =>
    client.agent[method](path).set('X-CSRF-Token', client.csrf);

const today = () => new Date().toISOString().slice(0, 10);

const createHabit = async (client: Client, title: string) =>
    (await write(client, 'post', '/habits/')
        .send({ title, startDate: today(), sessions: 3, type: 'build', color: 'blue', icon: 'books' })
        .expect(201)).body.data.habit;

describe('GET /auth/export', () => {
    it('hands over the account, its habits with their history, and its plans', async () => {
        const client = await signUp();
        const habit = await createHabit(client, 'Read');
        await write(client, 'patch', `/habits/${habit._id}/complete`)
            .send({ date: today(), status: 'done' })
            .expect(200);
        await write(client, 'post', '/plans').send({ habitId: habit._id, category: 'learning' }).expect(201);

        const response = await client.agent.get('/auth/export').expect(200);
        const exported = response.body.data;

        expect(exported.exportedAt).toEqual(expect.any(String));
        expect(exported.user.email).toBe(validUser.email);
        expect(exported.habits).toHaveLength(1);
        expect(exported.habits[0].program).toHaveLength(3);
        expect(exported.habits[0].days).toHaveLength(1);
        expect(exported.habits[0].days[0]).toMatchObject({ status: 'done', completedSteps: [] });
        expect(exported.plans).toHaveLength(1);
    });

    it('carries nothing the account screens would not show', async () => {
        const client = await signUp();
        await createHabit(client, 'Read');

        const response = await client.agent.get('/auth/export').expect(200);
        const text = JSON.stringify(response.body.data);

        for (const secret of ['password', 'tokenVersion', 'refreshSessions', 'passwordResetHash', '"userId"']) {
            expect(text).not.toContain(secret);
        }
    });

    it('contains only its own account', async () => {
        const client = await signUp();
        const other = await signUp({ email: 'other@example.com' });
        await createHabit(other, 'Not mine');

        const response = await client.agent.get('/auth/export').expect(200);

        expect(response.body.data.habits).toHaveLength(0);
    });

    it('requires a session', async () => {
        await request(app).get('/auth/export').expect(401);
    });
});
