import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPause,
  addRestDay,
  createAIHabit,
  createHabit,
  endPause,
  getHabitsForDate,
  markHabitCompletion,
  removePause,
  removeRestDay,
  renameHabitDay,
  setHabitValue,
  toggleHabitStep,
  updateHabit,
} from "@store/habitSlice";
import type { Habit, HabitDay } from "@shared/index";
import { publishPlan, unpublishPlan } from "@store/plansSlice";
import { makeStore } from "@store/store";
import { DEFAULT_SCHEDULE } from "@/lib/schedule";
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
  steps: [],
  // Local midnight, which is what the date pickers hand back.
  startDate: new Date(2026, 7, 7),
  autoDuration: false,
  duration: "7",
  noEnd: false,
  schedule: DEFAULT_SCHEDULE,
  habitType: "build",
  ...overrides,
});

/** The full habit the server answers with, in the shape habit model 2.0 returns. */
const fullHabit = (overrides: Partial<Habit> = {}): Habit => ({
  _id: "habit-1",
  title: "Read",
  startDate: "2025-01-06T00:00:00.000Z",
  type: "build",
  color: "blue",
  icon: "books",
  timeOfDay: "anytime",
  rules: [{ effectiveFrom: "2025-01-06T00:00:00.000Z", frequency: { kind: "daily" } }],
  frequency: { kind: "daily" },
  sessions: 3,
  pauses: [],
  restDays: [],
  currentStreak: 0,
  streakUnit: "day",
  isCompleted: false,
  progress: { done: 2, decided: 2, percentage: 100, sessionsTotal: 3 },
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

const dayOf = (overrides: Partial<HabitDay> = {}): HabitDay => ({
  date: "2025-01-07T00:00:00.000Z",
  state: "done",
  completedSteps: [],
  session: { index: 2, total: 3, title: "Read" },
  ...overrides,
});

describe("habitSlice", () => {
  describe("the day a request names", () => {
    it("asks for the day it was given, unaltered", async () => {
      fetchMock.mockResolvedValue(ok({ date: "", habits: [] }));

      await makeStore().dispatch(getHabitsForDate("2026-08-07"));

      expect(urlAt(0)).toContain("date=2026-08-07");
    });

    /** The server reads days in UTC; the client says which day it is actually on. */
    it("tells the server which day the client is on", async () => {
      fetchMock.mockResolvedValue(ok({ date: "", habits: [] }));

      await makeStore().dispatch(getHabitsForDate("2026-08-07"));

      expect(urlAt(0)).toMatch(/today=\d{4}-\d{2}-\d{2}/);
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
      fetchMock.mockResolvedValue(ok({ habit: fullHabit(), day: dayOf() }));

      await makeStore().dispatch(
        markHabitCompletion({
          habitId: "habit-1",
          date: "2026-08-07T00:00:00.000Z",
          status: "done",
        }),
      );

      expect(bodyAt(0).date).toBe("2026-08-07");
      expect(bodyAt(0).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("marking a day", () => {
    /**
     * The server is the one that knows what a mark did: whether the day is done,
     * whether a week was just met, what the streak is. Its answer replaces the
     * copy instead of the client guessing at "done".
     */
    it("takes the day and the progress from the server's answer", async () => {
      fetchMock.mockResolvedValue(
        ok({
          habit: fullHabit({ currentStreak: 3, progress: { done: 3, decided: 3, percentage: 100, sessionsTotal: 7 } }),
          day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "done" }),
        }),
      );

      const store = makeStore(
        habitState({
          habitsForDate: [
            makeHabitSummary({ day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "pending" }) }),
          ],
        }),
      );

      await store.dispatch(
        markHabitCompletion({ habitId: "habit-1", date: "2026-08-07T00:00:00.000Z", status: "done" }),
      );

      const [habit] = store.getState().habit.habitsForDate;
      expect(habit.day.state).toBe("done");
      expect(habit.progress.done).toBe(3);
      expect(habit.currentStreak).toBe(3);
    });

    it("keeps the day on screen when the answer is about another day", async () => {
      fetchMock.mockResolvedValue(
        ok({ habit: fullHabit(), day: dayOf({ date: "2026-08-09T00:00:00.000Z", state: "done" }) }),
      );
      const store = makeStore(
        habitState({
          habitsForDate: [
            makeHabitSummary({ day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "pending" }) }),
          ],
        }),
      );

      await store.dispatch(
        markHabitCompletion({ habitId: "habit-1", date: "2026-08-09T00:00:00.000Z", status: "done" }),
      );

      expect(store.getState().habit.habitsForDate[0].day.state).toBe("pending");
    });

    it("updates the stats page's copy of the habit too", async () => {
      fetchMock.mockResolvedValue(
        ok({ habit: fullHabit({ currentStreak: 4 }), day: dayOf({ date: "2026-08-07T00:00:00.000Z" }) }),
      );
      const store = makeStore(habitState({ habits: [fullHabit({ currentStreak: 0 })] }));

      await store.dispatch(
        markHabitCompletion({ habitId: "habit-1", date: "2026-08-07T00:00:00.000Z", status: "done" }),
      );

      expect(store.getState().habit.habits[0].currentStreak).toBe(4);
    });

    it("sets a counted day through its own endpoint", async () => {
      fetchMock.mockResolvedValue(
        ok({ habit: fullHabit(), day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "pending", value: 5 }) }),
      );
      const store = makeStore(
        habitState({ habitsForDate: [makeHabitSummary({ day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "pending" }) })] }),
      );

      await store.dispatch(setHabitValue({ habitId: "habit-1", date: "2026-08-07T00:00:00.000Z", value: 5 }));

      expect(urlAt(0)).toContain("/habits/habit-1/value");
      expect(bodyAt(0)).toMatchObject({ date: "2026-08-07", value: 5 });
      expect(store.getState().habit.habitsForDate[0].day.value).toBe(5);
    });
  });

  describe("editing a habit", () => {
    it("sends only the fields it was given", async () => {
      fetchMock.mockResolvedValue(ok({ habit: fullHabit() }));

      await makeStore().dispatch(
        updateHabit({ habitId: "habit-1", changes: { title: "Read more" } }),
      );

      expect(urlAt(0)).toContain("/habits/habit-1");
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT");
      expect(bodyAt(0)).toEqual({ title: "Read more" });
    });

    it("sends a new rhythm, a goal, or the removal of one", async () => {
      fetchMock.mockResolvedValue(ok({ habit: fullHabit() }));

      await makeStore().dispatch(
        updateHabit({
          habitId: "habit-1",
          changes: { frequency: { kind: "weekly", times: 3 }, target: null, timeOfDay: "evening", sessions: 20 },
        }),
      );

      expect(bodyAt(0)).toEqual({
        frequency: { kind: "weekly", times: 3 },
        target: null,
        timeOfDay: "evening",
        sessions: 20,
      });
    });

    it("keeps the day on screen and replaces the habit around it", async () => {
      const store = makeStore(
        habitState({
          habitsForDate: [makeHabitSummary({ day: dayOf({ state: "done" }) })],
          habits: [fullHabit()],
        }),
      );
      fetchMock.mockResolvedValue(ok({ habit: fullHabit({ title: "Read more", currentStreak: 2 }) }));

      await store.dispatch(updateHabit({ habitId: "habit-1", changes: { title: "Read more" } }));

      const summary = store.getState().habit.habitsForDate[0];
      expect(summary.title).toBe("Read more");
      expect(summary.currentStreak).toBe(2);
      expect(summary.day.state).toBe("done");
      expect(store.getState().habit.habits[0].title).toBe("Read more");
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

    it("renames one session of the programme by its number", async () => {
      fetchMock.mockResolvedValue(ok({ habit: fullHabit() }));

      await makeStore().dispatch(
        renameHabitDay({ habitId: "habit-1", session: 2, title: "Twenty pages" }),
      );

      expect(urlAt(0)).toContain("/habits/habit-1/day");
      expect(bodyAt(0)).toEqual({ session: 2, title: "Twenty pages" });
    });
  });

  describe("pauses and rest days", () => {
    const dayAnswer = (habits: unknown[]) => ok({ date: "2026-08-07T00:00:00.000Z", habits });

    /** The first call is the change; the second is the quiet refresh of the day. */
    const answerChangeThenDay = (habit: Habit, habits: unknown[] = []) => {
      fetchMock.mockResolvedValueOnce(ok({ habit })).mockResolvedValueOnce(dayAnswer(habits));
    };

    it("starts a pause with day keys, then fetches the day again", async () => {
      answerChangeThenDay(fullHabit());

      await makeStore().dispatch(
        addPause({ habitId: "habit-1", day: "2026-08-07", from: "2026-08-08", to: "2026-08-10" }),
      );

      expect(urlAt(0)).toContain("/habits/habit-1/pauses");
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
      expect(bodyAt(0)).toEqual({ from: "2026-08-08", to: "2026-08-10" });
      expect(urlAt(1)).toContain("/habits/daily?date=2026-08-07");
    });

    it("ends a pause on the day given", async () => {
      answerChangeThenDay(fullHabit());

      await makeStore().dispatch(endPause({ habitId: "habit-1", day: "2026-08-07", pauseId: "p1", to: "2026-08-06" }));

      expect(urlAt(0)).toContain("/habits/habit-1/pauses/p1");
      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
      expect(bodyAt(0)).toEqual({ to: "2026-08-06" });
    });

    it("removes a pause that has not begun", async () => {
      answerChangeThenDay(fullHabit());

      await makeStore().dispatch(removePause({ habitId: "habit-1", day: "2026-08-07", pauseId: "p1" }));

      expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    });

    it("sets and takes back a rest day by its day key", async () => {
      answerChangeThenDay(fullHabit());
      answerChangeThenDay(fullHabit());
      const store = makeStore();

      await store.dispatch(addRestDay({ habitId: "habit-1", day: "2026-08-07", date: "2026-08-07" }));
      await store.dispatch(removeRestDay({ habitId: "habit-1", day: "2026-08-07", date: "2026-08-07" }));

      expect(urlAt(0)).toContain("/habits/habit-1/rest-days");
      expect(bodyAt(0)).toEqual({ date: "2026-08-07" });
      expect(urlAt(2)).toContain("/habits/habit-1/rest-days/2026-08-07");
    });

    it("shows the day as the server now describes it, without a loading flash", async () => {
      const store = makeStore(
        habitState({ habitsForDate: [makeHabitSummary({ day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "pending" }) })] }),
      );
      answerChangeThenDay(
        fullHabit(),
        [makeHabitSummary({ day: dayOf({ date: "2026-08-07T00:00:00.000Z", state: "paused" }) })],
      );

      const pending = store.dispatch(
        addPause({ habitId: "habit-1", day: "2026-08-07", from: "2026-08-07" }),
      );
      expect(store.getState().habit.loading).toBe(false);
      await pending;

      expect(store.getState().habit.habitsForDate[0].day.state).toBe("paused");
      expect(store.getState().habit.loading).toBe(false);
    });

    it("does not overwrite another day the user has moved to meanwhile", async () => {
      const store = makeStore(
        habitState({ habitsForDate: [makeHabitSummary({ day: dayOf({ date: "2026-08-09T00:00:00.000Z" }) })] }),
      );
      answerChangeThenDay(fullHabit(), [makeHabitSummary({ _id: "stale" })]);

      await store.dispatch(addPause({ habitId: "habit-1", day: "2026-08-07", from: "2026-08-08" }));

      expect(store.getState().habit.habitsForDate.map((h) => h._id)).toEqual(["habit-1"]);
    });

    it("hands the reason back when the server refuses", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "A pause cannot begin in the past" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await makeStore().dispatch(
        addPause({ habitId: "habit-1", day: "2026-08-07", from: "2026-08-01" }),
      );

      expect(result.payload).toBe("A pause cannot begin in the past");
    });
  });

  describe("the schedule a new habit is sent with", () => {
    it("sends a daily rhythm with no goal by default", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createHabit(formValues()));

      expect(bodyAt(0)).toMatchObject({ frequency: { kind: "daily" }, timeOfDay: "anytime", sessions: 7 });
      expect(bodyAt(0)).not.toHaveProperty("target");
    });

    it("sends the days a weekdays habit was given, in order", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(
        createHabit(formValues({ schedule: { ...DEFAULT_SCHEDULE, frequencyKind: "weekdays", weekdays: [5, 1, 3] } })),
      );

      expect(bodyAt(0).frequency).toEqual({ kind: "weekdays", days: [1, 3, 5] });
    });

    it("sends a weekly rhythm as a number", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(
        createHabit(formValues({ schedule: { ...DEFAULT_SCHEDULE, frequencyKind: "weekly", timesPerWeek: "4" } })),
      );

      expect(bodyAt(0).frequency).toEqual({ kind: "weekly", times: 4 });
    });

    it("sends the goal and the part of the day", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(
        createHabit(
          formValues({
            schedule: { ...DEFAULT_SCHEDULE, counted: true, targetValue: "8", targetUnit: " glasses ", timeOfDay: "morning" },
          }),
        ),
      );

      expect(bodyAt(0)).toMatchObject({ target: { value: 8, unit: "glasses" }, timeOfDay: "morning" });
    });

    it("sends no number of sessions for a habit with no end", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createHabit(formValues({ noEnd: true, duration: "" })));

      expect(bodyAt(0)).not.toHaveProperty("sessions");
    });
  });

  describe("the number of sessions an AI habit asks for", () => {
    it("lets the AI choose when the switch says so", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createAIHabit(formValues({ autoDuration: true, duration: "" })));

      expect(bodyAt(0).sessions).toBeNull();
    });

    it("asks for the sessions the user typed when it does not", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createAIHabit(formValues({ autoDuration: false, duration: "30" })));

      expect(bodyAt(0).sessions).toBe(30);
    });
  });

  describe("the daily checklist", () => {
    it("sends blank-free steps with a new habit", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(
        createHabit(formValues({ steps: [{ title: " Stretch " }, { title: "  " }, { title: "Water" }] })),
      );

      expect(bodyAt(0).steps).toEqual([{ title: "Stretch" }, { title: "Water" }]);
    });

    it("sends no steps at all when every row is blank", async () => {
      fetchMock.mockResolvedValue(ok({ habit: {} }));

      await makeStore().dispatch(createHabit(formValues({ steps: [{ title: "" }] })));

      expect(bodyAt(0)).not.toHaveProperty("steps");
    });

    it("ticks a step on the day it names", async () => {
      fetchMock.mockResolvedValue(ok({ stepId: "s1", completed: true, habit: fullHabit(), day: dayOf() }));

      await makeStore().dispatch(
        toggleHabitStep({ habitId: "habit-1", stepId: "s1", date: "2025-01-07T00:00:00.000Z" }),
      );

      expect(urlAt(0)).toContain("/habits/habit-1/steps/s1");
      expect(bodyAt(0)).toMatchObject({ date: "2025-01-07" });
    });

    it("ticks straight away and takes it back if the server refuses", async () => {
      const store = makeStore(
        habitState({ habitsForDate: [makeHabitSummary({ steps: [{ _id: "s1", title: "Stretch" }] })] }),
      );
      let refuse: (value: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => { refuse = resolve; }));

      const pending = store.dispatch(
        toggleHabitStep({ habitId: "habit-1", stepId: "s1", date: "2025-01-06T00:00:00.000Z" }),
      );
      expect(store.getState().habit.habitsForDate[0].day.completedSteps).toEqual(["s1"]);

      refuse(
        new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Step not found" } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await pending;

      expect(store.getState().habit.habitsForDate[0].day.completedSteps).toEqual([]);
    });

    /** Ticking the last step can finish the day, which only the server knows. */
    it("takes the day's state from the server's answer", async () => {
      const store = makeStore(
        habitState({
          habitsForDate: [
            makeHabitSummary({
              steps: [{ _id: "s1", title: "Stretch" }],
              day: dayOf({ date: "2025-01-06T00:00:00.000Z", state: "pending" }),
            }),
          ],
        }),
      );
      fetchMock.mockResolvedValue(
        ok({
          stepId: "s1",
          completed: true,
          habit: fullHabit({ currentStreak: 1, steps: [{ _id: "s1", title: "Stretch" }] }),
          day: dayOf({ date: "2025-01-06T00:00:00.000Z", state: "done", completedSteps: ["s1"] }),
        }),
      );

      await store.dispatch(
        toggleHabitStep({ habitId: "habit-1", stepId: "s1", date: "2025-01-06T00:00:00.000Z" }),
      );

      const summary = store.getState().habit.habitsForDate[0];
      expect(summary.day.state).toBe("done");
      expect(summary.currentStreak).toBe(1);
    });
  });

  it("remembers that a habit has been published", async () => {
    const store = makeStore(habitState({ habitsForDate: [makeHabitSummary()] }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { plan: { _id: "plan-9" } } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));

    await store.dispatch(publishPlan({ habitId: "habit-1", category: "learning" }));

    expect(store.getState().habit.habitsForDate[0].publishedPlanId).toBe("plan-9");
  });

  it("frees a habit to be published again once its plan is withdrawn", async () => {
    const store = makeStore(habitState({ habitsForDate: [makeHabitSummary({ publishedPlanId: "plan-9" })] }));
    fetchMock.mockResolvedValue(ok({ plan: { _id: "plan-9" } }));

    await store.dispatch(unpublishPlan("plan-9"));

    expect(store.getState().habit.habitsForDate[0].publishedPlanId).toBeUndefined();
  });

  /**
   * Tapping through the week fires one request per day. When an earlier one
   * answered last, its habits replaced the day actually on screen.
   */
  it("shows the day asked for last, whatever order the answers arrive in", async () => {
    const store = makeStore();
    const answers: Array<(value: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answers.push(resolve); }));

    const monday = store.dispatch(getHabitsForDate("2026-09-28"));
    const tuesday = store.dispatch(getHabitsForDate("2026-09-29"));

    answers[1](ok({ date: "2026-09-29", habits: [makeHabitSummary({ _id: "tuesday" })] }));
    await tuesday;
    answers[0](ok({ date: "2026-09-28", habits: [makeHabitSummary({ _id: "monday" })] }));
    await monday;

    expect(store.getState().habit.habitsForDate.map((h) => h._id)).toEqual(["tuesday"]);
    expect(store.getState().habit.loading).toBe(false);
  });
});
