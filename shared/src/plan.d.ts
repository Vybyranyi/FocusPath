import type { Frequency, HabitType, Target, TimeOfDay } from "./habit";

/**
 * The fixed set of things a plan can be about.
 *
 * Deliberately a closed union rather than free text. Free text guarantees
 * "Спорт", "спорт", "Sport" and "фітнес" as four different categories in the
 * same collection, and a filter over that matches nothing anyone expects.
 *
 * The runtime list lives on the server (`PLAN_CATEGORIES` in `models/Plan.ts`),
 * because this package holds declarations only. The client keeps its own copy as
 * a `Record` over this union, so a category added here and forgotten there is a
 * type error rather than a filter that quietly returns nothing.
 */
export type PlanCategory =
    | "health"
    | "fitness"
    | "mind"
    | "learning"
    | "productivity"
    | "money"
    | "sleep"
    | "nutrition"
    | "digital"
    | "social"
    | "creativity"
    | "other";

/**
 * Where a plan is in its life.
 *
 * Withdrawal is soft: hard deletion would cut the `fromPlanId` link on every
 * habit taken from it and erase the trail moderation works from.
 */
export type PlanStatus = "published" | "unpublished" | "removed";

/** The editorial shelves of the Explore page. */
export type PlanSection = "official" | "proven" | "new";

/** Why someone reported a plan. */
export type ReportReason = "dangerous" | "spam" | "offensive" | "nonsense" | "other";

/** One session of a published plan. Unlike a habit's day it carries no date and no status. */
export interface PlanDay {
    dayTitle: string;
}

/**
 * A published plan, as the API exposes it.
 *
 * A snapshot, not a view of a habit: publishing copies the content and detaches
 * from the source for good. A live link would let the author rewrite day 40
 * under someone who is on day 12.
 *
 * The owner link, the source habit, the content hash and the moderation trail
 * are storage details and never leave the server — `toJSON` on the model strips
 * them, so no controller has to remember to.
 */
export interface Plan {
    _id: string;
    title: string;
    description: string;
    category: PlanCategory;
    /** ISO 639-1, detected when the plan was published. */
    language: string;
    type: HabitType;
    /** Number of sessions, equal to `days.length`. */
    duration: number;
    /** How often the plan is walked. Plans from before frequencies ran daily. */
    frequency: Frequency;
    target?: Target;
    timeOfDay: TimeOfDay;
    color: string;
    icon: string;
    /**
     * The whole plan for a caller with a session; the first three days for one
     * without, alongside `daysTruncated`.
     */
    days: PlanDay[];
    /** Present and `true` only when `days` was cut down to the teaser. */
    daysTruncated?: boolean;
    /** Absent `displayName` means the author chose to stay anonymous. */
    author: { displayName?: string };
    /** The author finished the source habit on this exact schedule. */
    proven: boolean;
    provenAt?: string;
    /** Seeded by the project. A different badge from `proven`; the two never merge. */
    official: boolean;
    status: PlanStatus;
    /** How many people took the plan. Only first, unmodified clones are counted. */
    cloneCount: number;
    /**
     * Share of clones that reached the end, 0–100.
     *
     * Absent below ten clones on purpose: at one clone the number is either
     * "100%" or "0%", and neither says anything about the plan.
     */
    completionRate?: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * A plan as it appears in a list, which is everything except its content.
 *
 * The day titles are the one part of a plan that is unbounded — up to 365 of
 * them — and a card shows none of them. Shipping twenty plans' worth of days to
 * draw twenty tiles is the same mistake `HabitSummary` exists to avoid.
 */
export type PlanSummary = Omit<Plan, "days" | "daysTruncated">;

/** One page of `GET /plans`. `nextCursor` is absent once the list is exhausted. */
export interface PlanPage {
    plans: PlanSummary[];
    nextCursor?: string;
}
