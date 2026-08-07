import type { DayStatus } from '@shared/index';
import { addUtcDays, startOfUtcDay } from '@utils/dates';

export interface ScheduledDay {
    dayTitle: string;
    date: Date;
    status: DayStatus;
}

/**
 * The consecutive run of `done` days ending at the most recent one.
 *
 * Walks backwards from today rather than collecting the completed days and
 * measuring the gaps, because the interesting cases are the ones with nothing
 * in them: a day left `pending` after it is over, and a day the user explicitly
 * marked `failed`. Both break the run, and a set of completed dates cannot see
 * either.
 *
 * Today is the one exception. A day is not a failure until it is over, so a run
 * that ends yesterday is still current while today sits `pending` — but only
 * while it sits `pending`. Once the user says they failed today, they have said
 * the run is over.
 *
 * Pure and time-injectable so the behaviour can be tested without waiting a day.
 */
export const calculateStreak = (
    completions: ReadonlyArray<{ date: Date | string; status: DayStatus }>,
    now: Date = new Date(),
): number => {
    const today = startOfUtcDay(now).getTime();

    // Last write wins per day, which is also what a duplicated date should mean.
    const byDay = new Map<number, DayStatus>();
    for (const entry of completions) {
        const day = startOfUtcDay(entry.date).getTime();
        if (day <= today) {
            byDay.set(day, entry.status);
        }
    }

    if (byDay.get(today) === 'failed') {
        return 0;
    }

    // Today only joins the run if it is actually done; otherwise counting
    // starts at yesterday and today's grace applies.
    let cursor = byDay.get(today) === 'done' ? today : addUtcDays(today, -1).getTime();
    let streak = 0;

    while (byDay.get(cursor) === 'done') {
        streak++;
        cursor = addUtcDays(cursor, -1).getTime();
    }

    return streak;
};

/**
 * Builds the day-by-day plan for a habit.
 *
 * When a habit is rescheduled, entries are carried over by their position in
 * the plan rather than by their date: "day three of my plan" stays day three
 * even if the start moves. Days past a shortened duration fall away; days added
 * by a longer one start empty.
 */
export const buildSchedule = (
    startDate: Date,
    duration: number,
    defaultTitle: string,
    existing: ReadonlyArray<ScheduledDay> = [],
): ScheduledDay[] =>
    Array.from({ length: duration }, (_unused, offset) => {
        const previous = existing[offset];
        return {
            dayTitle: previous?.dayTitle ?? defaultTitle,
            date: addUtcDays(startDate, offset),
            status: previous?.status ?? 'pending',
        };
    });

/** Last day the habit covers, inclusive. */
export const endOfSchedule = (startDate: Date, duration: number): Date =>
    addUtcDays(startDate, duration - 1);

/** Whether every day of the plan has been done. */
export const isPlanComplete = (
    completions: ReadonlyArray<{ status: DayStatus }>,
    duration: number,
): boolean => completions.filter(entry => entry.status === 'done').length >= duration;
