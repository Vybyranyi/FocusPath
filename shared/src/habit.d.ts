export type HabitType = "build" | "quit";

/**
 * One item of a habit's daily checklist. The habit holds the titles; whether a
 * step is done is recorded per day, in `DailyCompletion.completedSteps`.
 *
 * It used to carry a single `completed` flag for the whole habit, so a step
 * ticked on Monday was still ticked on Tuesday and every day after — a daily
 * checklist that could only ever be filled in once.
 */
export interface HabitStep {
    _id: string;
    title: string;
}

/**
 * What a scheduled day is currently worth.
 *
 * `failed` is the user saying "I did not do this", which a boolean could not
 * express: it and "the day has not happened yet" were both `false`, so an
 * explicit red mark could not survive a reload.
 *
 * There is deliberately no `missed` here. A day that is still `pending` once it
 * is over is missed, and that follows from the date — storing it would need a
 * job flipping rows at midnight in every user's own timezone, and would be
 * wrong between the flip and the read. See `dayState` on the client.
 */
export type DayStatus = "pending" | "done" | "failed";

/** One scheduled day of a habit. The schedule is generated up front, one entry per day of `duration`. */
export interface DailyCompletion {
    _id: string;
    dayTitle: string;
    /** ISO 8601 date string, normalised to midnight UTC. */
    date: string;
    status: DayStatus;
    /** Ids of the habit's steps ticked on this day. */
    completedSteps: string[];
}

/** A habit in full, as returned by `GET /habits` and `GET /habits/:id`. */
export interface Habit {
    _id: string;
    title: string;
    description?: string;
    category?: string;
    steps?: HabitStep[];
    /** ISO 8601 date string, normalised to midnight UTC. */
    startDate: string;
    /** Number of days the habit runs for. Always equals `dailyCompletions.length`. */
    duration: number;
    type: HabitType;
    color: string;
    icon: string;
    currentStreak: number;
    isCompleted: boolean;
    dailyCompletions: DailyCompletion[];
    /** The plan this habit was taken from, when it came out of the library. */
    fromPlanId?: string;
    /**
     * The plan published from this habit. Kept so the same habit cannot be
     * published twice, and so the badge can find its plan cheaply when the
     * habit finishes.
     */
    publishedPlanId?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * A habit narrowed to a single day, as returned by `GET /habits/daily`.
 *
 * The aggregation swaps the full schedule for just that day's entry plus a
 * precomputed total, so listing a day never ships every other day with it.
 */
export interface HabitSummary
    extends Omit<Habit, "dailyCompletions" | "createdAt" | "updatedAt"> {
    dayInfo: DailyCompletion;
    /** How many days of the whole habit are done, across the entire schedule. */
    completedCount: number;
}

/**
 * How often a habit is scheduled.
 *
 * `weekdays` days are numbered 1 = Monday … 7 = Sunday. `weekly` is a number of
 * times in a Monday–Sunday week, not tied to particular days: any day of the
 * week may fill one of the slots.
 */
export type Frequency =
    | { kind: "daily" }
    | { kind: "weekdays"; days: number[] }
    | { kind: "weekly"; times: number };

/**
 * A quantity per day. Its direction comes from the habit's `type` — `build`
 * means "at least", `quit` means "at most" — so a contradiction such as "quit,
 * at least 5" cannot be stored.
 */
export interface Target {
    value: number;
    unit: string;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "anytime";

/** What a habit asked of its owner from `effectiveFrom` on. The first rule starts at `startDate`. */
export interface HabitRule {
    /** ISO 8601 date string, normalised to midnight UTC. */
    effectiveFrom: string;
    frequency: Frequency;
    target?: Target;
}

/** A stretch of days that do not count. An open pause has no `to`. */
export interface HabitPause {
    _id: string;
    /** ISO 8601 date string, normalised to midnight UTC. */
    from: string;
    to?: string;
}

/**
 * What a day is worth on screen. `missed` is derived from the date, never
 * stored, for the reason given on `DayStatus`; `paused` and `rest` are days the
 * habit is deliberately not asked for.
 */
export type DayState = DayStatus | "missed" | "paused" | "rest";
