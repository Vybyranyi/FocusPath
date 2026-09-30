import dotenv from 'dotenv';
import path from 'path';

import mongoose from 'mongoose';
import { connectDB } from '@config/db';
import Habit from '@models/Habit';
import { logger } from '@config/logger';

export interface DailyStepsReport {
    /** Habits whose steps still carried the old per-habit flag. */
    stepsCleaned: number;
    /** Habits with days that had no per-day list of ticked steps yet. */
    daysInitialised: number;
}

const LEGACY_STEPS = { 'steps.completed': { $exists: true } };
// Any day still missing its list, not "no day has one": a habit rescheduled by
// the new code after the old one wrote it can be half in each shape.
const DAYS_WITHOUT_LIST = { dailyCompletions: { $elemMatch: { completedSteps: { $exists: false } } } };

/**
 * Moves steps from one flag per habit to one list per day.
 *
 * The old `steps[].completed` is dropped, not carried onto a day. It was never
 * a fact about a day — a step ticked once stayed ticked for the whole run — so
 * there is no day it could honestly be placed on. Inventing one would show a
 * checklist as done on a day nobody did it.
 *
 * Idempotent: both passes only touch documents still in the old shape.
 *
 * Expects an open connection; the CLI below owns connecting.
 */
export const migrateDailySteps = async (): Promise<DailyStepsReport> => {
    // Through the driver, not the model: the field being removed is no longer
    // in the schema, and Mongoose would cast it away before the query ran.
    const habits = Habit.collection;

    const days = await habits.updateMany(
        DAYS_WITHOUT_LIST,
        { $set: { 'dailyCompletions.$[entry].completedSteps': [] } },
        { arrayFilters: [{ 'entry.completedSteps': { $exists: false } }] },
    );

    const steps = await habits.updateMany(LEGACY_STEPS, { $unset: { 'steps.$[].completed': '' } });

    return { stepsCleaned: steps.modifiedCount, daysInitialised: days.modifiedCount };
};

const run = async () => {
    dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
    await connectDB();

    const report = await migrateDailySteps();
    logger.info(report, 'Daily steps migration complete');

    await mongoose.disconnect();
};

// Only when invoked as a script. Importing this module — as the test does —
// must not reach for a database.
if (require.main === module) {
    run().catch(async (error) => {
        logger.fatal({ err: error }, 'Failed to migrate daily steps');
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
}
