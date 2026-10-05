import CoachCard, { type ICoachCard } from '@models/CoachCard';
import HabitDay from '@models/HabitDay';
import User from '@models/User';
import type { IHabit } from '@models/Habit';
import { logger } from '@config/logger';
import { toDayNumber } from '@services/habitTimeline';
import { describeHabit, type HabitContext } from '@services/coachData';
import { resolveLanguage } from '@services/coachAiService';
import {
    iso,
    needsRecalibration,
    proposeRecalibration,
    trailingFailures,
    weekStartOf,
    REASON_WINDOW_DAYS,
    type CoachHabit,
} from '@services/coachInsights';
import type { LoggedDay } from '@services/habitView';
import type { RecalibrationProposal } from '@shared/index';

/** How many of a programme's next sessions are offered for rewriting. */
export const REWRITE_SESSIONS = 7;

/** Two cards of one period cannot exist — that is the limit, and a duplicate-key error is its answer. */
const isDuplicate = (error: unknown): boolean => (error as { code?: number }).code === 11000;

export const recalibrationKey = (habitKey: string, today: number): string =>
    `${habitKey}:${iso(weekStartOf(today))}`;

/** What the model is told about a habit that has been failed three times running. */
const recalibrationFacts = (habit: CoachHabit, today: number): Record<string, unknown> => {
    const reasons: Record<string, number> = {};
    for (const reason of habit.reasons) {
        if (reason.day > today - REASON_WINDOW_DAYS) reasons[reason.code] = (reasons[reason.code] ?? 0) + 1;
    }

    return {
        habit: {
            title: habit.title,
            type: habit.type,
            frequency: habit.frequency,
            ...(habit.target ? { target: habit.target } : {}),
        },
        failedInARow: trailingFailures(habit),
        reasonsGivenLately: reasons,
    };
};

export const buildRecalibrationProposal = (
    habit: CoachHabit,
    context: HabitContext,
    today: number,
): RecalibrationProposal | null => {
    const proposal = proposeRecalibration(habit, today);
    if (!proposal) return null;

    const program = context.doc.program;
    const rewrite =
        proposal.rewritesProgram && program && context.nextSession !== undefined
            ? {
                fromSession: context.nextSession,
                current: program.slice(context.nextSession - 1, context.nextSession - 1 + REWRITE_SESSIONS).map(item => item.title),
            }
            : undefined;

    return {
        habitTitle: habit.title,
        from: proposal.from,
        to: proposal.to,
        ...(rewrite && rewrite.current.length > 0 ? { rewrite } : {}),
    };
};

/**
 * Records that a habit has earned an easier plan — and nothing more. No model is
 * asked and nothing is spent: the card is a candidate, its proposal worked out by
 * arithmetic, its text written only if the person opens it.
 *
 * Returns the card when one was made, and `null` when there was nothing to make:
 * the habit is not failing, is not running, has just been changed, has nothing
 * gentler to offer, or has its card for this week already.
 */
export const createCandidate = async (
    userId: string,
    habit: CoachHabit,
    context: HabitContext,
    today: number,
    language: string,
): Promise<ICoachCard | null> => {
    if (!context.active || !needsRecalibration(habit, today)) return null;

    const proposal = buildRecalibrationProposal(habit, context, today);
    if (!proposal) return null;

    try {
        return await CoachCard.create({
            userId,
            kind: 'recalibration',
            key: recalibrationKey(habit.key, today),
            habitId: context.doc._id,
            status: 'candidate',
            facts: recalibrationFacts(habit, today),
            proposal,
            language,
        });
    } catch (error) {
        if (isDuplicate(error)) return null;
        throw error;
    }
};

/**
 * The second lazy trigger: after a day is written, check the one habit it was
 * written on. Catches the third failure the moment it happens, with no job
 * running anywhere.
 *
 * Never allowed to fail the write that called it — a mark must not be refused
 * because a coach card could not be made — so whatever goes wrong here is
 * logged, and nothing else.
 */
export const noteWrite = async (userId: string, habit: IHabit, now: Date = new Date()): Promise<void> => {
    try {
        const today = toDayNumber(now);
        const logs = await HabitDay.find({ userId, habitId: habit._id }).lean<LoggedDay[]>();
        const { coach, context } = describeHabit(habit, logs, today);
        if (!needsRecalibration(coach, today)) return;

        const user = await User.findById(userId).select('preferences');
        const language = resolveLanguage(user?.preferences?.coachLanguage, [habit.title]);

        await createCandidate(userId, coach, context, today, language);
    } catch (error) {
        logger.error({ err: error }, 'Coach could not check a habit after a write');
    }
};
