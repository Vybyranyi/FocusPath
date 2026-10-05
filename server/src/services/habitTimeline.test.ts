import {
    buildTimeline,
    calculateProgress,
    calculateStreak,
    fromDayNumber,
    resolveDayState,
    toDayNumber,
    weekdayOf,
    weekOf,
    type TimelineInput,
    type TimelineLog,
} from '@services/habitTimeline';

// A Wednesday. Monday of that week is `day(-2)`, the next Monday `day(5)`.
const TODAY = toDayNumber('2026-03-18');
const day = (offset: number) => fromDayNumber(TODAY + offset);

const done = (offset: number): TimelineLog => ({ day: day(offset), status: 'done' });
const failed = (offset: number): TimelineLog => ({ day: day(offset), status: 'failed' });
const valued = (offset: number, value: number): TimelineLog => ({ day: day(offset), value });

const habit = (overrides: Partial<TimelineInput> = {}): TimelineInput => ({
    type: 'build',
    startDate: day(-4),
    rules: [{ effectiveFrom: day(-4), frequency: { kind: 'daily' } }],
    ...overrides,
});

const build = (input: TimelineInput, logs: TimelineLog[] = [], horizon?: number) =>
    buildTimeline(input, logs, TODAY, horizon === undefined ? undefined : TODAY + horizon);

const streak = (input: TimelineInput, logs: TimelineLog[] = []) =>
    calculateStreak(input, build(input, logs), TODAY);

describe('weekdays and weeks', () => {
    it('numbers days Monday = 1 through Sunday = 7', () => {
        expect(weekdayOf(TODAY)).toBe(3);
        expect(weekdayOf(TODAY - 2)).toBe(1);
        expect(weekdayOf(TODAY + 4)).toBe(7);
        expect(weekdayOf(0)).toBe(4); // 1970-01-01 was a Thursday
    });

    it('puts Sunday and the following Monday in different weeks', () => {
        expect(weekOf(TODAY + 4)).not.toBe(weekOf(TODAY + 5));
        expect(weekOf(TODAY - 2)).toBe(weekOf(TODAY + 4));
    });
});

describe('resolveDayState', () => {
    const target = { value: 8, unit: 'glasses' };

    it('lets an explicit status win', () => {
        expect(resolveDayState('build', target, { day: day(0), status: 'failed', value: 9 }, TODAY, TODAY))
            .toBe('failed');
    });

    it('calls an unmarked past day missed and today pending', () => {
        expect(resolveDayState('build', undefined, undefined, TODAY - 1, TODAY)).toBe('missed');
        expect(resolveDayState('build', undefined, undefined, TODAY, TODAY)).toBe('pending');
    });

    it('finishes a build day at the target', () => {
        expect(resolveDayState('build', target, { day: day(0), value: 7 }, TODAY, TODAY)).toBe('pending');
        expect(resolveDayState('build', target, { day: day(0), value: 8 }, TODAY, TODAY)).toBe('done');
        expect(resolveDayState('build', target, { day: day(-1), value: 3 }, TODAY - 1, TODAY)).toBe('missed');
    });

    it('fails a quit day the moment the limit is exceeded', () => {
        expect(resolveDayState('quit', target, { day: day(0), value: 9 }, TODAY, TODAY)).toBe('failed');
    });

    it('keeps a quit day within the limit pending until it is over', () => {
        expect(resolveDayState('quit', target, { day: day(0), value: 0 }, TODAY, TODAY)).toBe('pending');
        expect(resolveDayState('quit', target, { day: day(-1), value: 8 }, TODAY - 1, TODAY)).toBe('done');
    });

    it('calls a past quit day with nothing logged missed', () => {
        expect(resolveDayState('quit', target, undefined, TODAY - 1, TODAY)).toBe('missed');
    });
});

describe('a daily habit', () => {
    it('has a slot on every day from the start', () => {
        const timeline = build(habit(), [], 2);

        expect([...timeline.cells.keys()]).toEqual([-4, -3, -2, -1, 0, 1, 2].map(n => TODAY + n));
        expect([...timeline.cells.values()].every(cell => cell.kind === 'slot')).toBe(true);
    });

    it('reads each day from the log and the date', () => {
        const timeline = build(habit(), [done(-3), failed(-2)]);

        expect(timeline.cells.get(TODAY - 4)?.state).toBe('missed');
        expect(timeline.cells.get(TODAY - 3)?.state).toBe('done');
        expect(timeline.cells.get(TODAY - 2)?.state).toBe('failed');
        expect(timeline.cells.get(TODAY - 1)?.state).toBe('missed');
        expect(timeline.cells.get(TODAY)?.state).toBe('pending');
    });

    it('has no end of its own', () => {
        const timeline = build(habit());

        expect(timeline.endDay).toBeUndefined();
        expect(timeline.completed).toBe(false);
    });

    it('does not exist before its start', () => {
        expect(build(habit()).cells.has(TODAY - 5)).toBe(false);
    });
});

describe('a programme', () => {
    it('numbers its sessions from the first slot', () => {
        const timeline = build(habit({ sessions: 10 }));

        expect(timeline.cells.get(TODAY - 4)?.session).toBe(1);
        expect(timeline.cells.get(TODAY)?.session).toBe(5);
    });

    it('ends after its last session, projected into the future', () => {
        const timeline = build(habit({ sessions: 10 }));

        expect(timeline.endDay).toBe(TODAY + 5);
        expect(timeline.cells.has(TODAY + 6)).toBe(false);
        expect(timeline.cells.get(TODAY + 5)?.session).toBe(10);
    });

    it('is complete once every session is behind it, done or not', () => {
        const input = habit({ sessions: 3, startDate: day(-4), rules: [{ effectiveFrom: day(-4), frequency: { kind: 'daily' } }] });
        const timeline = build(input, [done(-4), failed(-3)]);

        expect(timeline.completed).toBe(true);
        expect(timeline.endDay).toBe(TODAY - 2);
    });

    it('is not complete while a session is still open', () => {
        // The fifth session is today, and today is not decided until it is marked.
        const open = build(habit({ sessions: 5 }), [done(-4), done(-3), done(-2), done(-1)]);
        const marked = build(habit({ sessions: 5 }), [done(-4), done(-3), done(-2), done(-1), done(0)]);

        expect(open.completed).toBe(false);
        expect(marked.completed).toBe(true);
    });

    it('treats a missed slot as a consumed session and moves on', () => {
        const timeline = build(habit({ sessions: 4 }));

        // Nothing was done, yet the programme still ends on the fourth day.
        expect(timeline.endDay).toBe(TODAY - 1);
        expect(timeline.completed).toBe(true);
        expect(calculateProgress(timeline)).toMatchObject({ done: 0, decided: 4, percentage: 0 });
    });
});

describe('weekdays', () => {
    const mondayWednesday = habit({
        startDate: day(-9),
        rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekdays', days: [1, 3] } }],
    });

    it('is scheduled only on the days it names', () => {
        const timeline = build(mondayWednesday);

        // day(-9) is Monday 2026-03-09; day(-7) Wednesday; day(-2) Monday; day(0) Wednesday.
        expect([...timeline.cells.keys()]).toEqual([-9, -7, -2, 0].map(n => TODAY + n));
    });

    it('counts sessions on scheduled days only', () => {
        const timeline = build({ ...mondayWednesday, sessions: 4 });

        expect([...timeline.cells.values()].map(cell => cell.session)).toEqual([1, 2, 3, 4]);
        expect(timeline.endDay).toBe(TODAY);
    });
});

describe('pauses and rest days', () => {
    it('gives a paused day no slot and no session', () => {
        const timeline = build(
            habit({ sessions: 3, pauses: [{ from: day(-3), to: day(-2) }] }),
        );

        expect(timeline.cells.get(TODAY - 3)).toMatchObject({ kind: 'paused', state: 'paused' });
        expect(timeline.cells.get(TODAY - 3)?.session).toBeUndefined();
        // Sessions 1 (day -4), 2 (day -1), 3 (today) — the pause took none.
        expect(timeline.cells.get(TODAY - 1)?.session).toBe(2);
        expect(timeline.endDay).toBe(TODAY);
    });

    it('pushes the end of a programme out by the length of the pause', () => {
        const without = build(habit({ sessions: 10 }));
        const paused = build(habit({ sessions: 10, pauses: [{ from: day(1), to: day(3) }] }));

        expect(paused.endDay).toBe(without.endDay! + 3);
    });

    it('cannot project the end of a programme paused with no end', () => {
        const timeline = build(habit({ sessions: 10, pauses: [{ from: day(1) }] }));

        expect(timeline.endDay).toBeUndefined();
        expect(timeline.completed).toBe(false);
    });

    it('shows a rest day as one the habit is not asked for', () => {
        const timeline = build(habit({ restDays: [day(0)] }));

        expect(timeline.cells.get(TODAY)).toMatchObject({ kind: 'rest', state: 'rest' });
    });

    it('does not let a rest day consume a session', () => {
        const timeline = build(habit({ sessions: 5, restDays: [day(0)] }));

        expect(timeline.endDay).toBe(TODAY + 1);
    });

    it('ignores rest days on habits that are not daily', () => {
        const timeline = build(
            habit({
                restDays: [day(0)],
                rules: [{ effectiveFrom: day(-4), frequency: { kind: 'weekdays', days: [3] } }],
            }),
        );

        expect(timeline.cells.get(TODAY)?.kind).toBe('slot');
    });
});

describe('a weekly habit', () => {
    // Started the Monday of this week, three times a week.
    const weekly = (extra: Partial<TimelineInput> = {}) =>
        habit({
            startDate: day(-2),
            rules: [{ effectiveFrom: day(-2), frequency: { kind: 'weekly', times: 3 } }],
            ...extra,
        });

    it('offers every day of the week as a way to fill a slot', () => {
        const timeline = build(weekly(), [], 4);

        expect([...timeline.cells.values()].every(cell => cell.kind === 'flex')).toBe(true);
        expect(timeline.segments).toHaveLength(1);
        expect(timeline.segments[0]).toMatchObject({ target: 3, slots: 3, done: 0, status: 'open' });
    });

    it('does not call an unmarked day missed', () => {
        expect(build(weekly()).cells.get(TODAY - 1)?.state).toBe('pending');
    });

    it('meets the week once enough days are done', () => {
        const timeline = build(weekly(), [done(-2), done(-1), done(0)]);

        expect(timeline.segments[0].status).toBe('met');
        expect(timeline.doneSlots).toBe(3);
    });

    it('carries the next unfilled session on a day that has not been done', () => {
        const timeline = build(weekly({ sessions: 12 }), [done(-2)]);

        expect(timeline.cells.get(TODAY - 2)?.session).toBe(1);
        expect(timeline.cells.get(TODAY)?.session).toBe(2);
    });

    it('misses the slots of a week that ended short', () => {
        const input = habit({
            startDate: day(-9),
            rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekly', times: 3 } }],
        });
        const timeline = build(input, [done(-9)]);

        const first = timeline.segments[0];
        expect(first).toMatchObject({ done: 1, over: true, status: 'missed' });
        expect(timeline.decidedSlots).toBe(3);
        expect(timeline.doneSlots).toBe(1);
    });

    it('asks no more of a first week than it had days', () => {
        // Started on Sunday: one day left of the week, so one slot.
        const input = habit({
            startDate: day(4),
            rules: [{ effectiveFrom: day(4), frequency: { kind: 'weekly', times: 3 } }],
        });
        const timeline = build(input, [], 6);

        expect(timeline.segments[0]).toMatchObject({ target: 3, slots: 1 });
    });

    it('excuses a week with a pause that did not reach its target', () => {
        const input = habit({
            startDate: day(-9),
            rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekly', times: 3 } }],
            pauses: [{ from: day(-8), to: day(-5) }],
        });
        const timeline = build(input, [done(-9), done(-4)]);

        expect(timeline.segments[0]).toMatchObject({ status: 'excused', slots: 2, done: 2 });
        // Only what was done is counted — nothing was missed.
        expect(timeline.decidedSlots).toBe(2 + 0);
    });

    it('counts a paused week whose target was reached all the same', () => {
        const input = habit({
            startDate: day(-9),
            rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekly', times: 2 } }],
            pauses: [{ from: day(-8), to: day(-7) }],
        });
        const timeline = build(input, [done(-9), done(-6)]);

        expect(timeline.segments[0].status).toBe('met');
    });

    it('cuts the last week of a programme to what is left', () => {
        const timeline = build(weekly({ sessions: 4 }), [], 10);

        expect(timeline.segments.map(segment => segment.target)).toEqual([3, 1]);
        // The second week runs to its Sunday, eleven days from today.
        expect(timeline.endDay).toBe(TODAY + 11);
    });
});

describe('a change of rule', () => {
    it('judges each day by the rule in force on it', () => {
        const input = habit({
            startDate: day(-4),
            rules: [
                { effectiveFrom: day(-4), frequency: { kind: 'daily' } },
                { effectiveFrom: day(-1), frequency: { kind: 'weekdays', days: [3] } },
            ],
        });
        const timeline = build(input, [], 1);

        // Daily until the change, then Wednesdays only: day(-1)/day(1) are Tue/Thu.
        expect([...timeline.cells.keys()]).toEqual([-4, -3, -2, 0].map(n => TODAY + n));
        expect(timeline.cells.get(TODAY)?.ruleIndex).toBe(1);
    });

    it('applies the target of the rule in force', () => {
        const input = habit({
            rules: [
                { effectiveFrom: day(-4), frequency: { kind: 'daily' } },
                { effectiveFrom: day(-1), frequency: { kind: 'daily' }, target: { value: 5, unit: 'km' } },
            ],
        });
        const timeline = build(input, [valued(-2, 1), valued(0, 5)]);

        // Before the target existed, a bare value means nothing: the day is missed.
        expect(timeline.cells.get(TODAY - 2)?.state).toBe('missed');
        expect(timeline.cells.get(TODAY)?.state).toBe('done');
    });
});

describe('streak', () => {
    it('counts days done up to today', () => {
        expect(streak(habit(), [done(-2), done(-1), done(0)])).toEqual({ value: 3, unit: 'day' });
    });

    it('keeps a run alive while today is still undecided', () => {
        expect(streak(habit(), [done(-2), done(-1)]).value).toBe(2);
    });

    it('ends the run the moment today is marked failed', () => {
        expect(streak(habit(), [done(-2), done(-1), failed(0)]).value).toBe(0);
    });

    it('is broken by a missed day', () => {
        expect(streak(habit(), [done(-4), done(-2), done(-1), done(0)]).value).toBe(3);
    });

    it('skips rest days and paused days without counting them', () => {
        const input = habit({ restDays: [day(-2)], pauses: [{ from: day(-3), to: day(-3) }] });

        expect(streak(input, [done(-4), done(-1), done(0)]).value).toBe(3);
    });

    it('counts only the days a weekdays habit is scheduled on', () => {
        const input = habit({
            startDate: day(-9),
            rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekdays', days: [1, 3] } }],
        });

        expect(streak(input, [done(-9), done(-7), done(-2), done(0)]).value).toBe(4);
    });

    it('counts weeks for a weekly habit', () => {
        const input = habit({
            startDate: day(-9),
            rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekly', times: 2 } }],
        });

        // Last week (days -9..-3) done twice; this week done twice.
        const result = streak(input, [done(-9), done(-8), done(-2), done(-1)]);
        expect(result).toEqual({ value: 2, unit: 'week' });
    });

    it('does not break on a week of a weekly habit that is still open', () => {
        const input = habit({
            startDate: day(-9),
            rules: [{ effectiveFrom: day(-9), frequency: { kind: 'weekly', times: 2 } }],
        });

        expect(streak(input, [done(-9), done(-8)]).value).toBe(1);
    });

    it('breaks on a past week that fell short', () => {
        const input = habit({
            startDate: day(-16),
            rules: [{ effectiveFrom: day(-16), frequency: { kind: 'weekly', times: 2 } }],
        });

        // Two weeks ago met, last week missed, this week met.
        expect(streak(input, [done(-16), done(-15), done(-2), done(-1)]).value).toBe(1);
    });

    it('steps over a paused week that fell short', () => {
        const input = habit({
            startDate: day(-16),
            rules: [{ effectiveFrom: day(-16), frequency: { kind: 'weekly', times: 2 } }],
            pauses: [{ from: day(-8), to: day(-3) }],
        });

        expect(streak(input, [done(-16), done(-15), done(-2), done(-1)]).value).toBe(2);
    });

    it('starts again when the unit changes', () => {
        const input = habit({
            startDate: day(-9),
            rules: [
                { effectiveFrom: day(-9), frequency: { kind: 'daily' } },
                { effectiveFrom: day(-2), frequency: { kind: 'weekly', times: 2 } },
            ],
        });
        const logs = [done(-9), done(-8), done(-7), done(-6), done(-5), done(-4), done(-3)];

        expect(streak(input, logs)).toEqual({ value: 0, unit: 'week' });
    });

    it('keeps the run across a change that leaves the unit alone', () => {
        const input = habit({
            startDate: day(-4),
            rules: [
                { effectiveFrom: day(-4), frequency: { kind: 'daily' } },
                { effectiveFrom: day(-2), frequency: { kind: 'weekdays', days: [1, 2, 3, 4, 5, 6, 7] } },
            ],
        });

        expect(streak(input, [done(-4), done(-3), done(-2), done(-1), done(0)]).value).toBe(5);
    });

    it('is zero a day after a programme ended', () => {
        const input = habit({ sessions: 2, startDate: day(-4), rules: [{ effectiveFrom: day(-4), frequency: { kind: 'daily' } }] });

        expect(streak(input, [done(-4), done(-3)]).value).toBe(0);
    });
});

describe('progress', () => {
    it('is the share of slots decided so far that were done', () => {
        const progress = calculateProgress(build(habit(), [done(-3), done(-2)]));

        // Four slots are over (days -4..-1), two done; today is not in the denominator.
        expect(progress).toMatchObject({ done: 2, decided: 4, percentage: 50 });
    });

    it('does not put the future in the denominator', () => {
        const progress = calculateProgress(build(habit({ sessions: 30 }), [done(-4), done(-3), done(-2), done(-1), done(0)]));

        expect(progress.percentage).toBe(100);
        expect(progress.sessionsTotal).toBe(30);
    });

    it('is zero before anything is decided', () => {
        const input = habit({ startDate: day(0), rules: [{ effectiveFrom: day(0), frequency: { kind: 'daily' } }] });

        expect(calculateProgress(build(input)).percentage).toBe(0);
    });
});
