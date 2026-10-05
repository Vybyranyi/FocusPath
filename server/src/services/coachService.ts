import CoachCard, { MAX_ATTEMPTS, type ICoachCard } from '@models/CoachCard';
import User from '@models/User';
import mongoose from 'mongoose';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '@errors/AppError';
import { toDayNumber, type DayNumber } from '@services/habitTimeline';
import { gatherNotes, loadCoachContext, type CoachContext } from '@services/coachData';
import {
    resolveLanguage,
    writeCoachText,
    type CoachRequest,
} from '@services/coachAiService';
import {
    findInsights,
    historyDays,
    iso,
    lastFinishedWeekStart,
    MIN_HISTORY_DAYS,
    INSIGHT_REPEAT_DAYS,
    weeklyFacts,
    type CoachHabit,
    type Insight,
} from '@services/coachInsights';
import { createCandidate, recalibrationKey } from '@services/coachTriggers';
import * as habitService from '@services/habitService';
import { rulesOf } from '@services/habitView';
import type { CoachCard as CoachCardView, Habit as HabitView } from '@shared/index';

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const isDuplicate = (error: unknown): boolean => (error as { code?: number }).code === 11000;

const present = (card: ICoachCard): CoachCardView => card.toJSON() as unknown as CoachCardView;

const requireCard = async (userId: string, cardId: string): Promise<ICoachCard> => {
    const card = await CoachCard.findOne({ _id: cardId, userId });
    if (!card) {
        throw new NotFoundError('Card not found');
    }
    return card;
};

/**
 * An insight as the model and the screen are told it: habits by title, shares as
 * whole percentages. Ids stay out — the fingerprint, which names them, lives on
 * the card and goes nowhere.
 */
export const insightFacts = (insight: Insight, habits: Map<string, CoachHabit>): Record<string, unknown> => {
    const title = (key: string) => habits.get(key)?.title ?? 'a habit';
    const percent = (value: number) => Math.round(value * 100);

    switch (insight.kind) {
        case 'weekday_failures':
            return {
                pattern: 'weekday_failures',
                habit: title(insight.habit),
                weekday: WEEKDAY_NAMES[insight.weekday - 1],
                slotsOnThatDay: insight.slots,
                failedOnThatDay: insight.fails,
                percentFailedOnThatDay: percent(insight.share),
                percentFailedOverall: percent(insight.overallShare),
            };
        case 'top_reason':
            return {
                pattern: 'top_reason',
                reason: insight.code,
                timesGiven: insight.count,
                reasonsGivenInAll: insight.total,
                percentOfReasons: percent(insight.share),
            };
        case 'mood_link':
            return {
                pattern: 'mood_link',
                habit: title(insight.habit),
                averageMoodWhenDone: insight.meanWhenDone,
                averageMoodWhenNotDone: insight.meanWhenNot,
                difference: insight.difference,
                daysDone: insight.daysDone,
                daysNotDone: insight.daysNot,
            };
        case 'habit_pair':
            return {
                pattern: 'habit_pair',
                habit: title(insight.cause),
                otherHabit: title(insight.effect),
                percentOtherDoneWhenHabitDone: percent(insight.whenDone),
                percentOtherDoneOtherwise: percent(insight.whenNot),
                daysHabitDone: insight.daysDone,
                daysHabitNotDone: insight.daysNot,
            };
    }
};

interface Preferences {
    coachLanguage?: string;
    coachReadsNotes: boolean;
}

const loadPreferences = async (userId: string): Promise<Preferences> => {
    const user = await User.findById(userId).select('preferences');
    return {
        coachLanguage: user?.preferences?.coachLanguage ?? undefined,
        coachReadsNotes: user?.preferences?.coachReadsNotes ?? false,
    };
};

/**
 * Asks the model for a card's words and files the answer — or the failure.
 *
 * A failed try is counted on the card, and a card that has used its second try is
 * given up on. There are no stand-in words: a coach that fills the gap with
 * boilerplate says nothing, convincingly.
 */
const writeInto = async (
    card: ICoachCard,
    request: CoachRequest,
    onWritten: (card: ICoachCard, tasks: string[] | undefined) => void,
): Promise<boolean> => {
    card.attempts += 1;

    try {
        const reply = await writeCoachText(request);
        card.content = reply.content;
        card.usage = reply.usage;
        card.readyAt = new Date();
        card.status = 'ready';
        onWritten(card, reply.tasks);
        await card.save();
        return true;
    } catch {
        // Why is already in the log, without the content; here only the count matters.
        card.status = card.kind === 'recalibration' && card.attempts < MAX_ATTEMPTS ? 'candidate' : 'failed';
        await card.save();
        return false;
    }
};

/** How long a claimed card may sit unwritten before its writer is presumed gone. */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A review or an insight that can be tried again: one that failed with tries to
 * spare, or one claimed so long ago that whoever claimed it must have died. A card
 * claimed a moment ago is somebody else's work in progress and is left alone.
 */
const retryable = (card: ICoachCard): boolean =>
    card.attempts < MAX_ATTEMPTS &&
    (card.status === 'failed' ||
        (card.status === 'candidate' && Date.now() - card.createdAt.getTime() > CLAIM_TIMEOUT_MS));

/**
 * Takes a failed card back into work, once. The swap is conditional on the card
 * still being as it was read, so of several refreshes that all saw it failed,
 * exactly one gets to try again.
 */
const reserveRetry = async (card: ICoachCard): Promise<boolean> => {
    if (card.status === 'candidate') return true;

    const taken = await CoachCard.findOneAndUpdate(
        { _id: card._id, status: 'failed', attempts: card.attempts },
        { $set: { status: 'candidate' } },
    );
    if (!taken) return false;

    // Mirrored in memory, or the save that follows a second failure would see
    // `failed` -> `failed`, find nothing changed, and leave the card stuck as
    // `candidate` in the database.
    card.status = 'candidate';
    return true;
};

/**
 * Claims a period by creating its card before spending anything on it. Two
 * refreshes arriving together then cannot both reach the model: the unique index
 * lets one create the card and sends the other away, and the card's `candidate`
 * status — unwritten, in progress — keeps a retry from stepping on the first try.
 */
const claim = async (
    userId: string,
    fields: Pick<ICoachCard, 'kind' | 'key' | 'facts' | 'language'> & Partial<ICoachCard>,
): Promise<ICoachCard | null> => {
    try {
        return await CoachCard.create({ userId, status: 'candidate', attempts: 0, ...fields });
    } catch (error) {
        if (isDuplicate(error)) return null;
        throw error;
    }
};

const weeklyReview = async (
    userId: string,
    context: CoachContext,
    prefs: Preferences,
    today: DayNumber,
): Promise<ICoachCard | null> => {
    const { input } = context;
    const weekStart = lastFinishedWeekStart(today);
    const key = iso(weekStart);

    // Below a week of history there is nothing to review, and the coach says so
    // by saying nothing.
    if (historyDays(input, weekStart + 6) < MIN_HISTORY_DAYS) return null;

    const facts = weeklyFacts(input, weekStart);
    if (facts.habits.length === 0) return null;

    const habits = new Map(input.habits.map(habit => [habit.key, habit]));
    const strongest = findInsights(input)[0];
    const language = resolveLanguage(prefs.coachLanguage, input.habits.map(habit => habit.title));

    const existing = await CoachCard.findOne({ userId, kind: 'weekly_review', key });
    let card: ICoachCard | null = existing;
    if (!card) {
        card = await claim(userId, {
            kind: 'weekly_review',
            key,
            facts: { ...facts, ...(strongest ? { insight: insightFacts(strongest, habits) } : {}) },
            language,
        });
        if (!card) return null;
    } else if (!retryable(card) || !(await reserveRetry(card))) {
        return null;
    }

    const notes = prefs.coachReadsNotes ? await gatherNotes(context, userId) : undefined;
    const ready = await writeInto(card, { kind: 'weekly_review', facts: card.facts, language: card.language, notes }, () => undefined);
    return ready ? card : null;
};

const dailyInsight = async (
    userId: string,
    context: CoachContext,
    prefs: Preferences,
    today: DayNumber,
): Promise<ICoachCard | null> => {
    const { input } = context;
    const key = iso(today);

    const [todays, recent] = await Promise.all([
        CoachCard.findOne({ userId, kind: 'insight', key }),
        CoachCard.find({ userId, kind: 'insight' }).sort({ createdAt: -1 }).limit(60),
    ]);

    let card: ICoachCard | null = todays;
    if (card && (!retryable(card) || !(await reserveRetry(card)))) return null;

    if (!card) {
        // The same pattern about the same habit is not told twice inside a month.
        const cutoff = Date.now() - INSIGHT_REPEAT_DAYS * 24 * 60 * 60 * 1000;
        const told = new Set(
            recent.filter(item => item.createdAt.getTime() >= cutoff && item.fingerprint).map(item => item.fingerprint),
        );
        const fresh = findInsights(input).find(insight => !told.has(insight.fingerprint));
        if (!fresh) return null;

        const habits = new Map(input.habits.map(habit => [habit.key, habit]));
        card = await claim(userId, {
            kind: 'insight',
            key,
            fingerprint: fresh.fingerprint,
            facts: insightFacts(fresh, habits),
            language: resolveLanguage(prefs.coachLanguage, input.habits.map(habit => habit.title)),
        });
        if (!card) return null;
    }

    const notes = prefs.coachReadsNotes ? await gatherNotes(context, userId) : undefined;
    const ready = await writeInto(card, { kind: 'insight', facts: card.facts, language: card.language, notes }, () => undefined);
    return ready ? card : null;
};

/**
 * Says whatever has come due since the person was last here, and nothing else.
 *
 * No job runs this: the app calls it when it opens, and it looks at the calendar.
 * A review for a week that has ended, offers for habits failed three times
 * running (including the days nobody marked, which leave no record for a write to
 * notice), and at most one insight a day. Asked again, it finds every card
 * already there and does nothing — which costs nothing, and is the point.
 *
 * Returns the cards made by this call.
 */
export const refresh = async (userId: string, now: Date = new Date()): Promise<CoachCardView[]> => {
    const today = toDayNumber(now);
    const [context, prefs] = await Promise.all([loadCoachContext(userId, today), loadPreferences(userId)]);

    const created: ICoachCard[] = [];
    const language = resolveLanguage(prefs.coachLanguage, context.input.habits.map(habit => habit.title));

    for (const habit of context.input.habits) {
        const habitContext = context.habits.get(habit.key);
        if (!habitContext) continue;
        const card = await createCandidate(userId, habit, habitContext, today, language);
        if (card) created.push(card);
    }

    const review = await weeklyReview(userId, context, prefs, today);
    if (review) created.push(review);

    const insight = await dailyInsight(userId, context, prefs, today);
    if (insight) created.push(insight);

    return created.map(present);
};

export const listCards = async (
    userId: string,
    { limit, before }: { limit: number; before?: Date },
): Promise<{ cards: CoachCardView[]; nextCursor?: string }> => {
    // An aggregation, for the same reason as every ranged read here: sanitizeFilter
    // would turn the `$lt` of a cursor into nothing.
    const rows = await CoachCard.aggregate<CoachCardView & { createdAt: Date }>([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                // A card that could not be written, or has not been yet, has nothing to
                // show — except an offer, which is shown before it is explained.
                $or: [{ status: { $nin: ['failed', 'candidate'] } }, { kind: 'recalibration', status: 'candidate' }],
                ...(before ? { createdAt: { $lt: before } } : {}),
            },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: limit + 1 },
        { $project: { userId: 0, usage: 0, attempts: 0, fingerprint: 0, __v: 0 } },
    ]);

    const cards = rows.slice(0, limit);
    return {
        cards,
        nextCursor: rows.length > limit ? new Date(cards[cards.length - 1].createdAt).toISOString() : undefined,
    };
};

/**
 * Opening a recalibration is when it is explained — and when the model is first
 * asked. Until then it is only an offer, worked out and free.
 */
export const openCard = async (userId: string, cardId: string): Promise<CoachCardView> => {
    const card = await requireCard(userId, cardId);

    if (card.kind !== 'recalibration' || card.status !== 'candidate') {
        return present(card);
    }

    const prefs = await loadPreferences(userId);
    const context = await loadCoachContext(userId, toDayNumber(new Date()));
    const notes = prefs.coachReadsNotes ? await gatherNotes(context, userId) : undefined;
    const rewrite = card.proposal?.rewrite;

    const written = await writeInto(
        card,
        {
            kind: 'recalibration',
            facts: { ...card.facts, proposal: { from: card.proposal?.from, to: card.proposal?.to } },
            language: card.language,
            notes,
            ...(rewrite ? { rewrite: { count: rewrite.current.length, current: rewrite.current } } : {}),
        },
        (done, tasks) => {
            if (done.proposal?.rewrite && tasks) {
                done.proposal = { ...done.proposal, rewrite: { ...done.proposal.rewrite, proposed: tasks } };
                done.markModified('proposal');
            }
        },
    );

    if (!written) {
        throw new ServiceUnavailableError('The coach is unavailable right now — try again in a moment');
    }
    return present(card);
};

/**
 * Applies an easier plan, through the same service functions that editing by hand
 * uses: the new rule takes effect today, the past keeps the one it ran under, and
 * a clone of a library plan leaves that plan's statistics exactly as it would for
 * any other change. Nothing here is a back door.
 *
 * Refused unless the card has been opened — the person must have seen what is
 * about to change — and unless the habit is still what the proposal was worked
 * out against.
 */
export const applyCard = async (
    userId: string,
    cardId: string,
): Promise<{ card: CoachCardView; habit: HabitView }> => {
    const card = await requireCard(userId, cardId);

    if (card.kind !== 'recalibration') {
        throw new ConflictError('Only an offer to ease a habit can be applied');
    }
    if (card.status === 'applied' || card.status === 'dismissed') {
        throw new ConflictError('This offer has already been dealt with');
    }
    if (card.status !== 'ready' || !card.proposal || !card.habitId) {
        throw new ConflictError('Open the offer first, so you can see what would change');
    }

    const habit = await habitService.requireOwnedHabit(userId, String(card.habitId)).catch(() => null);
    if (!habit) {
        throw new ConflictError('The habit this was about no longer exists');
    }

    const rules = rulesOf(habit);
    const current = rules[rules.length - 1];
    const { from, to } = card.proposal;
    if (JSON.stringify([current.frequency, current.target ?? null]) !== JSON.stringify([from.frequency, from.target ?? null])) {
        throw new ConflictError('The habit has changed since this was suggested');
    }

    const changes: Parameters<typeof habitService.updateHabit>[2] = {};
    if (JSON.stringify(to.frequency) !== JSON.stringify(from.frequency)) changes.frequency = to.frequency;
    if (JSON.stringify(to.target ?? null) !== JSON.stringify(from.target ?? null)) changes.target = to.target ?? null;

    let updated = await habitService.updateHabit(userId, String(card.habitId), changes);

    const rewrite = card.proposal.rewrite;
    if (rewrite?.proposed) {
        updated = await habitService.setSessionTitles(userId, String(card.habitId), rewrite.fromSession, rewrite.proposed);
    }

    card.status = 'applied';
    await card.save();

    return { card: present(card), habit: updated };
};

export const dismissCard = async (userId: string, cardId: string): Promise<CoachCardView> => {
    const card = await requireCard(userId, cardId);

    // An applied card stays applied: it did something, and that is its record.
    if (card.status !== 'applied') {
        card.status = 'dismissed';
        await card.save();
    }
    return present(card);
};

export const giveFeedback = async (
    userId: string,
    cardId: string,
    helpful: boolean,
): Promise<CoachCardView> => {
    const card = await requireCard(userId, cardId);
    card.feedback = helpful ? 'helpful' : 'not_helpful';
    await card.save();
    return present(card);
};

export { recalibrationKey };
