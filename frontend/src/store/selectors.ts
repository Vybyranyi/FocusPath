import { createSelector } from "@reduxjs/toolkit";
import type { HabitSummary, TimeOfDay } from "@shared/index";
import type { RootState } from "@store/store";
import { getHabitProgress } from "@/lib/habitProgress";
import { isOff, isSettled } from "@/lib/habitStatus";
import { TIMES_OF_DAY } from "@/lib/schedule";

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

export const selectPlanSections = (state: RootState) => state.plans.sections;
export const selectMyPlans = (state: RootState) => state.plans.myPlans;
const selectPlansLoadedOnce = (state: RootState) => state.plans.loadedOnce;

/**
 * Whether the library has anything at all to show under the current filters.
 *
 * Derived from all three shelves at once, because "no plans" is a page-level
 * state — an empty shelf on its own is normal and says nothing.
 *
 * Gated on something having been fetched: an untouched store is also "every
 * shelf empty, none loading", which made the empty state flash for a frame
 * before the first request had even left.
 */
export const selectExploreIsEmpty = createSelector(
    [selectPlanSections, selectPlansLoadedOnce],
    (sections, loadedOnce) => {
        const shelves = Object.values(sections);
        return (
            loadedOnce &&
            shelves.every((shelf) => shelf.plans.length === 0) &&
            shelves.every((shelf) => !shelf.loading)
        );
    },
);

/** Plans the author has withdrawn are kept, but counted apart from live ones. */
export const selectPublishedPlanCount = createSelector([selectMyPlans], (plans) =>
    plans.filter((plan) => plan.status === "published").length,
);

export interface HabitGroup {
    timeOfDay: TimeOfDay;
    label: string;
    habits: HabitSummary[];
}

/**
 * The day's habits under Morning, Afternoon, Evening and Anytime, in that
 * order. A part of the day nobody has a habit in is left out rather than shown
 * empty, and a habit keeps its place within its group.
 */
export const selectHabitGroups = createSelector([selectHabitsForDate], (habits): HabitGroup[] =>
    TIMES_OF_DAY.map(({ value, label }) => ({
        timeOfDay: value,
        label,
        habits: habits.filter(habit => habit.timeOfDay === value),
    })).filter(group => group.habits.length > 0),
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
        // A paused habit or a rest day asks nothing today, so it is neither
        // owed nor done: leaving it in would put a goal on the banner that no
        // one can reach.
        const asked = habits.filter(habit => !isOff(habit.day));
        const total = asked.length;
        const completed = asked.filter(habit => isSettled(habit.day)).length;

        return { total, completed, percentage: getHabitProgress(completed, total) };
    },
);
