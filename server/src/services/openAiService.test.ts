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

    describe('holding up on long plans and bad replies', () => {
        /** A task runs to about twenty tokens; 4 000 cut a 365-day plan off mid-array. */
        it('gives a year-long plan room to be written', async () => {
            create.mockResolvedValue(reply(planOf(365)));

            await generateHabitPlan('Read', 'build', 365);

            expect(create.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(365 * 30);
            expect(create.mock.calls[0][0].max_tokens).toBeLessThanOrEqual(16_384);
        });

        /** The old check looked for "parse" in a message that says "is not valid JSON". */
        it('asks again when the reply is not valid JSON', async () => {
            create
                .mockResolvedValueOnce({ choices: [{ message: { content: '{"duration": 3, "dailyTasks": [' } }] })
                .mockResolvedValueOnce(reply(planOf(3)));

            const plan = await generateHabitPlan('Read', 'build', 3);

            expect(create).toHaveBeenCalledTimes(2);
            expect(plan.dailyTasks).toHaveLength(3);
        });

        it('asks again when the reply has no tasks', async () => {
            create
                .mockResolvedValueOnce(reply({ duration: 3 }))
                .mockResolvedValueOnce(reply(planOf(3)));

            await generateHabitPlan('Read', 'build', 3);

            expect(create).toHaveBeenCalledTimes(2);
        });

        it('gives up after the retries are spent', async () => {
            create.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });

            await expect(generateHabitPlan('Read', 'build', 3)).rejects.toThrow('Failed to generate habit plan with AI');
            expect(create).toHaveBeenCalledTimes(3);
        });

        /** The SDK retries what is worth retrying; a refused key is not. */
        it('does not retry a failure to reach the model', async () => {
            create.mockRejectedValue(new Error('401 Incorrect API key'));

            await expect(generateHabitPlan('Read', 'build', 3)).rejects.toThrow();
            expect(create).toHaveBeenCalledTimes(1);
        });

        it('delivers the length that was asked for, whatever the model says', async () => {
            create.mockResolvedValue(reply({ ...planOf(28), duration: 28 }));

            const plan = await generateHabitPlan('Read', 'build', 30);

            expect(plan.duration).toBe(30);
            expect(plan.dailyTasks).toHaveLength(30);
        });

        it('holds a length the model picks to the range it was given', async () => {
            create.mockResolvedValue(reply(planOf(400)));

            const plan = await generateHabitPlan('Read', 'build');

            expect(plan.duration).toBe(90);
            expect(plan.dailyTasks).toHaveLength(90);
        });

        it('keeps a day title within the length the edit sheet accepts', async () => {
            create.mockResolvedValue(reply({ duration: 1, dailyTasks: [{ dayTitle: 'x'.repeat(500) }] }));

            const plan = await generateHabitPlan('Read', 'build', 1);

            expect(plan.dailyTasks[0].dayTitle).toHaveLength(200);
        });
    });
});
