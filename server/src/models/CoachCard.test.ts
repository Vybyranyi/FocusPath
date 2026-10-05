import mongoose from 'mongoose';
import CoachCard from '@models/CoachCard';

const base = () => ({
    userId: new mongoose.Types.ObjectId(),
    kind: 'weekly_review' as const,
    key: '2026-03-09',
    status: 'ready' as const,
    language: 'en',
});

describe('CoachCard', () => {
    it('holds one card per person, kind and period', async () => {
        const card = base();
        await CoachCard.init();
        await CoachCard.create(card);

        await expect(CoachCard.create(card)).rejects.toThrow(/duplicate key/);
    });

    it('lets a different period, kind or person have their own', async () => {
        const card = base();
        await CoachCard.init();
        await CoachCard.create(card);
        await CoachCard.create({ ...card, key: '2026-03-16' });
        await CoachCard.create({ ...card, kind: 'insight' });
        await CoachCard.create({ ...base(), key: card.key });

        expect(await CoachCard.countDocuments()).toBe(4);
    });

    it('refuses a kind or a status it does not know', async () => {
        await expect(new CoachCard({ ...base(), kind: 'chat' }).validate()).rejects.toThrow();
        await expect(new CoachCard({ ...base(), status: 'pending' }).validate()).rejects.toThrow();
    });

    it('strips the owner, the cost, the attempts and the version from its JSON', async () => {
        const json = (
            await CoachCard.create({ ...base(), usage: { model: 'm', inputTokens: 1, outputTokens: 2 }, attempts: 1 })
        ).toJSON();

        for (const hidden of ['userId', 'usage', 'attempts', '__v']) {
            expect(json).not.toHaveProperty(hidden);
        }
    });

    it('keeps the text and the facts it was built from', async () => {
        const card = await CoachCard.create({
            ...base(),
            facts: { habits: [{ title: 'Read' }] },
            content: { title: 'A good week', body: 'You read.', tip: 'Keep going' },
        });

        expect(card.toJSON()).toMatchObject({
            facts: { habits: [{ title: 'Read' }] },
            content: { title: 'A good week', tip: 'Keep going' },
        });
    });
});
