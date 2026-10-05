import type { Frequency, HabitType, ReasonCode, Target } from "./habit";

/**
 * What a coach card is about.
 *
 * - `weekly_review`: the week that just ended, by the numbers;
 * - `recalibration`: one habit has been failed three slots running, with a
 *   concrete easier plan to apply;
 * - `insight`: one pattern the numbers cleared a threshold for.
 */
export type CoachCardKind = "weekly_review" | "recalibration" | "insight";

/**
 * Where a card is in its life.
 *
 * A `candidate` is a recalibration that has been worked out and not yet
 * explained: no text exists, and none is paid for until the person opens it.
 */
export type CoachCardStatus = "candidate" | "ready" | "failed" | "dismissed" | "applied";

/** What the model wrote. The numbers in it were counted by code, never by the model. */
export interface CoachContent {
    title: string;
    body: string;
    /** The one good thing in the week. */
    win?: string;
    /** The one concrete thing to do next. */
    tip?: string;
}

/** One habit's week, as counted. */
export interface WeeklyHabitFacts {
    title: string;
    type: HabitType;
    slots: number;
    done: number;
    /** 0–100. */
    percentage: number;
    /** Absent when the habit did not exist the week before. */
    previousPercentage?: number;
    streak: number;
    streakUnit: "day" | "week";
    /**
     * Days of the week (1 = Monday) the habit is most and least often done on,
     * over the last two months. Only for a habit scheduled on particular days,
     * and only when there is enough of it for the two to differ.
     */
    bestWeekday?: number;
    worstWeekday?: number;
}

export interface WeeklyReviewFacts {
    /** The Monday of the week reviewed, `YYYY-MM-DD`. */
    weekStart: string;
    habits: WeeklyHabitFacts[];
    /** Average mood of the days written about; absent when none was. */
    mood?: { average: number; previousAverage?: number; days: number };
    energy?: { average: number; previousAverage?: number; days: number };
    /** How often each reason was given this week. */
    reasons: Partial<Record<ReasonCode, number>>;
}

/** A habit's schedule as it stands, and as it would be. */
export interface Recalibration {
    frequency: Frequency;
    target?: Target;
}

export interface RecalibrationProposal {
    /** Which habit, by its title — the id stays on the card. */
    habitTitle: string;
    /** The rule the proposal was worked out against; applying is refused if it has since changed. */
    from: Recalibration;
    to: Recalibration;
    /** For a programme: the sessions about to be rewritten more gently. */
    rewrite?: {
        /** 1-based number of the first session rewritten. */
        fromSession: number;
        current: string[];
        /** Absent until the card is opened and the model has written them. */
        proposed?: string[];
    };
}

export interface CoachCard {
    _id: string;
    kind: CoachCardKind;
    /** The period the card belongs to: a week's Monday, a habit and a week, or a day. */
    key: string;
    habitId?: string;
    status: CoachCardStatus;
    /** Counted by code; what the text was written from and what is shown beside it. */
    facts: Record<string, unknown>;
    proposal?: RecalibrationProposal;
    content?: CoachContent;
    /** ISO 639-1 language the text is written in. */
    language: string;
    feedback?: "helpful" | "not_helpful";
    createdAt: string;
    readyAt?: string;
}
