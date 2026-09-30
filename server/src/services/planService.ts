import mongoose from 'mongoose';
import Plan, { MIN_CLONES_FOR_RATE, type IPlan } from '@models/Plan';
import Report, { type IReport } from '@models/Report';
import User from '@models/User';
import Habit from '@models/Habit';
import {
    ConflictError,
    ContentRejectedError,
    NotFoundError,
    ServiceUnavailableError,
} from '@errors/AppError';
import { logger } from '@config/logger';
import { requireOwnedHabit } from '@services/habitService';
import { reviewPlan, MODERATION_MODEL } from '@services/moderationService';
import { scheduleHash } from '@services/planContent';
import { matureAuthorPlans } from '@services/planStats';
import type { PlanSection, PlanSummary } from '@shared/index';
import type { PublishPlanDto, ReportPlanDto, UpdatePlanDto } from '@validation/planSchemas';

/** How much of a plan someone without a session may read. */
export const TEASER_DAYS = 3;

const DEFAULT_LIMIT = 20;

/**
 * Publishes a habit as a plan.
 *
 * The content is copied, never referenced. A live link would let an author
 * rewrite day 40 under someone who is on day 12, and would weld a public
 * document onto `Habit`, whose whole `toJSON` exists to keep things private.
 *
 * `steps` are deliberately left behind: they belong to a habit as a whole
 * rather than to a day, and in a template they read as an arbitrary list.
 */
export const publishPlan = async (userId: string, dto: PublishPlanDto): Promise<IPlan> => {
    const habit = await requireOwnedHabit(userId, dto.habitId);

    if (habit.publishedPlanId) {
        throw new ConflictError('This habit has already been published');
    }

    const dayTitles = habit.dailyCompletions.map(day => day.dayTitle);

    // Fail closed. Publishing is not urgent — unlike habit generation, which is
    // already allowed to fall over with a 503 — and an unreviewed plan sitting
    // in a public library is the one outcome worth refusing over.
    let review;
    try {
        review = await reviewPlan({
            title: habit.title,
            description: habit.description ?? '',
            dayTitles,
        });
    } catch (error) {
        logger.error({ err: error, habitId: dto.habitId }, 'Plan moderation failed');
        throw new ServiceUnavailableError('Publishing is unavailable right now — try again later');
    }

    if (review.verdict === 'reject') {
        throw new ContentRejectedError(
            review.reason ?? 'This plan cannot be published in the public library',
        );
    }

    const plan = await Plan.create({
        title: habit.title,
        description: habit.description ?? '',
        category: dto.category,
        language: review.language,
        type: habit.type,
        duration: habit.duration,
        color: habit.color,
        icon: habit.icon,
        days: dayTitles.map(dayTitle => ({ dayTitle })),
        author: { userId, displayName: dto.displayName },
        sourceHabitId: habit._id,
        contentHash: scheduleHash(habit.duration, dayTitles),
        moderation: {
            checkedAt: new Date(),
            model: MODERATION_MODEL,
            verdict: review.verdict,
            reason: review.reason,
        },
    });

    // Remembered so the badge can find this plan when the habit finishes, and
    // so the same habit cannot be published a second time.
    habit.publishedPlanId = plan._id as mongoose.Types.ObjectId;
    await habit.save();

    // Kept on the account too, so the publish form can offer it next time.
    // Signing a plan stays an explicit act each time — the stored name only
    // prefills the field, it is never applied on its own.
    if (dto.displayName) {
        await User.updateOne({ _id: userId }, { $set: { displayName: dto.displayName } });
    }

    return plan;
};

type SortField = 'createdAt' | 'cloneCount' | 'rate' | '_id';

/** Sort keys per shelf, always ending at `_id` so the order is total. */
const SECTION_SORT: Record<PlanSection | 'all', SortField[]> = {
    official: ['createdAt', '_id'],
    proven: ['rate', 'cloneCount', '_id'],
    new: ['createdAt', '_id'],
    all: ['createdAt', '_id'],
};

/** Which shelf a plan belongs to, as a match stage. */
const SECTION_MATCH: Record<PlanSection, Record<string, unknown>> = {
    official: { official: true },
    proven: { $or: [{ proven: true }, { cloneCount: { $gte: MIN_CLONES_FOR_RATE } }] },
    // The remainder: everything the two shelves above did not already claim.
    new: { official: false, proven: false, cloneCount: { $lt: MIN_CLONES_FOR_RATE } },
};

/** Revives one cursor value into whatever the pipeline compares it against. */
const CURSOR_REVIVERS: Record<SortField, (value: unknown) => unknown> = {
    createdAt: value => new Date(String(value)),
    _id: value => new mongoose.Types.ObjectId(String(value)),
    cloneCount: value => Number(value),
    // Null is a real position here: a proven plan with fewer than ten clones
    // has no rate, and those sort last.
    rate: value => (value === null ? null : Number(value)),
};

const encodeCursor = (key: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(key)).toString('base64url');

const decodeCursor = (cursor: string, fields: SortField[]): Record<string, unknown> | null => {
    try {
        const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Record<string, unknown>;
        const revived: Record<string, unknown> = {};

        for (const field of fields) {
            if (!(field in raw)) return null;
            revived[field] = CURSOR_REVIVERS[field](raw[field]);
        }

        return revived;
    } catch {
        // A cursor is opaque to the client, so a broken one is not worth an
        // error page — the first page is the honest answer.
        return null;
    }
};

/**
 * "Strictly past this point", spelled out over a compound sort.
 *
 * Every key is descending, so each clause pins the keys before it and takes
 * what is lower on the next one.
 */
const afterCursor = (fields: SortField[], cursor: Record<string, unknown>) => ({
    $or: fields.map((field, index) => ({
        ...Object.fromEntries(fields.slice(0, index).map(earlier => [earlier, cursor[earlier]])),
        [field]: { $lt: cursor[field] },
    })),
});

interface ListPlansQuery {
    category?: string;
    language?: string;
    section?: PlanSection;
    cursor?: string;
    limit?: number;
}

/**
 * One page of the library.
 *
 * Built with `aggregate` rather than `find` for a reason this repository has
 * already paid for once: `sanitizeFilter` is on mongoose-wide and wraps any
 * value whose keys all start with `$` in `$eq`, so a plain
 * `find({ cloneCount: { $gte: 10 } })` becomes `{ $eq: { $gte: 10 } }` and
 * returns nothing. Inside an aggregation's `$match` it does not interfere —
 * which is also why `getHabitsForDate` is written this way.
 *
 * The projection repeats what the model's `toJSON` does, because an aggregation
 * returns plain objects and never passes through it. Both must keep
 * `sourceHabitId`, `contentHash`, `moderation`, `author.userId` and the raw
 * `completedCloneCount` off the wire.
 */
export const listPlans = async (
    query: ListPlansQuery,
): Promise<{ plans: PlanSummary[]; nextCursor?: string }> => {
    const limit = query.limit && query.limit > 0 ? query.limit : DEFAULT_LIMIT;
    const fields = SECTION_SORT[query.section ?? 'all'];

    const match: Record<string, unknown> = { status: 'published' };
    if (query.category) match.category = query.category;
    if (query.language) match.language = query.language;

    const pipeline: mongoose.PipelineStage[] = [
        { $match: match },
        ...(query.section ? [{ $match: SECTION_MATCH[query.section] }] : []),
        {
            $addFields: {
                rate: {
                    $cond: [
                        { $gte: ['$cloneCount', MIN_CLONES_FOR_RATE] },
                        { $divide: ['$completedCloneCount', '$cloneCount'] },
                        null,
                    ],
                },
            },
        },
    ];

    const cursor = query.cursor ? decodeCursor(query.cursor, fields) : null;
    if (cursor) {
        pipeline.push({ $match: afterCursor(fields, cursor) });
    }

    pipeline.push(
        { $sort: Object.fromEntries(fields.map(field => [field, -1])) },
        // One more than asked for, so "is there another page" needs no count.
        { $limit: limit + 1 },
        {
            $project: {
                title: 1,
                description: 1,
                category: 1,
                language: 1,
                type: 1,
                duration: 1,
                color: 1,
                icon: 1,
                proven: 1,
                provenAt: 1,
                official: 1,
                status: 1,
                cloneCount: 1,
                createdAt: 1,
                updatedAt: 1,
                'author.displayName': 1,
                completionRate: {
                    $cond: [
                        { $gte: ['$cloneCount', MIN_CLONES_FOR_RATE] },
                        { $round: [{ $multiply: ['$rate', 100] }, 0] },
                        '$$REMOVE',
                    ],
                },
            },
        },
    );

    const found = await Plan.aggregate<PlanSummary & { _id: mongoose.Types.ObjectId }>(pipeline);
    const plans = found.slice(0, limit);

    if (found.length <= limit || plans.length === 0) {
        return { plans };
    }

    const last = plans[plans.length - 1];
    // `rate` is recoverable from what was projected: it is non-null exactly when
    // the completion rate is shown, so the cursor needs no extra field.
    const key: Record<SortField, unknown> = {
        createdAt: last.createdAt,
        cloneCount: last.cloneCount,
        rate: last.completionRate === undefined ? null : last.completionRate / 100,
        _id: last._id,
    };

    return {
        plans,
        nextCursor: encodeCursor(Object.fromEntries(fields.map(field => [field, key[field]]))),
    };
};

/**
 * One plan's card.
 *
 * Two shapes from one endpoint, decided by whether the caller has a session —
 * the price this feature accepts knowingly. Showing everything to anonymous
 * visitors hands the content away past the clone and past the statistics;
 * hiding it from signed-in ones means committing to ninety days blind, dropping
 * out on day five, and spoiling the very completion rate the library is built
 * on. The wall belongs in front of registration, not in front of the feature.
 */
export const getPlan = async (planId: string, full: boolean): Promise<Record<string, unknown>> => {
    const plan = await Plan.findOne({ _id: planId, status: 'published' });
    if (!plan) {
        throw new NotFoundError('Plan not found');
    }

    const json = plan.toJSON() as Record<string, unknown>;
    if (full) {
        return json;
    }

    return {
        ...json,
        days: (json.days as Array<unknown>).slice(0, TEASER_DAYS),
        daysTruncated: true,
    };
};

/**
 * The author's own plan, whatever state it is in.
 *
 * Scoped by author, and answers `NOT_FOUND` for someone else's — as everywhere
 * in this project, since `FORBIDDEN` would confirm that a plan with that id
 * exists. A plan pulled by moderation stays out of reach of its author too:
 * editing it would only put the same content back in front of the queue.
 */
const requireOwnedPlan = async (userId: string, planId: string): Promise<IPlan> => {
    const plan = await Plan.findOne({ _id: planId, 'author.userId': userId, status: 'published' });
    if (!plan) {
        throw new NotFoundError('Plan not found');
    }
    return plan;
};

export const updatePlan = async (
    userId: string,
    planId: string,
    changes: UpdatePlanDto,
): Promise<IPlan> => {
    const plan = await requireOwnedPlan(userId, planId);

    if (changes.title !== undefined) plan.title = changes.title;
    if (changes.description !== undefined) plan.description = changes.description;
    if (changes.category !== undefined) plan.category = changes.category as IPlan['category'];

    await plan.save();
    return plan;
};

/**
 * Withdrawal, softly.
 *
 * Hard deletion would cut the `fromPlanId` on every habit taken from this plan
 * and erase what moderation reviews from.
 */
export const unpublishPlan = async (userId: string, planId: string): Promise<IPlan> => {
    const plan = await requireOwnedPlan(userId, planId);

    plan.status = 'unpublished';
    await plan.save();

    // The habit is free to be published again. Keeping the link made a
    // withdrawal permanent — the server refuses a second publication of a
    // habit that has one — and left the habit's menu pointing at a plan the
    // library no longer serves. Only a link still naming this plan is cleared,
    // and only here: a plan a moderator removed does not come back this way.
    await Habit.updateOne(
        { _id: plan.sourceHabitId, publishedPlanId: plan._id },
        { $unset: { publishedPlanId: '' } },
    );

    return plan;
};

/**
 * The author's private page.
 *
 * Publishing is otherwise a write-only act: anonymous by default, with no
 * public author statistics and no notifications anywhere in this project. This
 * is the only way someone can find out that a plan of theirs helped anyone.
 */
export const listMyPlans = async (userId: string): Promise<IPlan[]> => {
    await matureAuthorPlans(userId);

    return Plan.find({ 'author.userId': userId }).sort({ createdAt: -1 });
};

/**
 * Files a complaint. One open report per person per plan — a second is the same
 * person saying the same thing, and it would only pad the queue.
 */
export const reportPlan = async (
    userId: string,
    planId: string,
    dto: ReportPlanDto,
): Promise<IReport> => {
    const plan = await Plan.findOne({ _id: planId, status: 'published' }).select('_id');
    if (!plan) {
        throw new NotFoundError('Plan not found');
    }

    const existing = await Report.findOne({ planId, reporterUserId: userId, status: 'open' });
    if (existing) {
        return existing;
    }

    return Report.create({
        planId,
        reporterUserId: userId,
        reason: dto.reason,
        comment: dto.comment,
    });
};
