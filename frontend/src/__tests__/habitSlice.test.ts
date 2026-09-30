import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHabit,
  getHabitsForDate,
  markHabitCompletion,
  renameHabitDay,
  updateHabit,
} from "@store/habitSlice";
import type { Habit } from "@shared/index";
import { makeStore } from "@store/store";
import type { CreateHabitFormValues } from "@/types/forms";
import { habitState, makeHabitSummary } from "../testUtils";

const fetchMock = vi.fn();

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const urlAt = (call: number) => String(fetchMock.mock.calls[call][0]);
const bodyAt = (call: number) =>
  JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const formValues = (overrides: Partial<CreateHabitFormValues> = {}): CreateHabitFormValues => ({
  color: "#4F8DF9",
  emoji: "books",
  habitName: "Read daily",
  habitDescription: "Ten pages before bed",
  category: "learning",
  // Local midnight, which is what the date pickers hand back.
  startDate: new Date(2026, 7, 7),
  aiEnabled: false,
  duration: "7",
  habitType: "build",
  ...overrides,
});

describe("habitSlice", () => {
  describe("the day a request names", () => {
    it("asks for the day it was given, unaltered", async () => {
      fetchMock.mockResolvedValue(ok({ date: "", habits: [] }));

      await makeStore().dispatch(getHabitsForDate("2026-08-07"));

      expect(urlAt(0)).toContain("date=2026-08-07");
    });

    /**
     * The pickers produce local midnight. Sent as a full instant it became the
     * previous UTC day anywhere east of Greenwich, so a habit started "today"
     * was stored as starting yesterday — or refused as being in the past.
     */
    it("sends the start date as the calendar day the user picked", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createHabit(formValues()));

      expect(bodyAt(0).startDate).toBe("2026-08-07");
    });

    it("falls back to today when the form holds no start date", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createHabit(formValues({ startDate: undefined })));

      expect(bodyAt(0).startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    /** Dates from the server are already canonical; they travel back as-is. */
    it("marks the day the server named, not a re-encoding of it", async () => {
      fetchMock.mockResolvedValue(ok({ habit: { currentStreak: 1, isCompleted: false } }));

      await makeStore().dispatch(
        markHabitCompletion({
          habitId: "habit-1",
          date: "2026-08-07T00:00:00.000Z",
          status: "done",
        }),
      );

      expect(bodyAt(0).date).toBe("2026-08-07");
    });
  });

  describe("marking a day", () => {
    it("carries the server's recomputed progress into the day view", async () => {
      fetchMock.mockResolvedValue(
        ok({ habit: { currentStreak: 3, isCompleted: false } }),
      );

      const store = makeStore(
        habitState({ habitsForDate: [makeHabitSummary({ completedCount: 2 })] }),
      );

      await store.dispatch(
        markHabitCompletion({
          habitId: "habit-1",
          date: "2026-08-07T00:00:00.000Z",
          status: "done",
        }),
      );

      const [habit] = store.getState().habit.habitsForDate;
      expect(habit.dayInfo.status).toBe("done");
      expect(habit.completedCount).toBe(3);
      expect(habit.currentStreak).toBe(3);
    });

    it("does not count the same day twice", async () => {
      fetchMock.mockResolvedValue(
        ok({ habit: { currentStreak: 1, isCompleted: false } }),
      );

      const store = makeStore(
        habitState({
          habitsForDate: [
            makeHabitSummary({
              completedCount: 2,
              dayInfo: {
                _id: "day-1",
                dayTitle: "Read 10 pages",
                date: "2026-08-07T00:00:00.000Z",
                status: "done",
              },
            }),
          ],
        }),
      );

      await store.dispatch(
        markHabitCompletion({
          habitId: "habit-1",
          date: "2026-08-07T00:00:00.000Z",
          status: "done",
        }),
      );

      expect(store.getState().habit.habitsForDate[0].completedCount).toBe(2);
    });
  });

  describe("editing a habit", () => {
    /** The full habit the server answers an edit with. */
    const fullHabit = (overrides: Partial<Habit> = {}): Habit => ({
      _id: "habit-1",
      title: "Read",
      startDate: "2025-01-06T00:00:00.000Z",
      type: "build",
      color: "blue",
      icon: "books",
      currentStreak: 0,
      isCompleted: false,
      duration: 3,
      dailyCompletions: [
        { _id: "d1", dayTitle: "Read", date: "2025-01-06T00:00:00.000Z", status: "done" },
        { _id: "d2", dayTitle: "Read", date: "2025-01-07T00:00:00.000Z", status: "done" },
        { _id: "d3", dayTitle: "Read", date: "2025-01-08T00:00:00.000Z", status: "pending" },
      ],
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      ...overrides,
    });

    it("sends only the fields it was given", async () => {
      fetchMock.mockResolvedValue(ok({ habit: fullHabit() }));

      await makeStore().dispatch(
        updateHabit({ habitId: "habit-1", changes: { title: "Read more" } }),
      );

      expect(urlAt(0)).toContain("/habits/habit-1");
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
      expect(bodyAt(0)).toEqual({ title: "Read more" });
    });

    it("rebuilds the selected day from the schedule the server returned", async () => {
      const store = makeStore(
        habitState({
          habitsForDate: [
            makeHabitSummary({
              dayInfo: { _id: "d2", dayTitle: "Read", date: "2025-01-07T00:00:00.000Z", status: "done" },
            }),
          ],
          habits: [fullHabit()],
        }),
      );
      fetchMock.mockResolvedValue(
        ok({
          habit: fullHabit({
            title: "Read more",
            dailyCompletions: fullHabit().dailyCompletions.map((day) => ({ ...day, dayTitle: "Read more" })),
          }),
        }),
      );

      await store.dispatch(updateHabit({ habitId: "habit-1", changes: { title: "Read more" } }));

      const summary = store.getState().habit.habitsForDate[0];
      expect(summary.title).toBe("Read more");
      expect(summary.dayInfo.dayTitle).toBe("Read more");
      expect(summary.completedCount).toBe(2);
      expect(store.getState().habit.habits[0].title).toBe("Read more");
    });

    it("drops the habit from a day the new length no longer covers", async () => {
      const store = makeStore(
        habitState({
          habitsForDate: [
            makeHabitSummary({
              dayInfo: { _id: "d3", dayTitle: "Read", date: "2025-01-08T00:00:00.000Z", status: "pending" },
            }),
          ],
        }),
      );
      fetchMock.mockResolvedValue(
        ok({ habit: fullHabit({ duration: 2, dailyCompletions: fullHabit().dailyCompletions.slice(0, 2) }) }),
      );

      await store.dispatch(updateHabit({ habitId: "habit-1", changes: { duration: 2 } }));

      expect(store.getState().habit.habitsForDate).toHaveLength(0);
    });

    it("leaves the day view standing when an edit is refused", async () => {
      const store = makeStore(habitState({ habitsForDate: [makeHabitSummary()] }));
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: "Nope" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );

      await store.dispatch(updateHabit({ habitId: "habit-1", changes: { title: "x" } }));

      expect(store.getState().habit.error).toBeNull();
      expect(store.getState().habit.habitsForDate).toHaveLength(1);
    });

    it("renames one day by its day key", async () => {
      fetchMock.mockResolvedValue(ok({ habit: fullHabit() }));

      await makeStore().dispatch(
        renameHabitDay({ habitId: "habit-1", date: "2025-01-07T00:00:00.000Z", dayTitle: "Twenty pages" }),
      );

      expect(urlAt(0)).toContain("/habits/habit-1/day");
      expect(bodyAt(0)).toEqual({ date: "2025-01-07", dayTitle: "Twenty pages" });
    });
  });
});
