import Habit, { type IHabit } from '@models/Habit';
import HabitDay from '@models/HabitDay';
import Plan from '@models/Plan';
import { evaluate, rulesOf, type LoggedDay } from '@services/habitView';
import { toDayNumber, fromDayNumber } from '@services/habitTimeline';
import { contentHash, qualifiesAsProven } from '@services/planContent';

/**
 * The counters and the badge — the two places where a habit's progress is
 * allowed to touch a plan.
 *
 * Kept apart from `planService` on purpose: `habitService` needs these, and
 * `planService` needs `habitService` for its ownership scoping. Putting them in
 * either one would close the loop into a circular import.
 */

/**
 * The hash of the route this habit was *started* on: the first rule and the
 * programme. A frequency changed half way is a deviation from the route the
 * plan describes, and the clone stops matching — which is the whole point.
 *
 * A habit with no end has no programme to hash and can never match a plan.
 */
export const scheduleHashOfHabit = (habit: IHabit): string => {
    if (!habit.program) return '';

    const [first] = rulesOf(habit);
    return contentHash(
        { frequency: first.frequency, target: first.target },
        habit.program.map(session => session.title),
    );
};

/**
 * Whether this habit is the clone of its plan that the statistics follow.
 *
 * The same plan may be taken twice, and both takes are real habits — but a
 * plan's completion rate is a count of *people*, so only the first take of each
 * counts. "First" is the oldest, which this reads straight off the index.
 */
const isCountedClone = async (habit: IHabit): Promise<boolean> => {
    const first = await Habit.findOne({ userId: habit.userId, fromPlanId: habit.fromPlanId })
        .sort({ createdAt: 1, _id: 1 })
        .select('_id');

    return first !== null && String(first._id) === String(habit._id);
};

/**
 * Counts a fresh take of a plan, once per person.
 *
 * Called after the habit exists, so the count it reads includes it: exactly one
 * means this is that person's first take. Counting rather than looking for an
 * earlier one keeps the query free of `$ne`, which `sanitizeFilter` would wrap
 * in `$eq` and quietly turn into nonsense.
 */
export const registerClone = async (habit: IHabit): Promise<void> => {
    if (!habit.fromPlanId) {
        return;
    }

    const takes = await Habit.countDocuments({
        userId: habit.userId,
        fromPlanId: habit.fromPlanId,
    });

    if (takes !== 1) {
        return;
    }

    await Plan.updateOne({ _id: habit.fromPlanId }, { $inc: { cloneCount: 1 } });
};

/** What a clone was worth to its plan's statistics before the caller touched it. */
export interface CloneSnapshot {
    /** Every session of the programme is done — not merely behind. */
    finished: boolean;
    hash: string;
}

/**
 * A habit that is "complete" in the app's own terms has every session behind
 * it, done or not. A plan's completion rate means something stricter: that
 * people walked the plan to its end. Counting a clone that was abandoned on day
 * two and merely outlived its calendar would put a rate on the library that
 * measures nothing, so the statistics count only a programme done in full.
 *
 * Async because it reads the log; a habit that came from no plan has nothing to
 * snapshot and costs no query.
 */
export const snapshotClone = async (habit: IHabit, now: Date = new Date()): Promise<CloneSnapshot> => {
    if (!habit.fromPlanId) {
        return { finished: false, hash: '' };
    }

    const logs = await HabitDay.find({ userId: habit.userId, habitId: habit._id })
        .lean<LoggedDay[]>();
    const { timeline } = evaluate(habit, logs, toDayNumber(now));

    return {
        finished:
            timeline.completed &&
            timeline.sessionsTotal !== undefined &&
            timeline.doneSlots >= timeline.sessionsTotal,
        hash: scheduleHashOfHabit(habit),
    };
};

/**
 * Moves a plan's completed-clone counter by the difference this change made.
 *
 * Taking a snapshot before and after rather than reacting to "the habit was
 * just completed" is what makes it exact under every path: finishing, undoing,
 * rescheduling, and rewriting a day all change the same two inputs, and the
 * delta between the two snapshots is the whole answer. A one-way increment
 * would drift the first time someone un-ticked a day or shortened a plan they
 * had already finished.
 */
export const syncCloneStats = async (habit: IHabit, before: CloneSnapshot): Promise<void> => {
    if (!habit.fromPlanId) {
        return;
    }

    const after = await snapshotClone(habit);
    if (before.finished === after.finished && before.hash === after.hash) {
        return;
    }

    const plan = await Plan.findById(habit.fromPlanId).select('contentHash');
    if (!plan) {
        return;
    }

    // Finished *and* still running the schedule that was published. A clone
    // whose days or length were changed is not evidence about this plan.
    const counts = (snapshot: CloneSnapshot) =>
        snapshot.finished && snapshot.hash === plan.contentHash;

    const delta = Number(counts(after)) - Number(counts(before));
    if (delta === 0 || !(await isCountedClone(habit))) {
        return;
    }

    await Plan.updateOne({ _id: plan._id }, { $inc: { completedCloneCount: delta } });
};

/**
 * Awards the proven badge if the source habit has earned it.
 *
 * One of two lazy triggers, and there is no third: this project has no
 * background jobs and does not want any. The same reasoning that keeps `missed`
 * derived rather than stored applies here — a nightly task would have to run in
 * every user's own timezone and would be wrong until it did.
 */
export const matureProvenBadge = async (habit: IHabit, now: Date = new Date()): Promise<void> => {
    if (!habit.publishedPlanId || !habit.program) {
        return;
    }

    const plan = await Plan.findById(habit.publishedPlanId);
    if (!plan || plan.proven) {
        return;
    }

    const logs = await HabitDay.find({ userId: habit.userId, habitId: habit._id })
        .lean<LoggedDay[]>();
    const { timeline } = evaluate(habit, logs, toDayNumber(now));

    const earned = qualifiesAsProven(
        {
            endDate: timeline.endDay === undefined ? undefined : fromDayNumber(timeline.endDay),
            sessions: habit.program.length,
            doneCount: timeline.doneSlots,
            habitHash: scheduleHashOfHabit(habit),
            planHash: plan.contentHash,
        },
        now,
    );

    if (!earned) {
        return;
    }

    plan.proven = true;
    plan.provenAt = now;
    await plan.save();
};

/**
 * The second trigger, for every plan one author has published.
 *
 * The first trigger fires on a completion, which never comes for someone who
 * walked away on day 85 and marked nothing since — yet their plan may still
 * have cleared the threshold. Opening the author's own page is the next moment
 * anyone looks, so it is the next moment worth checking.
 *
 * Reads the author's habits and filters in memory rather than querying
 * `publishedPlanId: { $exists: true }`: `sanitizeFilter` wraps any all-`$` value
 * in `$eq`, and one person's habits are a handful of documents.
 */
export const matureAuthorPlans = async (userId: string, now: Date = new Date()): Promise<void> => {
    const habits = await Habit.find({ userId });

    await Promise.all(
        habits
            .filter(habit => habit.publishedPlanId)
            .map(habit => matureProvenBadge(habit, now)),
    );
};
