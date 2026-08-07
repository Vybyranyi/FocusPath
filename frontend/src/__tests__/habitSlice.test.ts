import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHabit,
  getHabitsForDate,
  markHabitCompletion,
} from "@store/habitSlice";
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
});
