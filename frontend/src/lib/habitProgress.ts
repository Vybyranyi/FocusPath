import type { HabitProgress } from "@shared/index";

/**
 * How far through a habit's plan, as a whole percentage.
 *
 * Five components worked this out for themselves and no two agreed: some
 * floored, some rounded, some clamped and some could show more than 100%.
 */
export const getHabitProgress = (completed: number, total: number): number => {
  if (total <= 0) return 0;

  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
};

/**
 * The figure a card or a bar shows for a habit.
 *
 * A programme is measured against its length — "12 of 36 sessions" — because
 * that is what the person set out to do. A habit with no end has no length, so
 * it is measured against the slots that are already over: the future cannot be
 * in the denominator, or the tenth day of a flawless run would read 11%.
 */
export const habitCompletion = (progress: HabitProgress): number =>
  progress.sessionsTotal
    ? getHabitProgress(progress.done, progress.sessionsTotal)
    : progress.percentage;
