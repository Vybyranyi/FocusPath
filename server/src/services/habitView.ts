import type mongoose from 'mongoose';
import type { IHabit } from '@models/Habit';
import type {
    Frequency,
    Habit,
    HabitDay,
    ReasonCode,
    HabitExport,
    HabitSummary,
    Target,
} from '@shared/index';
import {
    buildTimeline,
    calculateProgress,
    calculateStreak,
    fromDayNumber,
    toDayNumber,
    type DayNumber,
    type Streak,
    type Timeline,
    type TimelineInput,
    type TimelineRule,
} from '@services/habitTimeline';

/**
 * Turns a stored habit and its log into what a screen is shown.
 *
 * The one place the storage shape meets the response shape, so that nothing
 * derived — the streak, completion, the end date, what a day is worth — can be
 * answered from a stale stored copy by one endpoint and from the log by
 * another.
 */

/** A log entry as the queries here read it: lean, so ids and dates are raw. */
export interface LoggedDay {
    habitId: mongoose.Types.ObjectId;
    day: Date;
    status?: 'done' | 'failed' | null;
    value?: number | null;
    completedSteps: mongoose.Types.ObjectId[];
    note?: string | null;
    failureReason?: { code: ReasonCode; text?: string | null } | null;
    reasonPrompted?: boolean | null;
}

export const plainFrequency = (frequency: IHabit['rules'][number]['frequency']): Frequency => {
    if (frequency.kind === 'weekdays') {
        return { kind: 'weekdays', days: [...(frequency.days ?? [])].sort((a, b) => a - b) };
    }
    if (frequency.kind === 'weekly') {
        return { kind: 'weekly', times: frequency.times ?? 1 };
    }
    return { kind: 'daily' };
};

export const plainTarget = (target: IHabit['rules'][number]['target']): Target | undefined =>
    target && target.value !== undefined ? { value: target.value, unit: target.unit } : undefined;

/** The habit's rules as plain values — no subdocuments, and no empty `target` object. */
export const rulesOf = (habit: IHabit): Array<TimelineRule & { effectiveFrom: Date }> =>
    habit.rules.map(rule => ({
        effectiveFrom: rule.effectiveFrom,
        frequency: plainFrequency(rule.frequency),
        target: plainTarget(rule.target),
    }));

export const timelineInputOf = (habit: IHabit): TimelineInput => ({
    type: habit.type,
    startDate: habit.startDate,
    rules: rulesOf(habit),
    pauses: habit.pauses.map(pause => ({ from: pause.from, to: pause.to })),
    restDays: habit.restDays,
    sessions: habit.program?.length,
});

export interface Evaluation {
    input: TimelineInput;
    timeline: Timeline;
    streak: Streak;
}

export const evaluate = (
    habit: IHabit,
    logs: readonly LoggedDay[],
    today: DayNumber,
    horizon?: DayNumber,
): Evaluation => {
    const input = timelineInputOf(habit);
    const timeline = buildTimeline(input, logs, today, horizon);
    return { input, timeline, streak: calculateStreak(input, timeline, today) };
};

/** The rule in force on a day — the last one that had taken effect by then. */
export const ruleOn = (habit: IHabit, day: DayNumber) => {
    const rules = rulesOf(habit);
    let found = rules[0];
    for (const rule of rules) {
        if (toDayNumber(rule.effectiveFrom) <= day) found = rule;
    }
    return found;
};

const iso = (day: DayNumber): string => fromDayNumber(day).toISOString();

export const presentHabit = (
    habit: IHabit,
    logs: readonly LoggedDay[],
    today: DayNumber,
): Habit => {
    const { timeline, streak } = evaluate(habit, logs, today);
    return describe(habit, timeline, streak, today);
};

const describe = (habit: IHabit, timeline: Timeline, streak: Streak, today: DayNumber): Habit => {
    const json = habit.toJSON() as unknown as Record<string, unknown>;
    // `program` is the programme's content; the response carries its length.
    delete json.program;

    const rule = ruleOn(habit, today);

    return {
        ...json,
        rules: rulesOf(habit),
        frequency: rule.frequency,
        target: rule.target,
        sessions: habit.program?.length,
        endDate: timeline.endDay === undefined ? undefined : iso(timeline.endDay),
        currentStreak: streak.value,
        streakUnit: streak.unit,
        isCompleted: timeline.completed,
        progress: calculateProgress(timeline),
    } as unknown as Habit;
};

/** One day of one habit, or `null` when the habit has nothing to say about it. */
export const presentDay = (
    habit: IHabit,
    timeline: Timeline,
    logs: readonly LoggedDay[],
    day: DayNumber,
): HabitDay | null => {
    const cell = timeline.cells.get(day);
    if (!cell) return null;

    const log = logs.find(entry => toDayNumber(entry.day) === day);
    const rule = rulesOf(habit)[cell.ruleIndex];
    const program = habit.program;

    return {
        date: iso(day),
        state: cell.state,
        value: log?.value ?? undefined,
        target: rule.target,
        completedSteps: (log?.completedSteps ?? []).map(String),
        session:
            cell.session !== undefined && program
                ? {
                    index: cell.session,
                    total: program.length,
                    title: program[cell.session - 1]?.title ?? habit.title,
                }
                : undefined,
        week: cell.segment ? { done: cell.segment.done, target: cell.segment.target } : undefined,
        note: log?.note ?? undefined,
        failureReason: log?.failureReason
            ? { code: log.failureReason.code, text: log.failureReason.text ?? undefined }
            : undefined,
        reasonPrompted: log?.reasonPrompted ?? undefined,
    };
};

export const presentSummary = (
    habit: IHabit,
    logs: readonly LoggedDay[],
    today: DayNumber,
    day: DayNumber,
): HabitSummary | null => {
    const { timeline, streak } = evaluate(habit, logs, today, day);
    const dayView = presentDay(habit, timeline, logs, day);
    if (!dayView) return null;

    return { ...describe(habit, timeline, streak, today), day: dayView };
};

/** A habit with everything it holds, for the account export. */
export const presentExport = (
    habit: IHabit,
    logs: readonly LoggedDay[],
    today: DayNumber,
): HabitExport => ({
    ...presentHabit(habit, logs, today),
    program: habit.program?.map(session => ({ title: session.title })),
    days: [...logs]
        .sort((a, b) => a.day.getTime() - b.day.getTime())
        .map(log => ({
            day: log.day.toISOString(),
            status: log.status ?? undefined,
            value: log.value ?? undefined,
            completedSteps: log.completedSteps.map(String),
            note: log.note ?? undefined,
            failureReason: log.failureReason
                ? { code: log.failureReason.code, text: log.failureReason.text ?? undefined }
                : undefined,
            reasonPrompted: log.reasonPrompted ?? undefined,
        })),
});

/** Groups a user's whole log by habit, so listing many habits costs one query. */
export const groupByHabit = (logs: readonly LoggedDay[]): Map<string, LoggedDay[]> => {
    const grouped = new Map<string, LoggedDay[]>();
    for (const log of logs) {
        const key = String(log.habitId);
        const entries = grouped.get(key);
        if (entries) entries.push(log);
        else grouped.set(key, [log]);
    }
    return grouped;
};
