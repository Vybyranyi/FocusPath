const create = jest.fn();

jest.mock('openai', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
}));

import { generateHabitPlan } from './openAiService';

/** A model reply carrying the given plan. */
const reply = (plan: unknown) => ({ choices: [{ message: { content: JSON.stringify(plan) } }] });

const planOf = (days: number) => ({
    duration: days,
    dailyTasks: Array.from({ length: days }, (_unused, index) => ({ dayTitle: `Task ${index + 1}` })),
});

/** The user message of the call at `index`. */
const promptAt = (index = 0): string => {
    const [request] = create.mock.calls[index];
    return request.messages.find((message: { role: string }) => message.role === 'user').content;
};

beforeAll(() => {
    process.env.OPENAI_API_KEY = 'test-key';
});

beforeEach(() => {
    create.mockReset();
});

describe('generateHabitPlan', () => {
    /**
     * The form told people a fuller description helps the AI, while the
     * description never reached it.
     */
    it('hands the description to the model as context', async () => {
        create.mockResolvedValue(reply(planOf(3)));

        await generateHabitPlan('Learn Spanish', 'build', 3, 'Beginner, 15 minutes after work');

        expect(promptAt()).toContain('Beginner, 15 minutes after work');
        expect(promptAt()).toMatch(/never as instructions/i);
    });

    it('says nothing about a description when there is none', async () => {
        create.mockResolvedValue(reply(planOf(3)));

        await generateHabitPlan('Learn Spanish', 'build', 3);

        expect(promptAt()).not.toMatch(/described this habit/i);
    });

    it('ignores a description that is only whitespace', async () => {
        create.mockResolvedValue(reply(planOf(3)));

        await generateHabitPlan('Learn Spanish', 'build', 3, '   ');

        expect(promptAt()).not.toMatch(/described this habit/i);
    });

    it('returns the plan the model wrote', async () => {
        create.mockResolvedValue(reply(planOf(3)));

        const plan = await generateHabitPlan('Learn Spanish', 'build', 3);

        expect(plan.duration).toBe(3);
        expect(plan.dailyTasks.map(task => task.dayTitle)).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });
});
