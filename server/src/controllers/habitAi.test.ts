jest.mock('@services/openAiService', () => ({
    generateHabitPlan: jest.fn(),
}));

import { generateHabitPlan } from '@services/openAiService';
import { signUp, type Client } from '../testUtils';

const mockedGenerate = generateHabitPlan as jest.MockedFunction<typeof generateHabitPlan>;

const today = () => new Date().toISOString().slice(0, 10);

const write = (client: Client, path: string) =>
    client.agent.post(path).set('X-CSRF-Token', client.csrf);

const body = (overrides: Record<string, unknown> = {}) => ({
    title: 'Learn Spanish',
    startDate: today(),
    type: 'build',
    color: 'blue',
    icon: 'books',
    ...overrides,
});

const planOf = (sessions: number) => ({
    duration: sessions,
    dailyTasks: Array.from({ length: sessions }, (_unused, index) => ({ dayTitle: `Task ${index + 1}` })),
});

describe('POST /habits/ai', () => {
    let client: Client;

    beforeEach(async () => {
        mockedGenerate.mockReset();
        client = await signUp();
    });

    it('writes a task per session of the programme', async () => {
        mockedGenerate.mockResolvedValue(planOf(4));

        const response = await write(client, '/habits/ai').send(body({ sessions: 4 })).expect(201);

        expect(response.body.data.habit.sessions).toBe(4);

        const day = await client.agent.get(`/habits/daily?date=${today()}`).expect(200);
        expect(day.body.data.habits[0].day.session).toEqual({ index: 1, total: 4, title: 'Task 1' });
    });

    it('hands the rhythm and the goal to the generator', async () => {
        mockedGenerate.mockResolvedValue(planOf(6));

        await write(client, '/habits/ai')
            .send(body({
                sessions: 6,
                frequency: { kind: 'weekly', times: 3 },
                target: { value: 5, unit: 'km' },
            }))
            .expect(201);

        expect(mockedGenerate).toHaveBeenCalledWith('Learn Spanish', 'build', 6, undefined, {
            frequency: { kind: 'weekly', times: 3 },
            target: { value: 5, unit: 'km' },
        });
    });

    it.each([[undefined], [null], [0]])('lets the model choose the length when sessions is %s', async sessions => {
        mockedGenerate.mockResolvedValue(planOf(30));

        const response = await write(client, '/habits/ai').send(body({ sessions })).expect(201);

        expect(mockedGenerate.mock.calls[0][2]).toBeUndefined();
        expect(response.body.data.habit.sessions).toBe(30);
    });

    it('stores the rhythm the person chose, not one the model made up', async () => {
        mockedGenerate.mockResolvedValue(planOf(6));

        const response = await write(client, '/habits/ai')
            .send(body({ sessions: 6, frequency: { kind: 'weekdays', days: [1, 3] }, timeOfDay: 'evening' }))
            .expect(201);

        expect(response.body.data.habit).toMatchObject({
            frequency: { kind: 'weekdays', days: [1, 3] },
            timeOfDay: 'evening',
        });
    });

    it('answers 503 without leaking why when the model fails', async () => {
        mockedGenerate.mockRejectedValue(new Error('upstream exploded'));

        const response = await write(client, '/habits/ai').send(body({ sessions: 4 })).expect(503);

        expect(JSON.stringify(response.body)).not.toContain('exploded');
    });
});
