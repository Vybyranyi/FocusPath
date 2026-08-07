import type { DailyCompletion, DayStatus } from "@shared/index";
import { dayKeyOf, todayKey } from "@/lib/dates";

/**
 * What a day is worth on screen: its stored status, plus `missed` for one the
 * user let slip past.
 *
 * `missed` is derived rather than stored on purpose. Storing it would mean a
 * job flipping rows at midnight — in every user's own timezone, since that is
 * when *their* day ends — and every row would be wrong in the window between
 * the day turning over and the job running. Reading the date costs nothing and
 * is never stale.
 */
export type DayState = DayStatus | "missed";

export const dayState = (day: DailyCompletion, today: string = todayKey()): DayState =>
  day.status === "pending" && dayKeyOf(day.date) < today ? "missed" : day.status;

/** Whether a day counts towards progress and streaks. */
export const isDone = (day: Pick<DailyCompletion, "status">): boolean =>
  day.status === "done";
