import {
    findInsights,
    historyDays,
    lastFinishedWeekStart,
    needsRecalibration,
    proposeRecalibration,
    trailingFailures,
    weeklyFacts,
    type CoachHabit,
    type CoachInput,
    type CoachSlot,
    type Outcome,
} from '@services/coachInsights';
import { toDayNumber, weekdayOf } from '@services/habitTimeline';

// A Wednesday.
const TODAY = toDayNumber('2026-03-18');

/** Slots on each of the `days` days before today, outcome decided by the day. */
const slots = (days: number, outcomeOf: (day: number, index: number) => Outcome): CoachSlot[] =>
    Array.from({ length: days }, (_unused, index) => {
        const day = TODAY - days + index;
        return { day, outcome: outcomeOf(day, index) };
    });

const habit = (overrides: Partial<CoachHabit> = {}): CoachHabit => ({
    key: 'h1',
    title: 'Read',
    type: 'build',
    frequency: { kind: 'daily' },
    hasProgram: false,
    startDay: TODAY - 100,
    ruleFrom: TODAY - 100,
    slots: [],
    streak: 0,
    streakUnit: 'day',
    reasons: [],
    ...overrides,
});

const input = (habits: CoachHabit[], journal: CoachInput['journal'] = []): CoachInput => ({
    habits,
    journal,
    today: TODAY,
});

describe('trailingFailures', () => {
    it('counts the slots at the end that were not done', () => {
        const h = habit({ slots: slots(5, (_d, i) => (i < 2 ? 'done' : i === 2 ? 'failed' : 'missed')) });

        expect(trailingFailures(h)).toBe(3);
    });

    it('is zero when the last slot was done', () => {
        expect(trailingFailures(habit({ slots: slots(4, (_d, i) => (i === 3 ? 'done' : 'failed')) }))).toBe(0);
    });

    it('counts failed and missed alike', () => {
        expect(trailingFailures(habit({ slots: slots(3, (_d, i) => (i === 1 ? 'missed' : 'failed')) }))).toBe(3);
    });

    it('is zero for a habit with nothing decided yet', () => {
        expect(trailingFailures(habit())).toBe(0);
    });
});

describe('needsRecalibration', () => {
    const failing = (overrides: Partial<CoachHabit> = {}) =>
        habit({ slots: slots(3, () => 'failed'), ...overrides });

    it('wants three failures in a row, not two', () => {
        expect(needsRecalibration(failing(), TODAY)).toBe(true);
        expect(needsRecalibration(habit({ slots: slots(2, () => 'failed') }), TODAY)).toBe(false);
    });

    it('leaves a habit whose rule was changed this week to have a fair run', () => {
        expect(needsRecalibration(failing({ ruleFrom: TODAY - 3 }), TODAY)).toBe(false);
        expect(needsRecalibration(failing({ ruleFrom: TODAY - 7 }), TODAY)).toBe(true);
    });
});

describe('proposeRecalibration', () => {
    const target = (value: number, type: 'build' | 'quit') =>
        habit({ type, target: { value, unit: 'glasses' } });

    it('takes a quarter off a build goal, rounded down', () => {
        expect(proposeRecalibration(target(8, 'build'), TODAY)?.to.target?.value).toBe(6);
        expect(proposeRecalibration(target(10, 'build'), TODAY)?.to.target?.value).toBe(7);
    });

    it('never takes a build goal below one', () => {
        expect(proposeRecalibration(target(2, 'build'), TODAY)?.to.target?.value).toBe(1);
        expect(proposeRecalibration(target(1, 'build'), TODAY)).toBeNull();
    });

    it('lets a quit limit rise a quarter, rounded up — a step back, not a failure', () => {
        expect(proposeRecalibration(target(4, 'quit'), TODAY)?.to.target?.value).toBe(5);
        expect(proposeRecalibration(target(1, 'quit'), TODAY)?.to.target?.value).toBe(2);
        expect(proposeRecalibration(target(10, 'quit'), TODAY)?.to.target?.value).toBe(13);
    });

    it('keeps the unit and the rhythm when only the goal moves', () => {
        const proposal = proposeRecalibration(
            habit({ frequency: { kind: 'weekly', times: 3 }, target: { value: 8, unit: 'km' } }),
            TODAY,
        );

        expect(proposal?.to).toEqual({ frequency: { kind: 'weekly', times: 3 }, target: { value: 6, unit: 'km' } });
    });

    it('prefers easing the goal to easing the rhythm', () => {
        const proposal = proposeRecalibration(
            habit({ frequency: { kind: 'daily' }, target: { value: 8, unit: 'km' } }),
            TODAY,
        );

        expect(proposal?.to.frequency).toEqual({ kind: 'daily' });
    });

    it('makes a daily habit five a week', () => {
        expect(proposeRecalibration(habit(), TODAY)?.to.frequency).toEqual({ kind: 'weekly', times: 5 });
    });

    it('takes one off a weekly habit, and stops at one', () => {
        expect(proposeRecalibration(habit({ frequency: { kind: 'weekly', times: 3 } }), TODAY)?.to.frequency)
            .toEqual({ kind: 'weekly', times: 2 });
        expect(proposeRecalibration(habit({ frequency: { kind: 'weekly', times: 1 } }), TODAY)).toBeNull();
    });

    it('drops the weekday that goes worst from chosen days', () => {
        const everyMonOrFri = slots(56, day => (weekdayOf(day) === 5 ? 'failed' : 'done'))
            .filter(slot => [1, 5].includes(weekdayOf(slot.day)));
        const h = habit({ frequency: { kind: 'weekdays', days: [1, 5] }, slots: everyMonOrFri });

        expect(proposeRecalibration(h, TODAY)?.to.frequency).toEqual({ kind: 'weekdays', days: [1] });
    });

    it('never drops the only weekday', () => {
        expect(proposeRecalibration(habit({ frequency: { kind: 'weekdays', days: [3] } }), TODAY)).toBeNull();
    });

    it('says the programme will be rewritten, only for a programme', () => {
        expect(proposeRecalibration(habit({ hasProgram: true }), TODAY)?.rewritesProgram).toBe(true);
        expect(proposeRecalibration(habit(), TODAY)?.rewritesProgram).toBe(false);
    });

    it('remembers the rule it was worked out against', () => {
        const proposal = proposeRecalibration(habit({ frequency: { kind: 'weekly', times: 4 } }), TODAY);

        expect(proposal?.from).toEqual({ frequency: { kind: 'weekly', times: 4 }, target: undefined });
    });
});

describe('insights', () => {
    describe('a day of the week that goes badly', () => {
        /** Fails every Monday and nothing else, over eight weeks. */
        const mondays = (extra: (day: number) => Outcome = () => 'done') =>
            slots(56, day => (weekdayOf(day) === 1 ? 'failed' : extra(day)));

        it('is found when one weekday fails far more than the rest', () => {
            const found = findInsights(input([habit({ slots: mondays() })]));

            expect(found[0]).toMatchObject({ kind: 'weekday_failures', weekday: 1, fails: 8, slots: 8 });
        });

        it('is silent when it has had too few slots', () => {
            // Only three Mondays inside the window of slots.
            const few = habit({ slots: slots(21, day => (weekdayOf(day) === 1 ? 'failed' : 'done')) });

            expect(findInsights(input([few])).filter(i => i.kind === 'weekday_failures')).toEqual([]);
        });

        it('is silent when it has failed too few times', () => {
            // Four Mondays, two failed.
            const h = habit({
                slots: slots(28, (day, index) => (weekdayOf(day) === 1 && index < 14 ? 'failed' : 'done')),
            });

            expect(findInsights(input([h])).filter(i => i.kind === 'weekday_failures')).toEqual([]);
        });

        it('is silent when every day fails alike', () => {
            const h = habit({ slots: slots(56, () => 'failed') });

            expect(findInsights(input([h])).filter(i => i.kind === 'weekday_failures')).toEqual([]);
        });

        it('is silent when the day is only a little worse than the rest', () => {
            // Mondays fail 4 of 8; the other days fail 3 of 6 each — not twice as bad.
            const h = habit({
                slots: slots(56, (day, index) =>
                    weekdayOf(day) === 1 ? (index % 14 < 7 ? 'failed' : 'done') : index % 2 === 0 ? 'failed' : 'done'),
            });

            expect(findInsights(input([h])).filter(i => i.kind === 'weekday_failures')).toEqual([]);
        });

        it('is not looked for in a habit that has no particular days', () => {
            const h = habit({ frequency: { kind: 'weekly', times: 3 }, slots: mondays() });

            expect(findInsights(input([h])).filter(i => i.kind === 'weekday_failures')).toEqual([]);
        });

        it('is told apart by habit and by day, so each can be told once', () => {
            const found = findInsights(input([habit({ slots: mondays() })]));

            expect(found[0].fingerprint).toBe('weekday_failures:h1:1');
        });
    });

    describe('the reason that comes up most', () => {
        const withReasons = (codes: string[]) =>
            habit({
                reasons: codes.map((code, index) => ({ day: TODAY - 1 - index, code: code as never })),
            });

        it('is found when one reason is half of at least five answers', () => {
            const found = findInsights(input([withReasons(['no_time', 'no_time', 'no_time', 'forgot', 'ill'])]));

            expect(found[0]).toMatchObject({ kind: 'top_reason', code: 'no_time', count: 3, total: 5 });
        });

        it('is silent below five answers', () => {
            expect(findInsights(input([withReasons(['no_time', 'no_time', 'no_time', 'no_time'])]))).toEqual([]);
        });

        it('is silent when no reason reaches half', () => {
            expect(findInsights(input([withReasons(['no_time', 'no_time', 'forgot', 'forgot', 'ill'])]))).toEqual([]);
        });

        it('weighs the last month, not the last two', () => {
            const old = habit({
                reasons: [10, 11, 12, 13, 14].map(offset => ({ day: TODAY - 40 - offset, code: 'ill' as const })),
            });

            expect(findInsights(input([old]))).toEqual([]);
        });

        it('adds up across habits', () => {
            const a = habit({ key: 'a', reasons: [1, 2, 3].map(o => ({ day: TODAY - o, code: 'no_energy' as const })) });
            const b = habit({ key: 'b', reasons: [1, 2].map(o => ({ day: TODAY - o, code: 'no_energy' as const })) });

            expect(findInsights(input([a, b]))[0]).toMatchObject({ code: 'no_energy', total: 5 });
        });
    });

    describe('mood and a habit', () => {
        /** Done on alternate days; mood given by `moodOf`. */
        const alternating = (moodOf: (done: boolean) => number, days = 20) => {
            const s = slots(days, (_d, index) => (index % 2 === 0 ? 'done' : 'failed'));
            return {
                h: habit({ slots: s }),
                journal: s.map(slot => ({ day: slot.day, mood: moodOf(slot.outcome === 'done') })),
            };
        };

        it('is found when the mood is a clear step higher on days it was done', () => {
            const { h, journal } = alternating(done => (done ? 4 : 3));

            expect(findInsights(input([h], journal))[0]).toMatchObject({
                kind: 'mood_link',
                meanWhenDone: 4,
                meanWhenNot: 3,
                difference: 1,
            });
        });

        it('is found the other way round too', () => {
            const { h, journal } = alternating(done => (done ? 2 : 4));

            expect(findInsights(input([h], journal))[0]).toMatchObject({ kind: 'mood_link', difference: -2 });
        });

        it('is silent when the difference is small', () => {
            // Mean 3.5 against 3.0: a half step.
            const { h, journal } = alternating((done) => (done ? 3.5 : 3));

            expect(findInsights(input([h], journal))).toEqual([]);
        });

        it('is silent without five days of each', () => {
            const { h, journal } = alternating(done => (done ? 5 : 1), 8);

            expect(findInsights(input([h], journal))).toEqual([]);
        });

        it('counts only the days a mood was written down', () => {
            const { h, journal } = alternating(done => (done ? 5 : 1));

            expect(findInsights(input([h], journal.slice(0, 6)))).toEqual([]);
        });
    });

    describe('one habit going with another', () => {
        /** B is done on the days A is, and only then. */
        const together = (days: number, bFollowsA: boolean) => {
            const a = slots(days, (_d, i) => (i % 2 === 0 ? 'done' : 'failed'));
            const b = slots(days, (_d, i) => (bFollowsA ? (i % 2 === 0 ? 'done' : 'failed') : (i % 3 === 0 ? 'done' : 'failed')));
            return [habit({ key: 'a', title: 'Run', slots: a }), habit({ key: 'b', title: 'Sleep', slots: b })];
        };

        it('is found when one is done far more often on the days the other is', () => {
            const found = findInsights(input(together(30, true))).filter(i => i.kind === 'habit_pair');

            expect(found[0]).toMatchObject({ cause: 'a', effect: 'b', whenDone: 1, whenNot: 0, difference: 1 });
        });

        it('is silent when the two have nothing to do with each other', () => {
            // B done every third day, A every second: independent enough over 30 days.
            const found = findInsights(input(together(30, false))).filter(i => i.kind === 'habit_pair');

            expect(found).toEqual([]);
        });

        it('is silent without six days of each', () => {
            expect(findInsights(input(together(10, true))).filter(i => i.kind === 'habit_pair')).toEqual([]);
        });

        it('is silent for a single habit', () => {
            expect(findInsights(input([together(30, true)[0]])).filter(i => i.kind === 'habit_pair')).toEqual([]);
        });
    });

    it('puts the strongest first', () => {
        const a = habit({ key: 'a', slots: slots(56, day => (weekdayOf(day) === 1 ? 'failed' : 'done')) });
        const reasons = habit({ key: 'b', reasons: [1, 2, 3, 4, 5].map(o => ({ day: TODAY - o, code: 'ill' as const })) });

        const found = findInsights(input([a, reasons]));

        expect(found.length).toBeGreaterThanOrEqual(2);
        expect(found[0].strength).toBeGreaterThanOrEqual(found[1].strength);
    });

    it('finds nothing in an empty account', () => {
        expect(findInsights(input([]))).toEqual([]);
    });
});

describe('weeklyFacts', () => {
    // The week that ended last Sunday: Monday 2026-03-09 … Sunday 2026-03-15.
    const WEEK = toDayNumber('2026-03-09');

    it('finds the Monday of the last week that has ended', () => {
        expect(lastFinishedWeekStart(TODAY)).toBe(WEEK);
        expect(lastFinishedWeekStart(toDayNumber('2026-03-16'))).toBe(WEEK);
        expect(lastFinishedWeekStart(toDayNumber('2026-03-22'))).toBe(WEEK);
        expect(lastFinishedWeekStart(toDayNumber('2026-03-23'))).toBe(WEEK + 7);
    });

    const weekOf = (outcomeOf: (index: number) => Outcome, startDay = WEEK): CoachSlot[] =>
        Array.from({ length: 7 }, (_unused, index) => ({ day: startDay + index, outcome: outcomeOf(index) }));

    it('counts what was due, what was done and the share', () => {
        const h = habit({ slots: weekOf(i => (i < 5 ? 'done' : 'failed')) });

        expect(weeklyFacts(input([h]), WEEK).habits[0]).toMatchObject({
            title: 'Read',
            slots: 7,
            done: 5,
            percentage: 71,
        });
    });

    it('compares with the week before', () => {
        const h = habit({
            slots: [...weekOf(() => 'done', WEEK - 7).map((slot, i) => ({ ...slot, outcome: i < 3 ? ('done' as const) : ('failed' as const) })), ...weekOf(() => 'done')],
        });

        expect(weeklyFacts(input([h]), WEEK).habits[0]).toMatchObject({ percentage: 100, previousPercentage: 43 });
    });

    it('has no comparison for a habit that began this week', () => {
        const h = habit({ slots: weekOf(() => 'done') });

        expect(weeklyFacts(input([h]), WEEK).habits[0]).not.toHaveProperty('previousPercentage');
    });

    it('leaves out a habit with nothing due that week', () => {
        const h = habit({ slots: weekOf(() => 'done', WEEK - 7) });

        expect(weeklyFacts(input([h]), WEEK).habits).toEqual([]);
    });

    it('carries the streak and what it counts', () => {
        const h = habit({ slots: weekOf(() => 'done'), streak: 4, streakUnit: 'week' });

        expect(weeklyFacts(input([h]), WEEK).habits[0]).toMatchObject({ streak: 4, streakUnit: 'week' });
    });

    it('names the best and the worst day of the week when they differ', () => {
        const h = habit({
            slots: slots(56, day => (weekdayOf(day) === 6 ? 'failed' : 'done')),
        });

        const facts = weeklyFacts(input([h]), WEEK).habits[0];

        expect(facts.worstWeekday).toBe(6);
        expect(facts.bestWeekday).toBeDefined();
        expect(facts.bestWeekday).not.toBe(6);
    });

    it('names neither when every day is alike', () => {
        const h = habit({ slots: slots(56, () => 'done') });

        expect(weeklyFacts(input([h]), WEEK).habits[0]).not.toHaveProperty('worstWeekday');
    });

    it('averages mood and energy over the days written about, with last week beside them', () => {
        const journal = [
            { day: WEEK, mood: 4, energy: 2 },
            { day: WEEK + 1, mood: 2 },
            { day: WEEK - 3, mood: 3 },
        ];

        const facts = weeklyFacts(input([habit({ slots: weekOf(() => 'done') })], journal), WEEK);

        expect(facts.mood).toEqual({ average: 3, days: 2, previousAverage: 3 });
        expect(facts.energy).toEqual({ average: 2, days: 1 });
    });

    it('has no mood when none was written', () => {
        const facts = weeklyFacts(input([habit({ slots: weekOf(() => 'done') })]), WEEK);

        expect(facts).not.toHaveProperty('mood');
    });

    it('counts the reasons given that week, by code', () => {
        const h = habit({
            slots: weekOf(() => 'failed'),
            reasons: [
                { day: WEEK + 1, code: 'ill' },
                { day: WEEK + 2, code: 'ill' },
                { day: WEEK + 3, code: 'forgot' },
                { day: WEEK - 2, code: 'ill' },
            ],
        });

        expect(weeklyFacts(input([h]), WEEK).reasons).toEqual({ ill: 2, forgot: 1 });
    });

    it('names the week by its Monday', () => {
        expect(weeklyFacts(input([habit()]), WEEK).weekStart).toBe('2026-03-09');
    });
});

describe('historyDays', () => {
    it('counts from the earliest habit', () => {
        expect(historyDays(input([habit({ startDay: TODAY - 9 }), habit({ startDay: TODAY - 3 })]), TODAY)).toBe(10);
    });

    it('is zero with no habit at all', () => {
        expect(historyDays(input([]), TODAY)).toBe(0);
    });
});
