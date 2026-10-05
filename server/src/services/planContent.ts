import { createHash } from 'crypto';
import type { Frequency, Target } from '@shared/index';
import { startOfUtcDay } from '@utils/dates';

/**
 * A fingerprint of a schedule: its length and every day title, in order.
 *
 * One mechanism, two jobs, and that is the point of having it at all:
 *
 * 1. The proven badge. A plan may be published on day zero and earn its badge
 *    later, when the source habit finishes — but only if the habit still runs
 *    the schedule that was published. Without this check an author publishes
 *    ninety days, halves their own duration, finishes in forty-five and gets a
 *    badge for a route they never walked.
 * 2. Honest clone statistics. A clone counts towards a plan's completion rate
 *    only while its hash still equals the plan's. That rules out a changed
 *    duration *and* rewritten days at once, with no "modified" flag to keep in
 *    step across three places.
 *
 * The input is JSON-encoded rather than joined with a separator, so a day title
 * that happens to contain the separator cannot collide with a different plan.
 */
export const scheduleHash = (duration: number, dayTitles: readonly string[]): string =>
    createHash('sha256').update(JSON.stringify([duration, dayTitles])).digest('hex');

/**
 * The fingerprint of a plan that is more than "every day, no quantity".
 *
 * A plan that runs daily without a target hashes exactly as it did before
 * frequencies existed — `scheduleHash`, to the bit — so every hash already
 * stored stays valid without being recomputed. Anything else hashes a longer
 * input that names the frequency and the target, so the same titles at a
 * different rhythm are a different plan.
 *
 * The version tag is part of the input, which leaves room to change the
 * encoding later without two encodings ever colliding.
 */
export const contentHash = (
    schedule: { frequency: Frequency; target?: Target },
    dayTitles: readonly string[],
): string => {
    if (schedule.frequency.kind === 'daily' && !schedule.target) {
        return scheduleHash(dayTitles.length, dayTitles);
    }

    return createHash('sha256')
        .update(JSON.stringify(['v2', schedule.frequency, schedule.target ?? null, dayTitles]))
        .digest('hex');
};

/** Share of sessions that must be `done` before a plan may call itself proven. */
export const PROVEN_THRESHOLD = 0.7;

export interface ProvenCheck {
    /**
     * Midnight UTC of the source habit's last session. Absent when it cannot be
     * known — a habit with no end, or one paused with no end in sight.
     */
    endDate?: Date;
    /** Length of the source habit's programme, in sessions. */
    sessions: number;
    /** Sessions of the source habit that are done. */
    doneCount: number;
    /** `scheduleHash` of the source habit as it stands now. */
    habitHash: string;
    /** `contentHash` stored on the plan when it was published. */
    planHash: string;
}

/**
 * Whether a plan has earned its badge.
 *
 * Pure and time-injectable, like `calculateStreak`, so all three conditions can
 * be tested without waiting out a ninety-day plan.
 *
 * The calendar condition is deliberately "the last session is behind us" rather
 * than "every session is done": a plan finished at 80% is still a plan someone
 * walked, and requiring 100% would mean the badge only ever lands on perfect
 * runs. Pauses move the end, so it is the habit's own projected end that counts.
 */
export const qualifiesAsProven = (
    { endDate, sessions, doneCount, habitHash, planHash }: ProvenCheck,
    now: Date = new Date(),
): boolean => {
    if (habitHash !== planHash) {
        return false;
    }

    if (!endDate || startOfUtcDay(now) <= startOfUtcDay(endDate)) {
        return false;
    }

    return sessions > 0 && doneCount / sessions >= PROVEN_THRESHOLD;
};
