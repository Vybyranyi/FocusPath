import type { DayState, DayStatus, Frequency, HabitType, Target } from '@shared/index';
import { MS_PER_DAY } from '@utils/dates';

/**
 * Habit model 2.0 stores *rules*, not rows: what a habit asks for and from when,
 * plus a log of the days something actually happened on. Everything a screen
 * needs — which days are scheduled, what each is worth, the streak, how far
 * through a programme — is worked out here, from those two inputs, by pure
 * functions with the clock injected. No job runs at midnight, so nothing
 * derived is ever stored where it could go stale.
 *
 * Days are handled as whole numbers since the epoch (UTC). It makes "the day
 * before", week arithmetic and map keys trivial, and it cannot drift by an hour
 * the way a `Date` can.
 */

export type DayNumber = number;

export const toDayNumber = (value: Date | string | number): DayNumber =>
    Math.floor(new Date(value).getTime() / MS_PER_DAY);

export const fromDayNumber = (day: DayNumber): Date => new Date(day * MS_PER_DAY);

/** 1 = Monday … 7 = Sunday. The epoch fell on a Thursday, hence the offset. */
export const weekdayOf = (day: DayNumber): number => (((day + 3) % 7) + 7) % 7 + 1;

/** Index of the Monday–Sunday week a day belongs to. */
export const weekOf = (day: DayNumber): number => Math.floor((day + 3) / 7);

const weekStart = (week: number): DayNumber => week * 7 - 3;
const weekEnd = (week: number): DayNumber => weekStart(week) + 6;

export interface TimelineRule {
    effectiveFrom: Date | string;
    frequency: Frequency;
    target?: Target;
}

export interface TimelinePause {
    from: Date | string;
    to?: Date | string | null;
}

/** One day of the log. A day with nothing to record has no entry at all. */
export interface TimelineLog {
    day: Date | string;
    status?: Exclude<DayStatus, 'pending'> | null;
    value?: number | null;
}

export interface TimelineInput {
    type: HabitType;
    startDate: Date | string;
    /** Ordered by `effectiveFrom`; the first one starts at `startDate`. */
    rules: readonly TimelineRule[];
    pauses?: readonly TimelinePause[];
    restDays?: ReadonlyArray<Date | string>;
    /** Length of the programme in sessions. Absent means the habit has no end. */
    sessions?: number;
}

/**
 * - `slot`: a day the habit is scheduled on;
 * - `flex`: a day of a weekly habit — any of them may fill one of the week's slots;
 * - `paused` / `rest`: days that deliberately do not count.
 *
 * Days a weekdays habit is simply not scheduled on have no cell at all.
 */
export type CellKind = 'slot' | 'flex' | 'paused' | 'rest';

/**
 * One Monday–Sunday week of a weekly habit, or the part of it one rule covers.
 *
 * `slots` is how many sessions the week holds: `times`, cut short by days the
 * habit did not exist for (the first week, a rule change) and by what is left of
 * a programme. A week with a pause that ended short of its target is *excused*:
 * it neither counts nor breaks anything, and takes only the sessions that were
 * really done.
 */
export interface WeekSegment {
    week: number;
    ruleIndex: number;
    /** Sessions the week was asked for. */
    target: number;
    /** Sessions that actually take part in the count, after excusing. */
    slots: number;
    done: number;
    over: boolean;
    hasPause: boolean;
    status: 'met' | 'excused' | 'open' | 'missed';
}

export interface Cell {
    day: DayNumber;
    kind: CellKind;
    state: DayState;
    ruleIndex: number;
    /** 1-based number of the programme session the day carries. */
    session?: number;
    value?: number;
    segment?: WeekSegment;
}

export interface Timeline {
    cells: Map<DayNumber, Cell>;
    segments: WeekSegment[];
    /** Slots that were done. */
    doneSlots: number;
    /** Slots that are over one way or another: done, failed or missed. */
    decidedSlots: number;
    sessionsTotal?: number;
    /** Last day of the programme. A forecast until it has passed; absent when it cannot be known. */
    endDay?: DayNumber;
    /** Every session of the programme is behind. Never true for a habit without an end. */
    completed: boolean;
    startDay: DayNumber;
}

/** How far past today a programme is projected when pauses keep pushing its end out. */
const MAX_FORECAST_DAYS = 3 * 366;

/**
 * What a scheduled day is worth, given the target in force that day and what
 * was logged on it.
 *
 * A status the person set explicitly always wins. Otherwise a quantity decides:
 * a `build` day is done once it reaches the target; a `quit` day is failed the
 * moment it exceeds the limit, but done only when it is over, because until
 * midnight the limit can still be broken.
 */
export const resolveDayState = (
    type: HabitType,
    target: Target | undefined,
    log: TimelineLog | undefined,
    day: DayNumber,
    today: DayNumber,
): 'pending' | 'done' | 'failed' | 'missed' => {
    if (log?.status) return log.status;

    const past = day < today;
    const value = log?.value ?? undefined;

    if (target && value !== undefined) {
        if (type === 'quit') {
            if (value > target.value) return 'failed';
            return past ? 'done' : 'pending';
        }
        if (value >= target.value) return 'done';
    }

    return past ? 'missed' : 'pending';
}

const unitOf = (rule: TimelineRule): 'day' | 'week' =>
    rule.frequency.kind === 'weekly' ? 'week' : 'day';

interface PreparedRule {
    from: DayNumber;
    rule: TimelineRule;
}

/**
 * Lays the habit out day by day.
 *
 * Walks from the start through `max(today, horizon)`; a programme is walked on
 * to its last session, so its end date can be shown before it arrives and
 * moves with every pause.
 */
export const buildTimeline = (
    input: TimelineInput,
    logs: Iterable<TimelineLog>,
    today: DayNumber,
    horizon: DayNumber = today,
): Timeline => {
    const startDay = toDayNumber(input.startDate);
    const total = input.sessions;
    const type = input.type;

    const rules: PreparedRule[] = input.rules.map(rule => ({
        from: toDayNumber(rule.effectiveFrom),
        rule,
    }));
    const pauses = (input.pauses ?? []).map(pause => ({
        from: toDayNumber(pause.from),
        to: pause.to ? toDayNumber(pause.to) : undefined,
    }));
    const restDays = new Set((input.restDays ?? []).map(toDayNumber));

    const logByDay = new Map<DayNumber, TimelineLog>();
    for (const log of logs) logByDay.set(toDayNumber(log.day), log);

    const ruleIndexAt = (day: DayNumber): number => {
        let found = 0;
        rules.forEach((prepared, index) => {
            if (prepared.from <= day) found = index;
        });
        return found;
    };

    const pausedOn = (day: DayNumber) =>
        pauses.find(pause => day >= pause.from && (pause.to === undefined || day <= pause.to));

    const timeline: Timeline = {
        cells: new Map(),
        segments: [],
        doneSlots: 0,
        decidedSlots: 0,
        sessionsTotal: total,
        completed: false,
        startDay,
    };

    const limit = Math.max(today, horizon);
    const cap = limit + MAX_FORECAST_DAYS;

    /** Sessions handed out so far, open ones included. */
    let placed = 0;
    let lastDay = startDay;
    let day = startDay;

    const stateOn = (target: Target | undefined, at: DayNumber) =>
        resolveDayState(type, target, logByDay.get(at), at, today);

    const reachedEnd = () => total !== undefined && placed >= total;

    while (day <= cap) {
        if (total === undefined ? day > limit : reachedEnd()) break;

        const pause = pausedOn(day);
        if (pause) {
            // An open pause has no end to project past: the programme's end is
            // unknown until the person comes back.
            if (total !== undefined && day > limit && pause.to === undefined) break;

            timeline.cells.set(day, {
                day,
                kind: 'paused',
                state: 'paused',
                ruleIndex: ruleIndexAt(day),
            });
            day++;
            continue;
        }

        const ruleIndex = ruleIndexAt(day);
        const { rule } = rules[ruleIndex];
        const { frequency, target } = rule;

        if (frequency.kind === 'daily' && restDays.has(day)) {
            timeline.cells.set(day, { day, kind: 'rest', state: 'rest', ruleIndex });
            day++;
            continue;
        }

        if (frequency.kind === 'weekdays' || frequency.kind === 'daily') {
            if (frequency.kind === 'weekdays' && !frequency.days.includes(weekdayOf(day))) {
                day++;
                continue;
            }

            placed++;
            lastDay = day;
            const state = stateOn(target, day);
            const log = logByDay.get(day);

            timeline.cells.set(day, {
                day,
                kind: 'slot',
                state,
                ruleIndex,
                session: placed,
                value: log?.value ?? undefined,
            });

            if (state === 'done') timeline.doneSlots++;
            if (state !== 'pending') timeline.decidedSlots++;

            day++;
            continue;
        }

        // A weekly habit. The segment is the stretch of this week the rule
        // covers; days inside it that are paused still get their own cell.
        const week = weekOf(day);
        const nextRuleStart = rules[ruleIndex + 1]?.from ?? Infinity;
        const segmentEnd = Math.min(weekEnd(week), nextRuleStart - 1);

        const segmentDays: DayNumber[] = [];
        let hasPause = false;
        for (let at = day; at <= segmentEnd; at++) {
            if (pausedOn(at)) {
                hasPause = true;
                timeline.cells.set(at, {
                    day: at,
                    kind: 'paused',
                    state: 'paused',
                    ruleIndex,
                });
            } else {
                segmentDays.push(at);
            }
        }

        const remaining = total === undefined ? Infinity : total - placed;
        const weekTarget = Math.min(frequency.times, remaining);
        const capacity = Math.min(weekTarget, segmentDays.length);

        const doneDays = segmentDays.filter(at => stateOn(target, at) === 'done').length;
        const done = Math.min(doneDays, capacity);
        const over = segmentEnd < today;

        let status: WeekSegment['status'];
        let slots = capacity;

        if (capacity === 0) {
            status = 'excused';
        } else if (done >= capacity && (!hasPause || done >= weekTarget)) {
            status = 'met';
        } else if (over) {
            // A pause explains a short week; without one it is simply missed.
            status = hasPause ? 'excused' : 'missed';
            if (hasPause) slots = done;
        } else {
            status = 'open';
        }

        const segment: WeekSegment = {
            week,
            ruleIndex,
            target: weekTarget,
            slots,
            done,
            over,
            hasPause,
            status,
        };
        timeline.segments.push(segment);

        const base = placed;
        let filled = 0;
        for (const at of segmentDays) {
            const log = logByDay.get(at);
            let state: DayState = stateOn(target, at);
            // An unmarked day of a weekly habit is not missed: the slot belongs
            // to the week, not to the day.
            if (state === 'missed') state = 'pending';

            let session: number | undefined;
            if (capacity > 0) {
                session = state === 'done'
                    ? base + Math.min(++filled, capacity)
                    : base + Math.min(done + 1, capacity);
            }

            timeline.cells.set(at, {
                day: at,
                kind: 'flex',
                state,
                ruleIndex,
                session,
                value: log?.value ?? undefined,
                segment,
            });
        }

        timeline.doneSlots += done;
        timeline.decidedSlots += done + (status === 'missed' ? slots - done : 0);

        placed += slots;
        lastDay = segmentEnd;
        day = segmentEnd + 1;
    }

    if (total !== undefined && reachedEnd()) {
        timeline.endDay = lastDay;
        timeline.completed = !hasOpenSlot(timeline);
    }

    return timeline;
};

const hasOpenSlot = (timeline: Timeline): boolean => {
    for (const cell of timeline.cells.values()) {
        if (cell.kind === 'slot' && cell.state === 'pending') return true;
    }
    return timeline.segments.some(segment => segment.status === 'open');
};

export interface Streak {
    value: number;
    unit: 'day' | 'week';
}

/**
 * The run of consecutive slots done, ending now.
 *
 * Daily and weekdays habits count days; a weekly habit counts weeks. Each slot
 * is judged by the rule in force when it fell, and a change of unit starts the
 * count afresh — days and weeks cannot be added together.
 *
 * Today's grace is kept: an undecided slot today does not end a run until the
 * day is over, while an explicit `failed` ends it at once. Days off — pause,
 * rest, a weekday the habit is not scheduled on — are skipped, not counted.
 */
export const calculateStreak = (
    input: TimelineInput,
    timeline: Timeline,
    today: DayNumber,
): Streak => {
    const rules = input.rules.map(rule => ({ from: toDayNumber(rule.effectiveFrom), rule }));
    let current = 0;
    rules.forEach((prepared, index) => {
        if (prepared.from <= today) current = index;
    });

    const unit = unitOf(rules[current].rule);

    // Where the trailing run of rules with the same unit began.
    let unitStart = rules[current].from;
    for (let index = current - 1; index >= 0 && unitOf(rules[index].rule) === unit; index--) {
        unitStart = rules[index].from;
    }
    unitStart = Math.max(unitStart, timeline.startDay);

    // A programme that ended more than a day ago has no run left to speak of.
    if (timeline.endDay !== undefined && today > timeline.endDay + 1) {
        return { value: 0, unit };
    }

    let value = 0;

    if (unit === 'day') {
        for (let day = today; day >= unitStart; day--) {
            const cell = timeline.cells.get(day);
            if (!cell || cell.kind !== 'slot') continue;

            if (cell.state === 'done') {
                value++;
            } else if (!(cell.state === 'pending' && day === today)) {
                break;
            }
        }
        return { value, unit };
    }

    const byWeek = new Map<number, WeekSegment[]>();
    for (const segment of timeline.segments) {
        byWeek.set(segment.week, [...(byWeek.get(segment.week) ?? []), segment]);
    }

    const currentWeek = weekOf(today);
    for (let week = currentWeek; week >= weekOf(unitStart); week--) {
        const segments = (byWeek.get(week) ?? []).filter(segment => segment.status !== 'excused');
        if (segments.length === 0) continue;

        if (segments.some(segment => segment.status === 'missed')) break;

        if (segments.some(segment => segment.status === 'open')) {
            if (week === currentWeek) continue;
            break;
        }

        value++;
    }

    return { value, unit };
};

export interface HabitProgress {
    done: number;
    decided: number;
    /** Done slots over slots that are over, 0–100. The future is not in the denominator. */
    percentage: number;
    sessionsTotal?: number;
}

export const calculateProgress = (timeline: Timeline): HabitProgress => ({
    done: timeline.doneSlots,
    decided: timeline.decidedSlots,
    percentage:
        timeline.decidedSlots === 0
            ? 0
            : Math.round((timeline.doneSlots / timeline.decidedSlots) * 100),
    sessionsTotal: timeline.sessionsTotal,
});
