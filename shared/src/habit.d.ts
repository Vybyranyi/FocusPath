export type HabitType = "build" | "quit";

export interface HabitStep {
    _id: string;
    title: string;
    completed: boolean;
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
