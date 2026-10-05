import type { DayState, HabitDay } from "@shared/index";

export type { DayState };

/** Whether a day counts towards progress and streaks. */
export const isDone = (day: Pick<HabitDay, "state">): boolean => day.state === "done";

/**
 * A weekly habit whose week is met is finished for now, whichever day it is
 * looked at on — it stays on the day view, muted, rather than asking for more.
 */
export const isWeekMet = (day: Pick<HabitDay, "week">): boolean =>
  day.week !== undefined && day.week.target > 0 && day.week.done >= day.week.target;

/**
 * Nothing left to do on this habit today: it is done, or it is a weekly habit
 * whose week is already met.
 */
export const isSettled = (day: Pick<HabitDay, "state" | "week">): boolean =>
  isDone(day) || isWeekMet(day);

/** Days the habit is deliberately not asked for. They count for nothing, either way. */
export const isOff = (day: Pick<HabitDay, "state">): boolean =>
  day.state === "paused" || day.state === "rest";
