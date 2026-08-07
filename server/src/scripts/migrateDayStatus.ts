import dotenv from 'dotenv';
import path from 'path';

import mongoose from 'mongoose';
import { connectDB } from '@config/db';
import Habit from '@models/Habit';
import { logger } from '@config/logger';

/** Documents touched by each step. Entries within a document are not counted separately. */
export interface MigrationReport {
    habits: number;
    markedDone: number;
    markedPending: number;
}

const LEGACY = { 'dailyCompletions.completed': { $exists: true } };

/**
 * Moves `dailyCompletions[].completed` to `dailyCompletions[].status`.
 *
 * `true` becomes `done`; everything else becomes `pending`, never `failed`.
 * A boolean could not tell "I did not do this" apart from "this day has not
 * happened yet" — that is the whole reason for the enum — so the intent behind
 * an old `false` is not recoverable and must not be invented here.
 *
 * Idempotent: it only looks at documents that still carry the old field, so a
 * second run is a no-op and an interrupted one can simply be repeated.
 *
 * Expects an open connection; the CLI below owns connecting.
 */
export const migrateDayStatuses = async (): Promise<MigrationReport> => {
    // Through the driver, not the model. Mongoose casts against the current
    // schema, and the field being migrated away from is no longer in it — an
    // arrayFilter on `completed` is rejected before it reaches the database.
    // A migration has to see documents as they are stored, not as the code
    // now expects them.
    const habits = Habit.collection;

    const outstanding = await habits.countDocuments(LEGACY);
    if (outstanding === 0) {
        return { habits: 0, markedDone: 0, markedPending: 0 };
    }

    const done = await habits.updateMany(
        LEGACY,
        { $set: { 'dailyCompletions.$[entry].status': 'done' } },
        { arrayFilters: [{ 'entry.completed': true }] },
    );

    const rest = await habits.updateMany(
        LEGACY,
        { $set: { 'dailyCompletions.$[entry].status': 'pending' } },
        { arrayFilters: [{ 'entry.completed': { $ne: true } }] },
    );

    // Last, so an interrupted run leaves the old field in place to be found
    // again rather than losing the progress it recorded.
    await habits.updateMany(LEGACY, { $unset: { 'dailyCompletions.$[].completed': '' } });

    return {
        habits: outstanding,
        markedDone: done.modifiedCount,
        markedPending: rest.modifiedCount,
    };
};

const run = async () => {
    dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
    await connectDB();

    const report = await migrateDayStatuses();
    logger.info(
        report,
        report.habits === 0
            ? 'Nothing to migrate: no habit still carries the old field'
            : 'Day status migration complete',
    );

    await mongoose.disconnect();
};

// Only when invoked as a script. Importing this module — as the test does —
// must not reach for a database.
if (require.main === module) {
    run().catch(async (error) => {
        logger.fatal({ err: error }, 'Failed to migrate day statuses');
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
}
