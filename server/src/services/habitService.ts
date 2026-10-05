import mongoose from 'mongoose';
import Habit, { type IHabit, type IHabitRule } from '@models/Habit';
import HabitDay from '@models/HabitDay';
import Plan from '@models/Plan';
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
} from '@errors/AppError';
import { logger } from '@config/logger';
import { generateHabitPlan } from '@services/openAiService';
import {
    buildTimeline,
    fromDayNumber,
    toDayNumber,
    weekOf,
    type Cell,
    type DayNumber,
    type Timeline,
} from '@services/habitTimeline';
import {
    evaluate,
    groupByHabit,
    presentDay,
    presentHabit,
    plainFrequency,
    plainTarget,
    presentSummary,
    ruleOn,
    rulesOf,
    timelineInputOf,
    type LoggedDay,
} from '@services/habitView';
import {
    matureProvenBadge,
    registerClone,
    snapshotClone,
    syncCloneStats,
    type CloneSnapshot,
} from '@services/planStats';
import { startOfUtcDay } from '@utils/dates';
import type { Habit as HabitView, HabitDay as HabitDayView, HabitSummary } from '@shared/index';
import type {
    AddPauseDto,
    AddRestDayDto,
    CreateAIHabitDto,
    CreateHabitDto,
    CreateHabitFromPlanDto,
    EndPauseDto,
    MarkCompletionDto,
    SetValueDto,
    ToggleStepDto,
    UpdateHabitDto,
    UpdateSessionTitleDto,
} from '@validation/habitSchemas';

/**
 * Every lookup is scoped by owner. Doing it here rather than in the handlers is
 * what makes "user A cannot touch user B's habit" a property of the layer
 * instead of something each endpoint has to remember.
 */
export const requireOwnedHabit = async (userId: string, habitId: string): Promise<IHabit> => {
    const habit = await Habit.findOne({ _id: habitId, userId });
    if (!habit) {
        throw new NotFoundError('Habit not found');
    }
    return habit;
};

/**
 * The day the request is being made on.
 *
 * The server's own UTC day, unless the client names one within a day of it.
 * Somebody west of Greenwich is still on yesterday for hours after the server
 * has turned over, and judging their live day by the server's clock would call
 * it missed while they are still living it. A day further off than that is not
 * a timezone, so it is not believed.
 */
const resolveToday = (requested?: Date, now: Date = new Date()): DayNumber => {
    const server = toDayNumber(now);
    if (!requested) return server;

    const asked = toDayNumber(requested);
    return Math.abs(asked - server) <= 1 ? asked : server;
};

const loadLogs = (userId: string | mongoose.Types.ObjectId, habitId: mongoose.Types.ObjectId | string) =>
    HabitDay.find({ userId, habitId }).lean<LoggedDay[]>();

/** Refuses a day the habit cannot be marked on, and says why. */
const requireMarkableCell = (timeline: Timeline, day: DayNumber): Cell => {
    const cell = timeline.cells.get(day);

    if (!cell) throw new BadRequestError('The habit is not scheduled on that date');
    if (cell.kind === 'paused') throw new BadRequestError('The habit is paused on that date');
    if (cell.kind === 'rest') throw new BadRequestError('That date is a rest day');

    return cell;
};

/** A weekly habit whose week is already met takes no further days. */
const requireRoomInWeek = (cell: Cell): void => {
    if (cell.kind === 'flex' && cell.state !== 'done' && cell.segment?.status === 'met') {
        throw new BadRequestError('The weekly target is already reached');
    }
};

interface DayChange {
    status?: 'done' | 'failed' | null;
    value?: number | null;
    completedSteps?: mongoose.Types.ObjectId[];
}

/**
 * Writes one day of the log, and removes the record when nothing is left on it.
 *
 * An upsert rather than read-then-save, so two first marks of the same day
 * cannot race into a duplicate-key error. A record with no mark, no value and no
 * ticks is the same as no record, and is not kept.
 */
const writeDay = async (habit: IHabit, day: DayNumber, change: DayChange): Promise<void> => {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};

    if (change.status !== undefined) {
        if (change.status === null) unset.status = '';
        else set.status = change.status;
    }
    if (change.value !== undefined) {
        if (change.value === null) unset.value = '';
        else set.value = change.value;
    }
    if (change.completedSteps !== undefined) set.completedSteps = change.completedSteps;

    const update: Record<string, unknown> = {
        $setOnInsert: { habitId: habit._id, userId: habit.userId, day: fromDayNumber(day) },
    };
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const record = await HabitDay.findOneAndUpdate(
        { habitId: habit._id, userId: habit.userId, day: fromDayNumber(day) },
        update,
        { upsert: true, new: true },
    );

    const empty =
        !record.status &&
        (record.value === undefined || record.value === null) &&
        record.completedSteps.length === 0;
    if (empty) {
        await HabitDay.deleteOne({ _id: record._id });
    }
};

/** Removes every record of a habit that has nothing left on it. */
const pruneEmptyDays = async (habit: IHabit): Promise<void> => {
    const logs = await HabitDay.find({ habitId: habit._id, userId: habit.userId });
    const empty = logs.filter(
        log =>
            !log.status &&
            (log.value === undefined || log.value === null) &&
            log.completedSteps.length === 0,
    );
    if (empty.length === 0) return;

    await HabitDay.bulkWrite(empty.map(log => ({ deleteOne: { filter: { _id: log._id } } })));
};

/**
 * Settles a habit after something changed: recomputes what is derived from the
 * schedule and the log and stores it, then tells the plan the habit came from
 * or went to what changed.
 *
 * Stored for the plan statistics, which compare a habit before and after a
 * change. Responses never read the stored copy — a streak that has lapsed since
 * the last write must not be shown as alive — they work it out again.
 */
const settle = async (habit: IHabit, today: DayNumber, before: CloneSnapshot) => {
    const logs = await loadLogs(habit.userId, habit._id);
    const { timeline, streak } = evaluate(habit, logs, today);

    habit.currentStreak = streak.value;
    habit.streakUnit = streak.unit;
    habit.isCompleted = timeline.completed;
    habit.updatedAt = new Date();
    await habit.save();

    // The two places a plan hears about progress, and the only ones: no job
    // runs at midnight to do either of these.
    await syncCloneStats(habit, before);
    await matureProvenBadge(habit);

    return logs;
};

/** A habit and the day just changed, as the mark endpoints answer. */
export interface MarkResult {
    habit: HabitView;
    day: HabitDayView;
}

const presentMark = async (habit: IHabit, today: DayNumber, day: DayNumber): Promise<MarkResult> => {
    const logs = await loadLogs(habit.userId, habit._id);
    const { timeline } = evaluate(habit, logs, today, day);

    return {
        habit: presentHabit(habit, logs, today),
        day: presentDay(habit, timeline, logs, day) as HabitDayView,
    };
};

const programOf = (title: string, sessions?: number | null) =>
    sessions ? Array.from({ length: sessions }, () => ({ title })) : undefined;

export const createHabit = async (userId: string, dto: CreateHabitDto): Promise<HabitView> => {
    const startDate = startOfUtcDay(dto.startDate);

    const habit = await Habit.create({
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category ?? '',
        steps: dto.steps ?? [],
        startDate,
        type: dto.type,
        color: dto.color,
        icon: dto.icon,
        timeOfDay: dto.timeOfDay,
        rules: [{ effectiveFrom: startDate, frequency: dto.frequency, target: dto.target }],
        program: programOf(dto.title, dto.sessions),
        userId,
    });

    return presentHabit(habit, [], resolveToday());
};

export const createAIHabit = async (
    userId: string,
    dto: CreateAIHabitDto,
): Promise<HabitView> => {
    const startDate = startOfUtcDay(dto.startDate);
    // Absent, null or zero all mean "let the model choose the length".
    const requestedSessions = dto.sessions && dto.sessions > 0 ? dto.sessions : undefined;

    let plan;
    try {
        plan = await generateHabitPlan(dto.title, dto.type, requestedSessions, dto.description);
    } catch (error) {
        // Worth a log line, but the caller only needs to know the AI is
        // unavailable — not why, and not with our stack attached.
        logger.error({ err: error, title: dto.title, type: dto.type }, 'AI habit generation failed');
        throw new ServiceUnavailableError('AI service is temporarily unavailable');
    }

    const habit = await Habit.create({
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category ?? '',
        steps: dto.steps ?? [],
        startDate,
        type: dto.type,
        color: dto.color,
        icon: dto.icon,
        timeOfDay: dto.timeOfDay,
        rules: [{ effectiveFrom: startDate, frequency: dto.frequency, target: dto.target }],
        program: Array.from({ length: plan.duration }, (_unused, index) => ({
            title: plan.dailyTasks[index]?.dayTitle ?? dto.title,
        })),
        userId,
    });

    return presentHabit(habit, [], resolveToday());
};

/**
 * Takes a plan from the library as a habit of one's own.
 *
 * Deliberately routed through this service rather than living in the plan
 * router: ownership scoping and every rule about schedules are here, and a
 * clone has to travel the same road as any other habit rather than around it.
 *
 * The content comes from the plan, not from the request — only the start date
 * and, optionally, the length, the rhythm and the two presentation fields are
 * the taker's to choose. A different length, frequency or target is allowed
 * but stops the clone matching the plan's content hash, which is what keeps it
 * out of the plan's statistics.
 */
export const createHabitFromPlan = async (
    userId: string,
    dto: CreateHabitFromPlanDto,
): Promise<HabitView> => {
    const plan = await Plan.findOne({ _id: dto.planId, status: 'published' });
    if (!plan) {
        throw new NotFoundError('Plan not found');
    }

    // One copy of a plan at a time. Taking the same plan twice put two
    // identical habits on the same day, each with the same task — which is not
    // two commitments, it is one shown twice, and ticking either leaves the
    // other staring back. Once a run is over the plan can be walked again.
    const existing = await Habit.find({ userId, fromPlanId: plan._id });
    const today = resolveToday();

    const stillRunning = existing.some(habit => {
        const { timeline } = evaluate(habit, [], today);
        return timeline.endDay === undefined || timeline.endDay >= today;
    });
    if (stillRunning) {
        throw new ConflictError('You are already following this plan — finish it before taking it again');
    }

    const startDate = startOfUtcDay(dto.startDate);
    const sessions = dto.sessions ?? plan.days.length;

    // Session titles carry over by position. Sessions past the plan's own
    // length fall back to its title.
    const program = Array.from({ length: sessions }, (_unused, index) => ({
        title: plan.days[index]?.dayTitle ?? plan.title,
    }));

    const habit = await Habit.create({
        title: plan.title,
        description: plan.description,
        category: plan.category,
        steps: [],
        startDate,
        type: plan.type,
        color: dto.color ?? plan.color,
        icon: dto.icon ?? plan.icon,
        timeOfDay: plan.timeOfDay,
        rules: [{
            effectiveFrom: startDate,
            frequency: dto.frequency ?? plainFrequency(plan.frequency),
            target: dto.target ?? plainTarget(plan.target),
        }],
        program,
        userId,
        fromPlanId: plan._id,
    });

    await registerClone(habit);

    return presentHabit(habit, [], today);
};

export const listHabits = async (userId: string): Promise<HabitView[]> => {
    const [habits, logs] = await Promise.all([
        Habit.find({ userId }).sort({ createdAt: -1 }),
        HabitDay.find({ userId }).lean<LoggedDay[]>(),
    ]);

    const byHabit = groupByHabit(logs);
    const today = resolveToday();

    return habits.map(habit => presentHabit(habit, byHabit.get(String(habit._id)) ?? [], today));
};

export const getHabit = async (userId: string, habitId: string): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    return presentHabit(habit, await loadLogs(userId, habit._id), resolveToday());
};

/**
 * Habits that have something to say about a day — scheduled on it, paused or
 * resting on it, or a weekly habit within its period — each with that day
 * worked out.
 *
 * Reads the user's whole log in one query and works the rest out in memory:
 * the schedule is rules, not rows, so there is nothing for a database to
 * filter by day, and one person's habits are a handful of documents.
 */
export const getHabitsForDate = async (
    userId: string,
    date: Date,
    requestedToday?: Date,
): Promise<HabitSummary[]> => {
    const day = toDayNumber(date);
    const today = resolveToday(requestedToday);

    const [habits, logs] = await Promise.all([
        Habit.find({ userId }),
        HabitDay.find({ userId }).lean<LoggedDay[]>(),
    ]);
    const byHabit = groupByHabit(logs);

    return habits.flatMap(habit => {
        const summary = presentSummary(habit, byHabit.get(String(habit._id)) ?? [], today, day);
        return summary ? [summary] : [];
    });
};

/**
 * Swaps in an edited checklist.
 *
 * A step the client names by an id this habit already has keeps that id, so
 * renaming "Stretch" to "Stretch 10 minutes" keeps every day it was ticked. An
 * id the habit does not have is not trusted — it becomes a new step. Ticks for
 * steps that are gone are dropped from every day, or the per-day counts would
 * include steps nobody can see.
 */
const replaceSteps = async (
    habit: IHabit,
    steps: NonNullable<UpdateHabitDto['steps']>,
): Promise<void> => {
    const current = new Set((habit.steps ?? []).map(step => String(step._id)));

    habit.steps = steps.map(step => ({
        _id: step._id && current.has(step._id)
            ? new mongoose.Types.ObjectId(step._id)
            : new mongoose.Types.ObjectId(),
        title: step.title,
    }));

    const kept = (habit.steps ?? []).map(step => step._id as mongoose.Types.ObjectId);
    await HabitDay.updateMany(
        { habitId: habit._id, userId: habit.userId },
        { $pull: { completedSteps: { $nin: kept } } },
    );
    await pruneEmptyDays(habit);
};

/** Moves everything dated by the habit — its rules, pauses, rest days and log — by the same number of days. */
const shiftStart = async (habit: IHabit, delta: number): Promise<void> => {
    const move = (value: Date) => fromDayNumber(toDayNumber(value) + delta);

    habit.startDate = move(habit.startDate);
    habit.rules.forEach(rule => {
        rule.effectiveFrom = move(rule.effectiveFrom);
    });
    habit.pauses.forEach(pause => {
        pause.from = move(pause.from);
        if (pause.to) pause.to = move(pause.to);
    });
    habit.restDays = habit.restDays.map(move);

    // Rewritten rather than updated in place: shifting by a day lands each
    // record on the day another one still holds, which a unique index refuses
    // however briefly.
    const logs = await HabitDay.find({ habitId: habit._id, userId: habit.userId }).lean();
    await HabitDay.deleteMany({ habitId: habit._id, userId: habit.userId });
    if (logs.length > 0) {
        await HabitDay.insertMany(logs.map(log => ({ ...log, day: move(log.day) })));
    }
};

const sameRule = (a: Pick<IHabitRule, 'frequency' | 'target'>, b: Pick<IHabitRule, 'frequency' | 'target'>) =>
    JSON.stringify([a.frequency, a.target ?? null]) === JSON.stringify([b.frequency, b.target ?? null]);

export const updateHabit = async (
    userId: string,
    habitId: string,
    changes: UpdateHabitDto,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const before = await snapshotClone(habit);
    const today = resolveToday();

    const {
        title, description, category, steps, startDate, sessions,
        frequency, target, timeOfDay, type, color, icon,
    } = changes;

    // A session with no task of its own is titled after the habit when the
    // programme is built. Renaming the habit alone left every one of those
    // sessions showing the old name as its task, on every card, for the rest of
    // the run. Sessions the user or the AI actually wrote are left as they are.
    if (title && title !== habit.title) {
        const previousTitle = habit.title;
        habit.program?.forEach(session => {
            if (session.title === previousTitle) session.title = title;
        });
        habit.title = title;
    }
    if (description !== undefined) habit.description = description;
    if (category !== undefined) habit.category = category;
    if (steps) await replaceSteps(habit, steps);
    if (type) habit.type = type;
    if (color) habit.color = color;
    if (icon) habit.icon = icon;
    if (timeOfDay) habit.timeOfDay = timeOfDay;

    // Moving the start carries the whole route with it, as it always has: "day
    // three of my plan" stays day three.
    if (startDate !== undefined) {
        const delta = toDayNumber(startDate) - toDayNumber(habit.startDate);
        if (delta !== 0) await shiftStart(habit, delta);
    }

    if (sessions !== undefined) {
        if (!habit.program) {
            throw new BadRequestError('A habit with no end cannot be given a length');
        }
        const current = habit.program;
        habit.program = Array.from({ length: sessions }, (_unused, index) => ({
            title: current[index]?.title ?? habit.title,
        }));
    }

    // A new frequency or target starts a rule today and leaves the past under
    // the rule it ran by; otherwise any bad stretch could be erased by editing
    // the rhythm afterwards. A rule starting on a day another already starts on
    // replaces it, and one that changes nothing is not recorded at all.
    if (frequency !== undefined || target !== undefined) {
        const rules = rulesOf(habit);
        const current = rules[rules.length - 1];
        const next = {
            frequency: frequency ?? current.frequency,
            target: target === undefined ? current.target : target ?? undefined,
        };

        if (!sameRule(current, next)) {
            const effectiveFrom = fromDayNumber(Math.max(today, toDayNumber(habit.startDate)));
            const entry = { effectiveFrom, ...next };

            if (toDayNumber(current.effectiveFrom) === toDayNumber(effectiveFrom)) {
                habit.rules.splice(habit.rules.length - 1, 1, entry as unknown as IHabitRule);
            } else {
                habit.rules.push(entry as unknown as IHabitRule);
            }
        }
    }

    const logs = await settle(habit, today, before);

    return presentHabit(habit, logs, today);
};

export const deleteHabit = async (userId: string, habitId: string): Promise<void> => {
    const deleted = await Habit.findOneAndDelete({ _id: habitId, userId });
    if (!deleted) {
        throw new NotFoundError('Habit not found');
    }

    // A habit's days live and die with it; left behind they would be rows that
    // belong to nothing, and would still turn up in an export.
    await HabitDay.deleteMany({ habitId: deleted._id, userId });
};

export const setSessionTitle = async (
    userId: string,
    habitId: string,
    { session, title }: UpdateSessionTitleDto,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);

    if (!habit.program) {
        throw new BadRequestError('A habit with no end has no sessions to rename');
    }
    if (session > habit.program.length) {
        throw new BadRequestError('That session is not in the programme');
    }

    const before = await snapshotClone(habit);
    habit.program[session - 1].title = title;
    const logs = await settle(habit, resolveToday(), before);

    // Rewriting a session makes this a different route from the one published,
    // which `settle` has just told the plan about.
    return presentHabit(habit, logs, resolveToday());
};

export const markCompletion = async (
    userId: string,
    habitId: string,
    { date, status, today: requestedToday }: MarkCompletionDto,
): Promise<MarkResult> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const today = resolveToday(requestedToday);
    const day = toDayNumber(date ?? fromDayNumber(today));

    const logs = await loadLogs(userId, habit._id);
    const { timeline } = evaluate(habit, logs, today, day);
    const cell = requireMarkableCell(timeline, day);

    if (ruleOn(habit, day).target) {
        throw new BadRequestError('This habit is counted, not marked — set its value instead');
    }
    if (status === 'done') requireRoomInWeek(cell);

    const before = await snapshotClone(habit);
    await writeDay(habit, day, { status: status === 'pending' ? null : status });
    await pruneEmptyDays(habit);
    await settle(habit, today, before);

    return presentMark(habit, today, day);
};

export const setValue = async (
    userId: string,
    habitId: string,
    { date, value, today: requestedToday }: SetValueDto,
): Promise<MarkResult> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const today = resolveToday(requestedToday);
    const day = toDayNumber(date);

    const logs = await loadLogs(userId, habit._id);
    const { timeline } = evaluate(habit, logs, today, day);
    const cell = requireMarkableCell(timeline, day);

    const target = ruleOn(habit, day).target;
    if (!target) {
        throw new BadRequestError('This habit has no target to count towards');
    }

    // Whether this value would finish the day, which a full week must refuse.
    if (habit.type === 'build' && value >= target.value) requireRoomInWeek(cell);

    // A `build` day at nothing is a day with nothing on it. A `quit` day at
    // nothing is the point: the clean day, which has to be recorded to count.
    const stored = value === 0 && habit.type === 'build' ? null : value;

    const before = await snapshotClone(habit);
    await writeDay(habit, day, { value: stored });
    await settle(habit, today, before);

    return presentMark(habit, today, day);
};

export const toggleStep = async (
    userId: string,
    habitId: string,
    stepId: string,
    { date, today: requestedToday }: ToggleStepDto,
): Promise<MarkResult & { completed: boolean }> => {
    const habit = await requireOwnedHabit(userId, habitId);

    const step = habit.steps?.find(candidate => candidate._id?.toString() === stepId);
    if (!step?._id) {
        throw new NotFoundError('Step not found');
    }

    const today = resolveToday(requestedToday);
    const day = toDayNumber(date);

    const logs = await loadLogs(userId, habit._id);
    const { timeline } = evaluate(habit, logs, today, day);
    const cell = requireMarkableCell(timeline, day);

    const log = logs.find(entry => toDayNumber(entry.day) === day);
    const ticked = log?.completedSteps ?? [];
    const stepObjectId = step._id as mongoose.Types.ObjectId;

    const wasDone = ticked.some(id => id.equals(stepObjectId));
    const completedSteps = wasDone
        ? ticked.filter(id => !id.equals(stepObjectId))
        : [...ticked, stepObjectId];

    const change: DayChange = { completedSteps };

    // Ticking the last step is doing the day. Only a day nobody has decided is
    // moved: one the user already marked is theirs, and unticking a step never
    // takes a `done` back — they may have finished it some other way. A habit
    // that is counted is finished by its count, not by its checklist.
    const allTicked = (habit.steps ?? []).every(candidate =>
        completedSteps.some(id => candidate._id && id.equals(candidate._id)),
    );
    const undecided = !log?.status;
    if (!wasDone && allTicked && undecided && !ruleOn(habit, day).target && cell.segment?.status !== 'met') {
        change.status = 'done';
    }

    const before = await snapshotClone(habit);
    await writeDay(habit, day, change);
    await settle(habit, today, before);

    return { ...(await presentMark(habit, today, day)), completed: !wasDone };
};

interface PauseSpan {
    from: DayNumber;
    to?: DayNumber;
}

const overlaps = (a: PauseSpan, b: PauseSpan): boolean =>
    a.from <= (b.to ?? Infinity) && b.from <= (a.to ?? Infinity);

/**
 * Earliest day a pause or a rest day may begin on: today, with the same day of
 * slack the start date has. Nothing here may be backdated — otherwise any bad
 * day could be turned into a day off afterwards.
 */
const earliestAllowed = (): DayNumber => resolveToday() - 1;

/** Whether anything is recorded on a day: a mark, a count or a ticked step. */
const hasRecord = (logs: readonly LoggedDay[], day: DayNumber): boolean => {
    const log = logs.find(entry => toDayNumber(entry.day) === day);
    return Boolean(log && (log.status || (log.value !== undefined && log.value !== null) || log.completedSteps.length > 0));
};

export const addPause = async (
    userId: string,
    habitId: string,
    { from, to }: AddPauseDto,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const span: PauseSpan = { from: toDayNumber(from), to: to ? toDayNumber(to) : undefined };

    if (span.from < earliestAllowed()) {
        throw new BadRequestError('A pause cannot begin in the past');
    }
    if (habit.pauses.some(pause => overlaps(span, {
        from: toDayNumber(pause.from),
        to: pause.to ? toDayNumber(pause.to) : undefined,
    }))) {
        throw new ConflictError('That overlaps another pause');
    }

    const logs = await loadLogs(userId, habit._id);
    if (hasRecord(logs, span.from)) {
        throw new BadRequestError('That day is already marked');
    }

    const before = await snapshotClone(habit);
    habit.pauses.push({ from: fromDayNumber(span.from), to: to ? fromDayNumber(span.to as number) : undefined } as IHabit['pauses'][number]);

    const today = resolveToday();
    return presentHabit(habit, await settle(habit, today, before), today);
};

const requirePause = (habit: IHabit, pauseId: string) => {
    const pause = habit.pauses.find(candidate => String(candidate._id) === pauseId);
    if (!pause) throw new NotFoundError('Pause not found');
    return pause;
};

/**
 * Ends a pause, or moves its end. A pause that has begun is not taken back or
 * shortened into the past — only closed from yesterday on, which is exactly
 * what resuming is.
 */
export const endPause = async (
    userId: string,
    habitId: string,
    pauseId: string,
    { to }: EndPauseDto,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const pause = requirePause(habit, pauseId);
    const end = toDayNumber(to);
    const from = toDayNumber(pause.from);

    if (end < Math.max(from, earliestAllowed())) {
        throw new BadRequestError('A pause cannot be shortened to before yesterday');
    }
    if (habit.pauses.some(other => String(other._id) !== pauseId && overlaps(
        { from, to: end },
        { from: toDayNumber(other.from), to: other.to ? toDayNumber(other.to) : undefined },
    ))) {
        throw new ConflictError('That overlaps another pause');
    }

    const before = await snapshotClone(habit);
    pause.to = fromDayNumber(end);

    const today = resolveToday();
    return presentHabit(habit, await settle(habit, today, before), today);
};

export const removePause = async (
    userId: string,
    habitId: string,
    pauseId: string,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const pause = requirePause(habit, pauseId);

    if (toDayNumber(pause.from) < earliestAllowed()) {
        throw new BadRequestError('A pause that has begun cannot be removed — end it instead');
    }

    const before = await snapshotClone(habit);
    habit.pauses = habit.pauses.filter(candidate => String(candidate._id) !== pauseId) as IHabit['pauses'];

    const today = resolveToday();
    return presentHabit(habit, await settle(habit, today, before), today);
};

export const addRestDay = async (
    userId: string,
    habitId: string,
    { date }: AddRestDayDto,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const day = toDayNumber(date);
    const today = resolveToday();

    if (day < earliestAllowed()) {
        throw new BadRequestError('A rest day cannot be set in the past');
    }
    if (ruleOn(habit, day).frequency.kind !== 'daily') {
        throw new BadRequestError('Rest days are only for habits scheduled every day');
    }

    const logs = await loadLogs(userId, habit._id);
    const timeline = buildTimeline(timelineInputOf(habit), logs, today, day);
    if (timeline.cells.get(day)?.kind !== 'slot') {
        throw new BadRequestError('The habit is not scheduled on that date');
    }
    if (hasRecord(logs, day)) {
        throw new BadRequestError('That day is already marked');
    }

    const sameWeek = habit.restDays.some(rest => weekOf(toDayNumber(rest)) === weekOf(day));
    if (sameWeek) {
        throw new BadRequestError('Only one rest day a week');
    }

    const before = await snapshotClone(habit);
    habit.restDays.push(fromDayNumber(day));

    return presentHabit(habit, await settle(habit, today, before), today);
};

export const removeRestDay = async (
    userId: string,
    habitId: string,
    date: Date,
): Promise<HabitView> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const day = toDayNumber(date);

    if (day < earliestAllowed()) {
        throw new BadRequestError('A rest day that has passed cannot be taken back');
    }
    if (!habit.restDays.some(rest => toDayNumber(rest) === day)) {
        throw new NotFoundError('Rest day not found');
    }

    const before = await snapshotClone(habit);
    habit.restDays = habit.restDays.filter(rest => toDayNumber(rest) !== day);

    const today = resolveToday();
    return presentHabit(habit, await settle(habit, today, before), today);
};
