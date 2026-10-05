import { describe, expect, it } from "vitest";
import type { Habit, HabitSummary } from "@shared/index";
import {
  selectBuildHabits,
  selectDailyProgress,
  selectQuitHabits,
} from "@store/selectors";
import type { RootState } from "@store/store";
import { makeHabitSummary } from "../testUtils";

const makeHabit = (overrides: Partial<Habit> = {}): Habit => ({
  _id: "habit-1",
  title: "Read",
  startDate: "2025-01-06T00:00:00.000Z",
  type: "build",
  color: "blue",
  icon: "books",
  timeOfDay: "anytime",
  rules: [{ effectiveFrom: "2025-01-06T00:00:00.000Z", frequency: { kind: "daily" } }],
  frequency: { kind: "daily" },
  sessions: 7,
  pauses: [],
  restDays: [],
  currentStreak: 0,
  streakUnit: "day",
  isCompleted: false,
  progress: { done: 0, decided: 0, percentage: 0, sessionsTotal: 7 },
  createdAt: "2025-01-06T00:00:00.000Z",
  updatedAt: "2025-01-06T00:00:00.000Z",
  ...overrides,
});

const stateWith = (habit: Partial<RootState["habit"]>): RootState =>
  ({
    habit: {
      habits: [],
      habitsForDate: [],
      loading: false,
      creating: null,
      error: null,
      ...habit,
    },
  }) as RootState;

const day = (id: string, completed: boolean, state?: HabitSummary["day"]["state"]) =>
  makeHabitSummary({
    _id: id,
    day: {
      completedSteps: [],
      date: "2025-01-06T00:00:00.000Z",
      state: state ?? (completed ? "done" : "pending"),
    },
  });

describe("habit grouping", () => {
  const state = stateWith({
    habits: [
      makeHabit({ _id: "a", type: "build" }),
      makeHabit({ _id: "b", type: "quit" }),
      makeHabit({ _id: "c", type: "build" }),
    ],
  });

  it("splits habits by what they are for", () => {
    expect(selectBuildHabits(state).map(h => h._id)).toEqual(["a", "c"]);
    expect(selectQuitHabits(state).map(h => h._id)).toEqual(["b"]);
  });

  it("returns the same array when the habits have not changed", () => {
    // Without memoising, every render would hand components a new array and
    // defeat any comparison they do on their props.
    expect(selectBuildHabits(state)).toBe(selectBuildHabits(state));
  });

  it("recomputes once the habits do change", () => {
    const first = selectBuildHabits(state);
    const next = selectBuildHabits(stateWith({ habits: [makeHabit({ _id: "d" })] }));

    expect(next).not.toBe(first);
    expect(next.map(h => h._id)).toEqual(["d"]);
  });
});

describe("selectDailyProgress", () => {
  it("is empty when the day has no habits", () => {
    expect(selectDailyProgress(stateWith({}))).toEqual({
      total: 0,
      completed: 0,
      percentage: 0,
    });
  });

  it("counts the completed share and rounds it", () => {
    const state = stateWith({
      habitsForDate: [day("a", true), day("b", false), day("c", false)],
    });

    expect(selectDailyProgress(state)).toEqual({
      total: 3,
      completed: 1,
      percentage: 33,
    });
  });

  it("leaves out a habit that is paused, or resting today", () => {
    const state = stateWith({
      habitsForDate: [day("a", true), day("b", false, "paused"), day("c", false, "rest")],
    });

    expect(selectDailyProgress(state)).toEqual({ total: 1, completed: 1, percentage: 100 });
  });

  it("counts a weekly habit whose week is met", () => {
    const met = makeHabitSummary({
      _id: "w",
      day: { completedSteps: [], date: "2025-01-06T00:00:00.000Z", state: "pending", week: { done: 3, target: 3 } },
    });

    expect(selectDailyProgress(stateWith({ habitsForDate: [met, day("b", false)] })).completed).toBe(1);
  });

  it("reaches a hundred only when everything is done", () => {
    const state = stateWith({ habitsForDate: [day("a", true), day("b", true)] });

    expect(selectDailyProgress(state).percentage).toBe(100);
  });
});
