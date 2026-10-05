import { contentHash, PROVEN_THRESHOLD, qualifiesAsProven, scheduleHash } from '@services/planContent';
import { addUtcDays } from '@utils/dates';

const NOW = new Date('2026-03-15T09:30:00.000Z');

describe('scheduleHash', () => {
    it('is stable for the same schedule', () => {
        expect(scheduleHash(3, ['a', 'b', 'c'])).toBe(scheduleHash(3, ['a', 'b', 'c']));
    });

    it('changes when a single day title changes', () => {
        expect(scheduleHash(3, ['a', 'b', 'c'])).not.toBe(scheduleHash(3, ['a', 'B', 'c']));
    });

    it('changes when the duration changes', () => {
        expect(scheduleHash(3, ['a', 'b', 'c'])).not.toBe(scheduleHash(4, ['a', 'b', 'c']));
    });

    it('changes when the order changes', () => {
        expect(scheduleHash(3, ['a', 'b', 'c'])).not.toBe(scheduleHash(3, ['c', 'b', 'a']));
    });

    it('cannot be collided by a title that contains a separator', () => {
        // Joining on a delimiter would make these two schedules identical.
        expect(scheduleHash(2, ['a\nb', 'c'])).not.toBe(scheduleHash(2, ['a', 'b\nc']));
    });
});

describe('contentHash', () => {
    const titles = ['Read 10 pages', 'Read 20 pages', 'Review'];

    /**
     * Plans published before frequencies existed carry a stored hash, and every
     * clone is compared against it. This is that hash, written down: if it ever
     * changes, every one of those plans silently stops matching its clones.
     */
    it('leaves the hash of a plain daily plan exactly as it was', () => {
        const stored = '515fc7f50cdcd913b4d51da50883259a14b8415b65354492838a043d783fb4f0';

        expect(scheduleHash(3, titles)).toBe(stored);
        expect(contentHash({ frequency: { kind: 'daily' } }, titles)).toBe(stored);
    });

    it('tells the same titles at a different rhythm apart', () => {
        const daily = contentHash({ frequency: { kind: 'daily' } }, titles);
        const weekly = contentHash({ frequency: { kind: 'weekly', times: 3 } }, titles);
        const other = contentHash({ frequency: { kind: 'weekly', times: 4 } }, titles);

        expect(new Set([daily, weekly, other]).size).toBe(3);
    });

    it('tells a daily plan with a target from one without', () => {
        const target = { value: 8, unit: 'glasses' };

        expect(contentHash({ frequency: { kind: 'daily' }, target }, titles))
            .not.toBe(contentHash({ frequency: { kind: 'daily' } }, titles));
        expect(contentHash({ frequency: { kind: 'daily' }, target }, titles))
            .not.toBe(contentHash({ frequency: { kind: 'daily' }, target: { ...target, value: 9 } }, titles));
    });

    it('is stable for the same schedule', () => {
        const schedule = { frequency: { kind: 'weekdays' as const, days: [1, 3, 5] } };

        expect(contentHash(schedule, titles)).toBe(contentHash(schedule, titles));
    });

    it('changes when a title changes', () => {
        const schedule = { frequency: { kind: 'weekly' as const, times: 2 } };

        expect(contentHash(schedule, titles)).not.toBe(contentHash(schedule, ['x', ...titles.slice(1)]));
    });
});

describe('qualifiesAsProven', () => {
    /** A finished plan that cleared the threshold, as the defaults. */
    const check = (overrides: Partial<Parameters<typeof qualifiesAsProven>[0]> = {}) => ({
        endDate: addUtcDays(NOW, -2),
        sessions: 10,
        doneCount: 10,
        habitHash: 'same',
        planHash: 'same',
        ...overrides,
    });

    it('awards the badge to a finished plan above the threshold', () => {
        expect(qualifiesAsProven(check(), NOW)).toBe(true);
    });

    it('refuses while the plan is still running', () => {
        expect(qualifiesAsProven(check({ endDate: addUtcDays(NOW, 5) }), NOW)).toBe(false);
    });

    it('refuses on the plan’s own last day', () => {
        expect(qualifiesAsProven(check({ endDate: NOW }), NOW)).toBe(false);
    });

    /** A pause that never ends has no end to be behind us. */
    it('refuses when the end cannot be known', () => {
        expect(qualifiesAsProven(check({ endDate: undefined }), NOW)).toBe(false);
    });

    it('holds the threshold at exactly 70%', () => {
        expect(qualifiesAsProven(check({ doneCount: 7 }), NOW)).toBe(true);
        expect(qualifiesAsProven(check({ doneCount: 6 }), NOW)).toBe(false);
        expect(PROVEN_THRESHOLD).toBe(0.7);
    });

    it('refuses when the habit no longer runs the schedule that was published', () => {
        // Publish ninety days, halve your own duration, finish in forty-five:
        // this is the case the hash exists to catch.
        expect(qualifiesAsProven(check({ habitHash: 'shortened' }), NOW)).toBe(false);
    });
});
