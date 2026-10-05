import type { Frequency, HabitType, ReasonCode, Target, WeeklyReviewFacts } from '@shared/index';
import { fromDayNumber, weekdayOf, type DayNumber } from '@services/habitTimeline';

/**
 * What the coach knows is counted here, by code, and only then handed to a model
 * to be put into words. A language model given raw history will happily "find"
 * correlations that are not there; a threshold in a pure function cannot, and can
 * be tested.
 *
 * Nothing in this file touches the database or the clock. It works on a
 * `CoachInput` — each habit's decided slots, the journal, today — so every
 * threshold below is exercised with fixtures.
 */

export type Outcome = 'done' | 'failed' | 'missed';

/** A slot that is over, and how it turned out. */
export interface CoachSlot {
    day: DayNumber;
    outcome: Outcome;
}

export interface CoachHabit {
    /** The habit's id as a string. Never leaves the server: the model is given numbers. */
    key: string;
    title: string;
    type: HabitType;
    frequency: Frequency;
    target?: Target;
    /** Only a programme has tasks that can be rewritten. */
    hasProgram: boolean;
    startDay: DayNumber;
    /** The day the rule in force took effect. A change this recent has not had time to work. */
    ruleFrom: DayNumber;
    /** Decided slots, oldest first. Paused days, rest days and the future are not in it. */
    slots: CoachSlot[];
    streak: number;
    streakUnit: 'day' | 'week';
    /** Reasons given for failed days. */
    reasons: Array<{ day: DayNumber; code: ReasonCode }>;
}

export interface CoachJournalDay {
    day: DayNumber;
    mood?: number;
    energy?: number;
}

export interface CoachInput {
    habits: CoachHabit[];
    journal: CoachJournalDay[];
    today: DayNumber;
}

/** How far back patterns are looked for. Long enough to repeat, short enough to be about now. */
export const WINDOW_DAYS = 60;

/** Reasons are weighed over a shorter stretch: what got in the way a month ago is old news. */
export const REASON_WINDOW_DAYS = 30;

/**
 * Slots failed in a row before the coach offers to make a habit easier. Two can
 * be a bad week; three is the point at which the plan, and not the person, is
 * what to look at.
 */
export const FAILURES_BEFORE_RECALIBRATION = 3;

/** A rule changed this recently has not been given a fair run, and is left alone. */
export const RECALIBRATION_COOLDOWN_DAYS = 7;

/** Least history before the coach says anything about a week. */
export const MIN_HISTORY_DAYS = 7;

/**
 * How many times worse than the habit's own average a weekday must be, how
 * many slots it needs to have had, and how many of them failed. Each of the
 * three guards a different mistake: the ratio is the pattern, the slot count
 * stops "twice as bad" meaning one slot against two, and the failure count
 * stops it meaning one miss.
 */
export const WEEKDAY_RATIO = 2;
export const WEEKDAY_MIN_SLOTS = 4;
export const WEEKDAY_MIN_FAILS = 3;

/** One reason is a pattern only if it is at least half of a handful of answers. */
export const REASON_MIN_SHARE = 0.5;
export const REASON_MIN_ANSWERS = 5;

/**
 * Mood differs between days a habit was done and not by at least this much on a
 * five-point scale — about three-quarters of a step — with at least this many
 * days of each, or two lucky weeks would be a finding.
 */
export const MOOD_MIN_DIFFERENCE = 0.7;
export const MOOD_MIN_DAYS = 5;

/** One habit is more often done on the days another is, by at least this much. */
export const PAIR_MIN_DIFFERENCE = 0.3;
export const PAIR_MIN_DAYS = 6;

/** The same pattern about the same habit is not told twice inside this many days. */
export const INSIGHT_REPEAT_DAYS = 30;

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Rounded to a tenth, which is as precise as a mood on five steps deserves. */
const tenth = (value: number): number => Math.round(value * 10) / 10;

const inWindow = (day: DayNumber, today: DayNumber, days: number): boolean =>
    day <= today && day > today - days;

const slotsIn = (habit: CoachHabit, from: DayNumber, to: DayNumber): CoachSlot[] =>
    habit.slots.filter(slot => slot.day >= from && slot.day <= to);

/** How many of the most recent decided slots, back to the last one done, were not. */
export const trailingFailures = (habit: CoachHabit): number => {
    let count = 0;
    for (let index = habit.slots.length - 1; index >= 0; index--) {
        if (habit.slots[index].outcome === 'done') break;
        count++;
    }
    return count;
};

interface WeekdayStat {
    weekday: number;
    slots: number;
    fails: number;
}

/** Per day of the week, over the window. Only for habits that are tied to days. */
const weekdayStats = (habit: CoachHabit, today: DayNumber): WeekdayStat[] => {
    if (habit.frequency.kind === 'weekly') return [];

    const stats = new Map<number, WeekdayStat>();
    for (const slot of habit.slots) {
        if (!inWindow(slot.day, today, WINDOW_DAYS)) continue;
        const weekday = weekdayOf(slot.day);
        const stat = stats.get(weekday) ?? { weekday, slots: 0, fails: 0 };
        stat.slots++;
        if (slot.outcome !== 'done') stat.fails++;
        stats.set(weekday, stat);
    }
    return [...stats.values()];
};

export interface Proposal {
    from: { frequency: Frequency; target?: Target };
    to: { frequency: Frequency; target?: Target };
    /** Whether the next sessions of a programme should be rewritten gentler. */
    rewritesProgram: boolean;
}

/**
 * The easier plan, worked out by arithmetic and not by the model.
 *
 * A quantity comes first, since it is the harder thing about a habit: a build
 * goal drops a quarter (rounded down, never below one), and a quit limit rises
 * a quarter (rounded up) — a step back, not a failure. Otherwise the rhythm
 * eases: daily becomes five a week; chosen weekdays lose the one that goes worst
 * (never the last); N a week becomes N − 1. Nothing is proposed when there is
 * nothing gentler to propose.
 */
export const proposeRecalibration = (habit: CoachHabit, today: DayNumber): Proposal | null => {
    const from = { frequency: habit.frequency, target: habit.target };
    const rewritesProgram = habit.hasProgram;

    if (habit.target) {
        const current = habit.target.value;
        const next = habit.type === 'quit'
            ? Math.ceil(current * 1.25)
            : Math.max(1, Math.floor(current * 0.75));

        if (next === current) return null;
        return {
            from,
            to: { frequency: habit.frequency, target: { ...habit.target, value: next } },
            rewritesProgram,
        };
    }

    const { frequency } = habit;

    if (frequency.kind === 'daily') {
        return { from, to: { frequency: { kind: 'weekly', times: 5 } }, rewritesProgram };
    }

    if (frequency.kind === 'weekly') {
        if (frequency.times <= 1) return null;
        return { from, to: { frequency: { kind: 'weekly', times: frequency.times - 1 } }, rewritesProgram };
    }

    if (frequency.days.length <= 1) return null;

    // The day that goes worst, by its share of failures; a tie goes to the later day.
    const stats = new Map(weekdayStats(habit, today).map(stat => [stat.weekday, stat]));
    const worst = [...frequency.days].sort((a, b) => {
        const shareA = share(stats.get(a)?.fails ?? 0, stats.get(a)?.slots ?? 0);
        const shareB = share(stats.get(b)?.fails ?? 0, stats.get(b)?.slots ?? 0);
        return shareA - shareB || a - b;
    }).pop() as number;

    return {
        from,
        to: { frequency: { kind: 'weekdays', days: frequency.days.filter(day => day !== worst) } },
        rewritesProgram,
    };
};

/**
 * Whether a habit has earned a recalibration offer: failed three slots running,
 * not paused away from the problem, not already over, and not changed lately.
 */
export const needsRecalibration = (habit: CoachHabit, today: DayNumber): boolean =>
    trailingFailures(habit) >= FAILURES_BEFORE_RECALIBRATION &&
    habit.ruleFrom <= today - RECALIBRATION_COOLDOWN_DAYS;

export type Insight =
    | {
          kind: 'weekday_failures';
          fingerprint: string;
          strength: number;
          habit: string;
          weekday: number;
          slots: number;
          fails: number;
          share: number;
          overallShare: number;
      }
    | {
          kind: 'top_reason';
          fingerprint: string;
          strength: number;
          code: ReasonCode;
          count: number;
          total: number;
          share: number;
      }
    | {
          kind: 'mood_link';
          fingerprint: string;
          strength: number;
          habit: string;
          meanWhenDone: number;
          meanWhenNot: number;
          difference: number;
          daysDone: number;
          daysNot: number;
      }
    | {
          kind: 'habit_pair';
          fingerprint: string;
          strength: number;
          /** The habit whose being done goes with the other's. */
          cause: string;
          effect: string;
          whenDone: number;
          whenNot: number;
          difference: number;
          daysDone: number;
          daysNot: number;
      };

const weekdayInsights = (input: CoachInput): Insight[] =>
    input.habits.flatMap(habit => {
        const stats = weekdayStats(habit, input.today);
        const slots = stats.reduce((sum, stat) => sum + stat.slots, 0);
        const fails = stats.reduce((sum, stat) => sum + stat.fails, 0);
        const overall = share(fails, slots);

        return stats
            .filter(
                stat =>
                    stat.slots >= WEEKDAY_MIN_SLOTS &&
                    stat.fails >= WEEKDAY_MIN_FAILS &&
                    // A habit that fails everywhere has no bad day to point at.
                    share(stat.fails, stat.slots) >= WEEKDAY_RATIO * overall &&
                    share(stat.fails, stat.slots) > overall,
            )
            .map((stat): Insight => ({
                kind: 'weekday_failures',
                fingerprint: `weekday_failures:${habit.key}:${stat.weekday}`,
                strength: share(stat.fails, stat.slots) - overall,
                habit: habit.key,
                weekday: stat.weekday,
                slots: stat.slots,
                fails: stat.fails,
                share: tenth(share(stat.fails, stat.slots) * 100) / 100,
                overallShare: tenth(overall * 100) / 100,
            }));
    });

const reasonInsights = (input: CoachInput): Insight[] => {
    const counts = new Map<ReasonCode, number>();
    for (const habit of input.habits) {
        for (const reason of habit.reasons) {
            if (!inWindow(reason.day, input.today, REASON_WINDOW_DAYS)) continue;
            counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
        }
    }

    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (total < REASON_MIN_ANSWERS) return [];

    const [code, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (share(count, total) < REASON_MIN_SHARE) return [];

    return [{
        kind: 'top_reason',
        fingerprint: `top_reason:${code}`,
        strength: share(count, total),
        code,
        count,
        total,
        share: tenth(share(count, total) * 100) / 100,
    }];
};

const moodInsights = (input: CoachInput): Insight[] => {
    const moods = new Map(
        input.journal
            .filter(day => day.mood !== undefined && inWindow(day.day, input.today, WINDOW_DAYS))
            .map(day => [day.day, day.mood as number]),
    );

    return input.habits.flatMap(habit => {
        const done: number[] = [];
        const notDone: number[] = [];
        for (const slot of habit.slots) {
            const mood = moods.get(slot.day);
            if (mood === undefined) continue;
            (slot.outcome === 'done' ? done : notDone).push(mood);
        }
        if (done.length < MOOD_MIN_DAYS || notDone.length < MOOD_MIN_DAYS) return [];

        const difference = mean(done) - mean(notDone);
        if (Math.abs(difference) < MOOD_MIN_DIFFERENCE) return [];

        return [{
            kind: 'mood_link' as const,
            fingerprint: `mood_link:${habit.key}`,
            strength: Math.abs(difference) / 4,
            habit: habit.key,
            meanWhenDone: tenth(mean(done)),
            meanWhenNot: tenth(mean(notDone)),
            difference: tenth(difference),
            daysDone: done.length,
            daysNot: notDone.length,
        }];
    });
};

const pairInsights = (input: CoachInput): Insight[] => {
    const outcomes = input.habits.map(habit => ({
        habit,
        byDay: new Map(
            habit.slots.filter(slot => inWindow(slot.day, input.today, WINDOW_DAYS)).map(slot => [slot.day, slot.outcome === 'done']),
        ),
    }));

    const found: Insight[] = [];
    for (const cause of outcomes) {
        for (const effect of outcomes) {
            if (cause.habit.key === effect.habit.key) continue;

            let causeDone = 0, effectWhenDone = 0, causeNot = 0, effectWhenNot = 0;
            for (const [day, did] of cause.byDay) {
                const other = effect.byDay.get(day);
                if (other === undefined) continue;
                if (did) { causeDone++; if (other) effectWhenDone++; }
                else { causeNot++; if (other) effectWhenNot++; }
            }
            if (causeDone < PAIR_MIN_DAYS || causeNot < PAIR_MIN_DAYS) continue;

            const whenDone = share(effectWhenDone, causeDone);
            const whenNot = share(effectWhenNot, causeNot);
            const difference = whenDone - whenNot;
            if (difference < PAIR_MIN_DIFFERENCE) continue;

            found.push({
                kind: 'habit_pair',
                fingerprint: `habit_pair:${cause.habit.key}:${effect.habit.key}`,
                strength: difference,
                cause: cause.habit.key,
                effect: effect.habit.key,
                whenDone: tenth(whenDone * 100) / 100,
                whenNot: tenth(whenNot * 100) / 100,
                difference: tenth(difference * 100) / 100,
                daysDone: causeDone,
                daysNot: causeNot,
            });
        }
    }
    return found;
};

/**
 * Every pattern that cleared its threshold, strongest first. "Strongest" is
 * each detector's own measure scaled to the same 0–1 range, which is a rough
 * ordering and meant to be — it only decides which of several true things is
 * told first.
 */
export const findInsights = (input: CoachInput): Insight[] =>
    [
        ...weekdayInsights(input),
        ...reasonInsights(input),
        ...moodInsights(input),
        ...pairInsights(input),
    ].sort((a, b) => b.strength - a.strength || a.fingerprint.localeCompare(b.fingerprint));

const weekStartOf = (day: DayNumber): DayNumber => day - (weekdayOf(day) - 1);

/** The Monday of the most recent week that has fully ended, as of `today`. */
export const lastFinishedWeekStart = (today: DayNumber): DayNumber => weekStartOf(today) - 7;

const iso = (day: DayNumber): string => fromDayNumber(day).toISOString().slice(0, 10);

const average = (days: CoachJournalDay[], field: 'mood' | 'energy', from: DayNumber, to: DayNumber) => {
    const values = days
        .filter(day => day.day >= from && day.day <= to && day[field] !== undefined)
        .map(day => day[field] as number);
    return values.length === 0 ? undefined : { average: tenth(mean(values)), days: values.length };
};

const withPrevious = (
    days: CoachJournalDay[],
    field: 'mood' | 'energy',
    start: DayNumber,
) => {
    const now = average(days, field, start, start + 6);
    if (!now) return undefined;
    const before = average(days, field, start - 7, start - 1);
    return before ? { ...now, previousAverage: before.average } : now;
};

/**
 * The week in numbers: per habit what was due and what was done, how that
 * compares with the week before, and the streak; the mood and energy of the
 * days written about; and how often each reason was given.
 */
export const weeklyFacts = (input: CoachInput, weekStart: DayNumber): WeeklyReviewFacts => {
    const weekEnd = weekStart + 6;

    const habits = input.habits.flatMap(habit => {
        const slots = slotsIn(habit, weekStart, weekEnd);
        if (slots.length === 0) return [];

        const done = slots.filter(slot => slot.outcome === 'done').length;
        const before = slotsIn(habit, weekStart - 7, weekStart - 1);

        const stats = weekdayStats(habit, weekEnd).filter(stat => stat.slots >= 3);
        const byDone = [...stats].sort((a, b) => share(a.fails, a.slots) - share(b.fails, b.slots) || a.weekday - b.weekday);
        const best = byDone[0];
        const worst = byDone[byDone.length - 1];
        const differ = best && worst && share(best.fails, best.slots) < share(worst.fails, worst.slots);

        return [{
            title: habit.title,
            type: habit.type,
            slots: slots.length,
            done,
            percentage: Math.round(share(done, slots.length) * 100),
            ...(before.length > 0
                ? { previousPercentage: Math.round(share(before.filter(slot => slot.outcome === 'done').length, before.length) * 100) }
                : {}),
            streak: habit.streak,
            streakUnit: habit.streakUnit,
            ...(differ ? { bestWeekday: best.weekday, worstWeekday: worst.weekday } : {}),
        }];
    });

    const reasons: Partial<Record<ReasonCode, number>> = {};
    for (const habit of input.habits) {
        for (const reason of habit.reasons) {
            if (reason.day < weekStart || reason.day > weekEnd) continue;
            reasons[reason.code] = (reasons[reason.code] ?? 0) + 1;
        }
    }

    const mood = withPrevious(input.journal, 'mood', weekStart);
    const energy = withPrevious(input.journal, 'energy', weekStart);

    return {
        weekStart: iso(weekStart),
        habits,
        ...(mood ? { mood } : {}),
        ...(energy ? { energy } : {}),
        reasons,
    };
};

/** Days between the first habit's start and `day`; what "enough history" is measured in. */
export const historyDays = (input: CoachInput, day: DayNumber): number =>
    input.habits.length === 0 ? 0 : day - Math.min(...input.habits.map(habit => habit.startDay)) + 1;
