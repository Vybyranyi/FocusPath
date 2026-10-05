import mongoose from 'mongoose';
import HabitDay from '@models/HabitDay';

const ids = () => ({
    habitId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
});

describe('HabitDay', () => {
    it('keeps one record per habit per day', async () => {
        const owner = ids();
        const day = new Date('2026-03-18T00:00:00.000Z');

        await HabitDay.init();
        await HabitDay.create({ ...owner, day, status: 'done' });

        await expect(HabitDay.create({ ...owner, day, status: 'failed' })).rejects.toThrow(/duplicate key/);
    });

    it('lets two habits record the same day', async () => {
        const day = new Date('2026-03-18T00:00:00.000Z');

        await HabitDay.init();
        await HabitDay.create({ ...ids(), day, status: 'done' });
        await HabitDay.create({ ...ids(), day, status: 'done' });

        expect(await HabitDay.countDocuments()).toBe(2);
    });

    it('refuses a status that is not stored', async () => {
        const record = new HabitDay({ ...ids(), day: new Date(), status: 'missed' });

        await expect(record.validate()).rejects.toThrow();
    });

    it.each([-1, 10_001])('refuses a value of %s', async value => {
        const record = new HabitDay({ ...ids(), day: new Date(), value });

        await expect(record.validate()).rejects.toThrow();
    });

    it('strips the owner link and version key from its JSON', async () => {
        const record = await HabitDay.create({ ...ids(), day: new Date(), value: 3 });
        const json = record.toJSON();

        expect(json).not.toHaveProperty('userId');
        expect(json).not.toHaveProperty('__v');
        expect(json.value).toBe(3);
    });
});
