import mongoose from 'mongoose';
import JournalEntry from '@models/JournalEntry';

const owner = () => ({ userId: new mongoose.Types.ObjectId(), day: new Date('2026-03-18T00:00:00.000Z') });

describe('JournalEntry', () => {
    it('keeps one entry per person per day', async () => {
        const entry = owner();
        await JournalEntry.init();
        await JournalEntry.create({ ...entry, mood: 3 });

        await expect(JournalEntry.create({ ...entry, mood: 4 })).rejects.toThrow(/duplicate key/);
    });

    it('lets two people write the same day', async () => {
        await JournalEntry.init();
        await JournalEntry.create({ ...owner(), mood: 3 });
        await JournalEntry.create({ ...owner(), mood: 3 });

        expect(await JournalEntry.countDocuments()).toBe(2);
    });

    it.each([0, 6, 2.5])('refuses a mood of %s', async mood => {
        await expect(new JournalEntry({ ...owner(), mood }).validate()).rejects.toThrow();
    });

    it.each([0, 6])('refuses an energy of %s', async energy => {
        await expect(new JournalEntry({ ...owner(), energy }).validate()).rejects.toThrow();
    });

    it('refuses more than two thousand characters', async () => {
        await expect(new JournalEntry({ ...owner(), text: 'x'.repeat(2001) }).validate()).rejects.toThrow();
    });

    it('strips the owner link and version key from its JSON', async () => {
        const json = (await JournalEntry.create({ ...owner(), mood: 4 })).toJSON();

        expect(json).not.toHaveProperty('userId');
        expect(json).not.toHaveProperty('__v');
    });
});
