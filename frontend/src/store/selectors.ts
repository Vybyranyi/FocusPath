import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@store/store";
import { getHabitProgress } from "@/lib/habitProgress";
import { isDone } from "@/lib/habitStatus";

export const selectAllHabits = (state: RootState) => state.habit.habits;
export const selectHabitsForDate = (state: RootState) => state.habit.habitsForDate;

/**
 * Derived values go through createSelector so they are computed once per change
 * rather than on every render of every subscriber. The plain field selectors
 * above need no memoising — they return a slice of state as it already is.
 */
export const selectBuildHabits = createSelector([selectAllHabits], habits =>
    habits.filter(habit => habit.type === "build"),
);

export const selectQuitHabits = createSelector([selectAllHabits], habits =>
    habits.filter(habit => habit.type === "quit"),
);

export interface DailyProgress {
    total: number;
    completed: number;
    percentage: number;
}

/** How much of the selected day is done. */
export const selectDailyProgress = createSelector(
    [selectHabitsForDate],
    (habits): DailyProgress => {
        const total = habits.length;
        const completed = habits.filter(habit => isDone(habit.dayInfo)).length;

        return { total, completed, percentage: getHabitProgress(completed, total) };
    },
);
