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
 * wrong between the flip and the read. The server derives it — see
 * `resolveDayState` in `habitTimeline.ts`.
 */
export type DayStatus = "pending" | "done" | "failed";

/**
 * How far through a habit is, over the slots that are already over.
 *
 * The future is not in the denominator: it would show 11% on the tenth day of
 * a flawless ninety-day programme.
 */
export interface HabitProgress {
    /** Slots that were done. */
    done: number;
    /** Slots that are over — done, failed or missed. */
    decided: number;
    /** `done` over `decided`, 0–100. */
    percentage: number;
    /** Length of the programme in sessions; absent for a habit with no end. */
    sessionsTotal?: number;
}

/** A habit as the API returns it. */
export interface Habit {
    _id: string;
    title: string;
    description?: string;
    category?: string;
    steps?: HabitStep[];
    /** ISO 8601 date string, normalised to midnight UTC. */
    startDate: string;
    type: HabitType;
    color: string;
    icon: string;
    timeOfDay: TimeOfDay;
    /** What the habit asked for, from when. The last one in force today is `frequency`/`target`. */
    rules: HabitRule[];
    frequency: Frequency;
    target?: Target;
    /** Length of the programme in sessions. Absent for a habit with no end. */
    sessions?: number;
    /** ISO 8601 date string. Last day of a programme; a forecast until it has passed. */
    endDate?: string;
    pauses: HabitPause[];
    /** ISO 8601 date strings. */
    restDays: string[];
    currentStreak: number;
    /** What `currentStreak` counts: days, or weeks for a weekly habit. */
    streakUnit: "day" | "week";
    /** Every session of a programme is behind. Never true for a habit with no end. */
    isCompleted: boolean;
    progress: HabitProgress;
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

/** Why a day was not done. A closed list, so the reasons can be counted. */
export type ReasonCode =
    | "no_time"
    | "forgot"
    | "no_energy"
    | "ill"
    | "circumstances"
    | "didnt_want"
    | "other";

/** The reason given for a failed day, with an optional few words of the person's own. */
export interface FailureReason {
    code: ReasonCode;
    text?: string;
}

/** One day of a habit, worked out by the server. */
export interface HabitDay {
    /** ISO 8601 date string, normalised to midnight UTC. */
    date: string;
    state: DayState;
    /** The counted quantity, for a habit with a target. */
    value?: number;
    /** The target in force on this day. */
    target?: Target;
    /** Ids of the habit's steps ticked on this day. */
    completedSteps: string[];
    /** Which session of a programme this day carries. */
    session?: { index: number; total: number; title: string };
    /** Where a weekly habit stands this week. */
    week?: { done: number; target: number };
    /** A few words about how it went. */
    note?: string;
    /** Why a `failed` day was failed, if the person said. */
    failureReason?: FailureReason;
    /** The reason prompt has been shown for this day, so it is not shown again. */
    reasonPrompted?: boolean;
}

/**
 * A habit narrowed to one day, as returned by `GET /habits/daily`: the habit
 * itself plus how that day stands.
 */
export interface HabitSummary extends Habit {
    day: HabitDay;
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

/** One entry of a habit's log, as the export hands it over. */
export interface LoggedDay {
    /** ISO 8601 date string, normalised to midnight UTC. */
    day: string;
    status?: Exclude<DayStatus, "pending">;
    value?: number;
    completedSteps: string[];
    note?: string;
    failureReason?: FailureReason;
    reasonPrompted?: boolean;
}

/** A habit with everything it holds: the task of each session, and every day that was logged. */
export interface HabitExport extends Habit {
    program?: Array<{ title: string }>;
    days: LoggedDay[];
}
