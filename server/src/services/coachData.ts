import mongoose from 'mongoose';
import Habit, { type IHabit } from '@models/Habit';
import HabitDay from '@models/HabitDay';
import JournalEntry from '@models/JournalEntry';
import {
    fromDayNumber,
    toDayNumber,
    type DayNumber,
} from '@services/habitTimeline';
import { evaluate, rulesOf, type LoggedDay } from '@services/habitView';
import type {
    CoachHabit,
    CoachInput,
    CoachJournalDay,
    CoachSlot,
} from '@services/coachInsights';
import { WINDOW_DAYS } from '@services/coachInsights';

/** How far back the coach reads the journal: enough for the longest window it weighs. */
const JOURNAL_DAYS = WINDOW_DAYS + 7;

/** The Sunday ending a Monday–Sunday week, as a day number. */
const weekEnd = (week: number): DayNumber => week * 7 - 3 + 6;

/** What the coach needs to know about a habit besides what it counts. */
export interface HabitContext {
    doc: IHabit;
    /** Neither paused today nor a programme that has run out: there is something to adjust. */
    active: boolean;
    /** 1-based number of the next session of a programme that has not been done yet. */
    nextSession?: number;
}

export interface CoachContext {
    input: CoachInput;
    habits: Map<string, HabitContext>;
    logs: LoggedDay[];
}

/**
 * Slots that are over, from the timeline the rest of the app already trusts.
 *
 * A daily or weekdays slot is a day. A weekly habit has no slot tied to a day,
 * so a day that was done stands for the slot it filled, and a week that ended
 * short stands for the slots it missed, placed on the last day of the week. Days
 * off — paused, rest — are not in it, and neither is the future.
 */
const slotsOf = (habit: IHabit, logs: LoggedDay[], today: DayNumber): CoachSlot[] => {
    const { timeline } = evaluate(habit, logs, today);
    const slots: CoachSlot[] = [];

    for (const cell of timeline.cells.values()) {
        if (cell.day > today) continue;

        if (cell.kind === 'slot' && (cell.state === 'done' || cell.state === 'failed' || cell.state === 'missed')) {
            slots.push({ day: cell.day, outcome: cell.state });
        } else if (cell.kind === 'flex' && cell.state === 'done') {
            slots.push({ day: cell.day, outcome: 'done' });
        }
    }

    for (const segment of timeline.segments) {
        if (segment.status !== 'missed') continue;
        const day = Math.min(weekEnd(segment.week), today - 1);
        for (let missed = segment.done; missed < segment.slots; missed++) {
            slots.push({ day, outcome: 'missed' });
        }
    }

    return slots.sort((a, b) => a.day - b.day);
};

/**
 * Everything the coach counts, gathered in three reads: the habits, the whole
 * log, and the last stretch of the journal. Pure from here on — the detectors
 * never see a document.
 */
export const loadCoachContext = async (userId: string, today: DayNumber): Promise<CoachContext> => {
    const [habits, logs, journalRows] = await Promise.all([
        Habit.find({ userId }),
        HabitDay.find({ userId }).lean<LoggedDay[]>(),
        // An aggregation: `sanitizeFilter` would turn a `$gte` in a `find` into nothing.
        JournalEntry.aggregate<{ day: Date; mood?: number; energy?: number }>([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    day: { $gte: fromDayNumber(today - JOURNAL_DAYS) },
                },
            },
            { $project: { day: 1, mood: 1, energy: 1 } },
        ]),
    ]);

    const byHabit = new Map<string, LoggedDay[]>();
    for (const log of logs) {
        const key = String(log.habitId);
        byHabit.set(key, [...(byHabit.get(key) ?? []), log]);
    }

    const contexts = new Map<string, HabitContext>();
    const coachHabits: CoachHabit[] = habits.map(habit => {
        const key = String(habit._id);
        const own = byHabit.get(key) ?? [];
        const { timeline, streak } = evaluate(habit, own, today);
        const rules = rulesOf(habit);
        const current = rules[rules.length - 1];

        const pausedToday = timeline.cells.get(today)?.kind === 'paused';
        let nextSession: number | undefined;
        if (habit.program) {
            for (const cell of [...timeline.cells.values()].sort((a, b) => a.day - b.day)) {
                if (cell.day >= today && cell.session !== undefined && cell.state !== 'done') {
                    nextSession = cell.session;
                    break;
                }
            }
        }

        contexts.set(key, {
            doc: habit,
            active: !pausedToday && !timeline.completed,
            nextSession,
        });

        return {
            key,
            title: habit.title,
            type: habit.type,
            frequency: current.frequency,
            target: current.target,
            hasProgram: Boolean(habit.program),
            startDay: toDayNumber(habit.startDate),
            ruleFrom: toDayNumber(current.effectiveFrom),
            slots: slotsOf(habit, own, today),
            streak: streak.value,
            streakUnit: streak.unit,
            reasons: own.flatMap(log =>
                log.failureReason ? [{ day: toDayNumber(log.day), code: log.failureReason.code }] : [],
            ),
        };
    });

    const journal: CoachJournalDay[] = journalRows.map(row => ({
        day: toDayNumber(row.day),
        mood: row.mood,
        energy: row.energy,
    }));

    return { input: { habits: coachHabits, journal, today }, habits: contexts, logs };
};

/** How many characters of words the coach may read in all, and of any one note. */
export const NOTES_TOTAL_MAX = 2000;
export const NOTE_MAX_CHARS = 280;
/** Two weeks: what was written last month is not what the week is about. */
export const NOTES_DAYS = 14;

/**
 * The person's own words from the last two weeks — notes on habit days and the
 * journal's text — for a coach they have given leave to read them. Each is cut to
 * 280 characters and the lot to 2000, newest first, so a long diary cannot
 * become the whole prompt. Habits are named by number, never by id.
 */
export const gatherNotes = async (
    context: CoachContext,
    userId: string,
): Promise<string[]> => {
    const { today } = context.input;
    const titleOf = new Map(context.input.habits.map((habit, index) => [habit.key, index + 1]));

    const entries: Array<{ day: DayNumber; text: string }> = [];

    for (const log of context.logs) {
        const day = toDayNumber(log.day);
        if (!log.note || day > today || day <= today - NOTES_DAYS) continue;
        const n = titleOf.get(String(log.habitId));
        if (n === undefined) continue;
        entries.push({ day, text: `[habit ${n}] ${log.note}` });
    }

    const written = await JournalEntry.aggregate<{ day: Date; text?: string }>([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                day: { $gte: fromDayNumber(today - NOTES_DAYS + 1) },
                text: { $exists: true },
            },
        },
        { $project: { day: 1, text: 1 } },
    ]);
    for (const row of written) {
        if (row.text) entries.push({ day: toDayNumber(row.day), text: `[day] ${row.text}` });
    }

    const notes: string[] = [];
    let total = 0;
    for (const entry of entries.sort((a, b) => b.day - a.day)) {
        const cut = entry.text.slice(0, NOTE_MAX_CHARS);
        if (total + cut.length > NOTES_TOTAL_MAX) break;
        total += cut.length;
        notes.push(`${today - entry.day} days ago: ${cut}`);
    }
    return notes;
};

