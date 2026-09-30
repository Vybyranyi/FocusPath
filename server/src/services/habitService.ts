import mongoose from 'mongoose';
import Habit, { type IHabit } from '@models/Habit';
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
    buildSchedule,
    calculateStreak,
    endOfSchedule,
    isPlanComplete,
} from '@services/habitSchedule';
import {
    matureProvenBadge,
    registerClone,
    snapshotClone,
    syncCloneStats,
} from '@services/planStats';
import { startOfUtcDay } from '@utils/dates';
import type {
    CreateAIHabitDto,
    CreateHabitDto,
    CreateHabitFromPlanDto,
    MarkCompletionDto,
    UpdateDayTitleDto,
    UpdateHabitDto,
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

/** Index of the scheduled entry for a day, refusing days the plan does not cover. */
const requireScheduledDay = (habit: IHabit, day: Date): number => {
    const start = startOfUtcDay(habit.startDate);

    if (day < start || day > endOfSchedule(start, habit.duration)) {
        throw new BadRequestError('Date is outside habit duration');
    }

    const index = habit.dailyCompletions.findIndex(
        entry => startOfUtcDay(entry.date).getTime() === day.getTime(),
    );

    if (index === -1) {
        throw new BadRequestError('Date not found in habit schedule');
    }

    return index;
};

/** Recomputes the fields that are derived from the schedule rather than set directly. */
const refreshProgress = (habit: IHabit): void => {
    habit.currentStreak = calculateStreak(habit.dailyCompletions);
    habit.isCompleted = isPlanComplete(habit.dailyCompletions, habit.duration);
    habit.updatedAt = new Date();
};

export const createHabit = async (userId: string, dto: CreateHabitDto): Promise<IHabit> => {
    const startDate = startOfUtcDay(dto.startDate);

    return Habit.create({
        ...dto,
        description: dto.description ?? '',
        category: dto.category ?? '',
        steps: dto.steps ?? [],
        startDate,
        userId,
        currentStreak: 0,
        isCompleted: false,
        dailyCompletions: buildSchedule(startDate, dto.duration, dto.title),
    });
};

export const createAIHabit = async (
    userId: string,
    dto: CreateAIHabitDto,
): Promise<IHabit> => {
    const startDate = startOfUtcDay(dto.startDate);
    // Absent, null or zero all mean "let the model choose the length".
    const requestedDuration = dto.duration && dto.duration > 0 ? dto.duration : undefined;

    let plan;
    try {
        plan = await generateHabitPlan(dto.title, dto.type, requestedDuration);
    } catch (error) {
        // Worth a log line, but the caller only needs to know the AI is
        // unavailable — not why, and not with our stack attached.
        logger.error({ err: error, title: dto.title, type: dto.type }, 'AI habit generation failed');
        throw new ServiceUnavailableError('AI service is temporarily unavailable');
    }

    const schedule = buildSchedule(startDate, plan.duration, dto.title).map((day, index) => ({
        ...day,
        dayTitle: plan.dailyTasks[index]?.dayTitle ?? dto.title,
    }));

    return Habit.create({
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category ?? '',
        startDate,
        duration: plan.duration,
        type: dto.type,
        color: dto.color,
        icon: dto.icon,
        userId,
        currentStreak: 0,
        isCompleted: false,
        dailyCompletions: schedule,
    });
};

/**
 * Takes a plan from the library as a habit of one's own.
 *
 * Deliberately routed through this service rather than living in the plan
 * router: ownership scoping and every rule about schedules are here, and a
 * clone has to travel the same road as any other habit rather than around it.
 *
 * The content comes from the plan, not from the request — only the start date
 * and, optionally, the length and the two presentation fields are the taker's
 * to choose. A different length is allowed but stops the clone matching the
 * plan's content hash, which is what keeps it out of the plan's statistics.
 */
export const createHabitFromPlan = async (
    userId: string,
    dto: CreateHabitFromPlanDto,
): Promise<IHabit> => {
    const plan = await Plan.findOne({ _id: dto.planId, status: 'published' });
    if (!plan) {
        throw new NotFoundError('Plan not found');
    }

    // One copy of a plan at a time. Taking the same plan twice put two
    // identical habits on the same day, each with the same task — which is not
    // two commitments, it is one shown twice, and ticking either leaves the
    // other staring back. Once a run is over the plan can be walked again.
    const existing = await Habit.find({ userId, fromPlanId: plan._id }).select('startDate duration');
    const today = startOfUtcDay(new Date());

    if (existing.some(habit => endOfSchedule(startOfUtcDay(habit.startDate), habit.duration) >= today)) {
        throw new ConflictError('You are already following this plan — finish it before taking it again');
    }

    const startDate = startOfUtcDay(dto.startDate);
    const duration = dto.duration ?? plan.duration;

    // Day titles carry over by position, the same rule rescheduling follows.
    // Days past the plan's own length fall back to its title.
    const schedule = buildSchedule(startDate, duration, plan.title).map((day, index) => ({
        ...day,
        dayTitle: plan.days[index]?.dayTitle ?? plan.title,
    }));

    const habit = await Habit.create({
        title: plan.title,
        description: plan.description,
        category: plan.category,
        steps: [],
        startDate,
        duration,
        type: plan.type,
        color: dto.color ?? plan.color,
        icon: dto.icon ?? plan.icon,
        userId,
        currentStreak: 0,
        isCompleted: false,
        dailyCompletions: schedule,
        fromPlanId: plan._id,
    });

    await registerClone(habit);

    return habit;
};

export const listHabits = (userId: string) =>
    Habit.find({ userId }).select('-userId').sort({ createdAt: -1 });

export const getHabit = async (userId: string, habitId: string): Promise<IHabit> =>
    requireOwnedHabit(userId, habitId);

/**
 * Habits active on a given day, with that day's entry pulled out and the
 * overall completed count precomputed, so listing a day never ships the whole
 * schedule of every habit alongside it.
 */
export const getHabitsForDate = (userId: string, date: Date) => {
    const targetDate = startOfUtcDay(date);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    return Habit.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                startDate: { $lte: targetDate },
            },
        },
        {
            $addFields: {
                endDate: {
                    $dateAdd: {
                        startDate: '$startDate',
                        unit: 'day',
                        amount: { $subtract: ['$duration', 1] },
                    },
                },
            },
        },
        { $match: { endDate: { $gte: targetDate } } },
        {
            $addFields: {
                dayInfo: {
                    $first: {
                        $filter: {
                            input: '$dailyCompletions',
                            cond: {
                                $and: [
                                    { $gte: ['$$this.date', targetDate] },
                                    { $lte: ['$$this.date', endOfDay] },
                                ],
                            },
                        },
                    },
                },
            },
        },
        {
            $project: {
                title: 1,
                description: 1,
                category: 1,
                steps: 1,
                startDate: 1,
                type: 1,
                color: 1,
                icon: 1,
                currentStreak: 1,
                isCompleted: 1,
                dayInfo: 1,
                duration: 1,
                completedCount: {
                    $size: {
                        $filter: {
                            input: '$dailyCompletions',
                            cond: { $eq: ['$$this.status', 'done'] },
                        },
                    },
                },
            },
        },
    ]);
};

export const updateHabit = async (
    userId: string,
    habitId: string,
    changes: UpdateHabitDto,
): Promise<IHabit> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const before = snapshotClone(habit);

    const { title, description, category, steps, startDate, duration, type, color, icon } = changes;

    // A day with no task of its own is titled after the habit when the schedule
    // is built. Renaming the habit alone left every one of those days showing
    // the old name as the day's task, on every card, for the rest of the run.
    // Days the user or the AI actually wrote are left as they are.
    if (title && title !== habit.title) {
        const previousTitle = habit.title;
        habit.dailyCompletions.forEach(day => {
            if (day.dayTitle === previousTitle) day.dayTitle = title;
        });
        habit.title = title;
    }
    if (description !== undefined) habit.description = description;
    if (category !== undefined) habit.category = category;
    if (steps) habit.steps = steps;
    if (type) habit.type = type;
    if (color) habit.color = color;
    if (icon) habit.icon = icon;

    // Moving the start or changing the length has to rebuild the plan. Setting
    // the fields alone left the schedule at its old length and old dates, so a
    // shortened habit kept invisible days it could still be completed through,
    // and a lengthened one silently gained none.
    const reschedules = startDate !== undefined || duration !== undefined;
    if (reschedules) {
        if (startDate !== undefined) habit.startDate = startOfUtcDay(startDate);
        if (duration !== undefined) habit.duration = duration;

        habit.dailyCompletions = buildSchedule(
            startOfUtcDay(habit.startDate),
            habit.duration,
            habit.title,
            habit.dailyCompletions,
        );
    }

    refreshProgress(habit);
    await habit.save();

    // Rescheduling can take a clone out of its plan's statistics — a different
    // length is a different route — so the counters are reconciled here too.
    await syncCloneStats(habit, before);

    return habit;
};

export const deleteHabit = async (userId: string, habitId: string): Promise<void> => {
    const deleted = await Habit.findOneAndDelete({ _id: habitId, userId });
    if (!deleted) {
        throw new NotFoundError('Habit not found');
    }
};

export const setDayTitle = async (
    userId: string,
    habitId: string,
    { date, dayTitle }: UpdateDayTitleDto,
): Promise<IHabit> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const index = requireScheduledDay(habit, startOfUtcDay(date));
    const before = snapshotClone(habit);

    habit.dailyCompletions[index].dayTitle = dayTitle;
    habit.updatedAt = new Date();
    await habit.save();

    // Rewriting a day makes this a different route from the one published, so
    // a finished clone stops counting towards its plan.
    await syncCloneStats(habit, before);

    return habit;
};

export const markCompletion = async (
    userId: string,
    habitId: string,
    { date, status }: MarkCompletionDto,
): Promise<IHabit> => {
    const habit = await requireOwnedHabit(userId, habitId);
    const index = requireScheduledDay(habit, startOfUtcDay(date ?? new Date()));
    const before = snapshotClone(habit);

    habit.dailyCompletions[index].status = status;
    refreshProgress(habit);
    await habit.save();

    // The two places a plan hears about progress, and the only ones: no job
    // runs at midnight to do either of these.
    await syncCloneStats(habit, before);
    await matureProvenBadge(habit);

    return habit;
};

export const toggleStep = async (
    userId: string,
    habitId: string,
    stepId: string,
): Promise<{ habit: IHabit; completed: boolean }> => {
    const habit = await requireOwnedHabit(userId, habitId);

    const step = habit.steps?.find(candidate => candidate._id?.toString() === stepId);
    if (!step) {
        throw new NotFoundError('Step not found');
    }

    step.completed = !step.completed;
    habit.updatedAt = new Date();
    await habit.save();

    return { habit, completed: step.completed };
};
