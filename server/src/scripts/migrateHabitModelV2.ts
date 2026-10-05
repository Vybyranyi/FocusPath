import dotenv from 'dotenv';
import path from 'path';

import mongoose from 'mongoose';
import { connectDB } from '@config/db';
import { logger } from '@config/logger';
import { startOfUtcDay } from '@utils/dates';
import {
    buildTimeline,
    calculateStreak,
    toDayNumber,
    type TimelineInput,
} from '@services/habitTimeline';

export interface HabitModelV2Report {
    habitsMigrated: number;
    daysWritten: number;
    plansBackfilled: number;
}

/** What marks a habit as already in the new shape. */
export const SCHEMA_VERSION = 2;

interface LegacyDay {
    dayTitle?: string;
    date: Date;
    status?: string;
    completedSteps?: mongoose.Types.ObjectId[];
}

interface LegacyHabit {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    title: string;
    startDate: Date;
    duration?: number;
    type: 'build' | 'quit';
    dailyCompletions?: LegacyDay[];
}

/**
 * Moves every habit from a row per day to a rule plus a log.
 *
 * Each existing habit becomes a programme that runs daily for as many sessions
 * as it had days — everything that could be done with it yesterday can be done
 * with it today. Its day titles become the programme, always, even when they
 * are all the same; only days that were marked or ticked become log entries,
 * since an untouched past day is missed by derivation and needs no row.
 *
 * It copies and never deletes. `dailyCompletions` and `duration` stay exactly
 * as they were, so the previous release can still read the habit if this one
 * has to be rolled back; a later change removes them once this has run in
 * production.
 *
 * Idempotent, and safe to interrupt. A habit is flagged only after its log is
 * written, and the log is written by upsert on (habit, day), so a run that
 * died half way is simply run again.
 *
 * Goes through the driver, not the models: the habit model no longer describes
 * the old fields, and Mongoose would cast them away before the query ran.
 *
 * Expects an open connection; the CLI below owns connecting.
 */
export const migrateHabitModelV2 = async (now: Date = new Date()): Promise<HabitModelV2Report> => {
    const habits = mongoose.connection.collection<LegacyHabit>('habits');
    const days = mongoose.connection.collection('habitdays');
    const plans = mongoose.connection.collection('plans');
    const today = toDayNumber(now);

    let habitsMigrated = 0;
    let daysWritten = 0;

    const pending = habits.find({ schemaVersion: { $ne: SCHEMA_VERSION } });

    for await (const habit of pending) {
        const legacy = [...(habit.dailyCompletions ?? [])].sort(
            (a, b) => a.date.getTime() - b.date.getTime(),
        );
        const startDate = startOfUtcDay(habit.startDate);

        // A habit has to be a programme of at least one session.
        const program = (legacy.length > 0 ? legacy : [{ dayTitle: habit.title }]).map(day => ({
            title: day.dayTitle || habit.title,
        }));

        const marked = legacy.filter(
            day =>
                day.status === 'done' ||
                day.status === 'failed' ||
                (day.completedSteps?.length ?? 0) > 0,
        );

        if (marked.length > 0) {
            const result = await days.bulkWrite(
                marked.map(day => {
                    const logged = startOfUtcDay(day.date);
                    return {
                        updateOne: {
                            filter: { habitId: habit._id, day: logged },
                            update: {
                                $set: {
                                    userId: habit.userId,
                                    completedSteps: day.completedSteps ?? [],
                                    ...(day.status === 'done' || day.status === 'failed'
                                        ? { status: day.status }
                                        : {}),
                                },
                                $setOnInsert: { habitId: habit._id, day: logged },
                            },
                            upsert: true,
                        },
                    };
                }),
            );
            daysWritten += result.upsertedCount + result.modifiedCount;
        }

        const rules = [{ effectiveFrom: startDate, frequency: { kind: 'daily' } }];
        const input: TimelineInput = {
            type: habit.type,
            startDate,
            rules: [{ effectiveFrom: startDate, frequency: { kind: 'daily' } }],
            sessions: program.length,
        };
        const timeline = buildTimeline(
            input,
            marked.flatMap(day =>
                day.status === 'done' || day.status === 'failed'
                    ? [{ day: day.date, status: day.status }]
                    : [],
            ),
            today,
        );

        await habits.updateOne(
            { _id: habit._id },
            {
                $set: {
                    rules,
                    program,
                    pauses: [],
                    restDays: [],
                    timeOfDay: 'anytime',
                    streakUnit: 'day',
                    currentStreak: calculateStreak(input, timeline, today).value,
                    isCompleted: timeline.completed,
                    schemaVersion: SCHEMA_VERSION,
                },
            },
        );
        habitsMigrated++;
    }

    // Plans published before frequencies existed ran daily and had no part of
    // the day. Saying so keeps a reader from having to guess.
    const backfilled = await plans.updateMany(
        { frequency: { $exists: false } },
        { $set: { frequency: { kind: 'daily' }, timeOfDay: 'anytime' } },
    );

    return {
        habitsMigrated,
        daysWritten,
        plansBackfilled: backfilled.modifiedCount,
    };
};

const run = async () => {
    dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
    await connectDB();

    const report = await migrateHabitModelV2();
    logger.info(report, 'Habit model 2.0 migration complete');

    await mongoose.disconnect();
};

// Only when invoked as a script. Importing this module — as the server and the
// test do — must not reach for a database.
if (require.main === module) {
    run().catch(async (error) => {
        logger.fatal({ err: error }, 'Failed to migrate habits to model 2.0');
        await mongoose.disconnect().catch(() => undefined);
        process.exit(1);
    });
}

