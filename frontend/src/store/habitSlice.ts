import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  DayStatus,
  Frequency,
  Habit,
  HabitDay,
  HabitSummary,
  JournalEntry,
  Target,
  TimeOfDay,
} from "@shared/index";
import type { CreateHabitFormValues, StepDraft } from "@/types/forms";
import { apiRequest, errorMessage } from "@api/client";
import { dayKeyOf, toDayKey, todayKey } from "@/lib/dates";
import { publishPlan, unpublishPlan } from "@store/plansSlice";
import { draftFrequency, draftTarget } from "@/lib/schedule";

export interface IHabitSlice {
  /** Every habit, as `GET /habits` returns them. */
  habits: Habit[];
  /** Habits active on the selected day, narrowed to that day's entry. */
  habitsForDate: HabitSummary[];
  /** In flight for a list fetch. */
  loading: boolean;
  /**
   * Which kind of creation is running, if any. One flag for both buttons used
   * to disable and re-label the wrong one.
   */
  creating: "manual" | "ai" | null;
  error: string | null;
  /**
   * The day request whose answer the day view is waiting for. Stepping
   * through the week fires one request per tap, and an earlier one that
   * answered last used to replace the day actually on screen.
   */
  dayRequestId: string | null;
}

const initialState: IHabitSlice = {
  habits: [],
  habitsForDate: [],
  loading: false,
  creating: null,
  error: null,
  dayRequestId: null,
};

/** Blank rows are what an "add step" button leaves behind; they are not steps. */
const toStepsBody = (steps: StepDraft[]) => {
  const titled = steps.map((step) => step.title.trim()).filter(Boolean);
  return titled.length > 0 ? titled.map((title) => ({ title })) : undefined;
};

/** The form's shape, translated into what the API expects. */
const toHabitBody = (values: CreateHabitFormValues, allowAutoDuration = false) => ({
  title: values.habitName.trim(),
  description: values.habitDescription.trim() || undefined,
  category: values.category || undefined,
  steps: toStepsBody(values.steps),
  // The picker hands back local midnight. As a full instant that arrives as the
  // previous day east of Greenwich, which either shifted the whole schedule or
  // got the habit refused for starting "in the past".
  startDate: values.startDate ? toDayKey(values.startDate) : todayKey(),
  // Absent means "no end" on the manual route and "let the model choose" on the
  // AI one, so the two are told apart by `null`, which only the AI route reads.
  sessions: values.noEnd
    ? undefined
    : allowAutoDuration && values.autoDuration
      ? null
      : Number(values.duration),
  frequency: draftFrequency(values.schedule),
  target: draftTarget(values.schedule),
  timeOfDay: values.schedule.timeOfDay,
  type: values.habitType,
  color: values.color,
  icon: values.emoji,
});

export const createHabit = createAsyncThunk(
  "habit/createHabit",
  async (values: CreateHabitFormValues, { rejectWithValue }) => {
    try {
      return await apiRequest<{ habit: Habit }>("/habits/", {
        method: "POST",
        body: toHabitBody(values),
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const createAIHabit = createAsyncThunk(
  "habit/createAIHabit",
  async (values: CreateHabitFormValues, { rejectWithValue }) => {
    try {
      return await apiRequest<{ habit: Habit }>("/habits/ai", {
        method: "POST",
        body: toHabitBody(values, true),
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** Takes a day key (`YYYY-MM-DD`); callers own the conversion from a Date. */
export const getHabitsForDate = createAsyncThunk(
  "habit/getHabitsForDate",
  async (day: string, { rejectWithValue }) => {
    try {
      // The client's own today travels with the request: the server reads days
      // in UTC, and without this a user west of Greenwich is told the day they
      // are still living has been missed.
      return await apiRequest<{
        date: string;
        habits: HabitSummary[];
        /** The day's own journal entry, so the day view needs no second request. */
        journal?: JournalEntry | null;
      }>(`/habits/daily?date=${day}&today=${todayKey()}`);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const getAllHabits = createAsyncThunk(
  "habit/getAllHabits",
  async (_, { rejectWithValue }) => {
    try {
      return await apiRequest<{ habits: Habit[] }>("/habits/");
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** What the mark endpoints answer: the habit, and the day that was just changed. */
interface MarkResponse {
  habit: Habit;
  day: HabitDay;
}

export const markHabitCompletion = createAsyncThunk(
  "habit/markHabitCompletion",
  async (
    { habitId, date, status }: { habitId: string; date: string; status: DayStatus },
    { rejectWithValue },
  ) => {
    try {
      const { habit, day } = await apiRequest<MarkResponse>(
        `/habits/${habitId}/complete`,
        {
          // `date` is the day the server itself named, so it only needs
          // narrowing to a key — never a round trip through a local Date.
          method: "PATCH",
          body: { date: dayKeyOf(date), status, today: todayKey() },
        },
      );
      return { habitId, habit, day };
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** Sets the quantity counted on one day of a habit that has a target. */
export const setHabitValue = createAsyncThunk(
  "habit/setHabitValue",
  async (
    { habitId, date, value }: { habitId: string; date: string; value: number },
    { rejectWithValue },
  ) => {
    try {
      const { habit, day } = await apiRequest<MarkResponse>(`/habits/${habitId}/value`, {
        method: "PATCH",
        body: { date: dayKeyOf(date), value, today: todayKey() },
      });
      return { habitId, habit, day };
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** Ticks or unticks a step on one day. `date` is a day the server named. */
export const toggleHabitStep = createAsyncThunk(
  "habit/toggleHabitStep",
  async (
    { habitId, stepId, date }: { habitId: string; stepId: string; date: string },
    { rejectWithValue },
  ) => {
    try {
      return await apiRequest<{ stepId: string; completed: boolean } & MarkResponse>(
        `/habits/${habitId}/steps/${stepId}`,
        { method: "PATCH", body: { date: dayKeyOf(date), today: todayKey() } },
      );
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** The fields the edit sheet may change. Rescheduling is the server's job. */
export interface HabitChanges {
  title?: string;
  description?: string;
  category?: string;
  color?: string;
  icon?: string;
  /** Length of a programme, in sessions. */
  sessions?: number;
  /** A new frequency or target starts a rule today; the past keeps the one it ran under. */
  frequency?: Frequency;
  /** `null` takes the target away. */
  target?: Target | null;
  timeOfDay?: TimeOfDay;
  steps?: StepDraft[];
}

export const updateHabit = createAsyncThunk(
  "habit/updateHabit",
  async (
    { habitId, changes }: { habitId: string; changes: HabitChanges },
    { rejectWithValue },
  ) => {
    try {
      return await apiRequest<{ habit: Habit }>(`/habits/${habitId}`, {
        method: "PUT",
        body: changes,
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** Rewrites the task of one session of a programme. */
export const renameHabitDay = createAsyncThunk(
  "habit/renameHabitDay",
  async (
    { habitId, session, title }: { habitId: string; session: number; title: string },
    { rejectWithValue },
  ) => {
    try {
      return await apiRequest<{ habit: Habit }>(`/habits/${habitId}/day`, {
        method: "PATCH",
        body: { session, title },
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/**
 * Fetches a day again without putting the list into its loading state. After a
 * pause or a rest day the day on screen changes what it says, and a skeleton
 * flashing in over it for a change the user just asked for reads as a crash.
 */
export const refreshDay = createAsyncThunk(
  "habit/refreshDay",
  async (day: string, { rejectWithValue }) => {
    try {
      return await apiRequest<{ date: string; habits: HabitSummary[] }>(
        `/habits/daily?date=${day}&today=${todayKey()}`,
      );
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/**
 * Pauses and rest days change which days a habit is asked on, and with them
 * what the day on screen says. Each answers with the habit; the view is
 * refreshed from the server rather than patched here, because the server alone
 * knows what a paused day, a pushed-out end or a held streak looks like.
 */
const scheduleChange = <Arg extends { habitId: string; day: string }>(
  type: string,
  request: (arg: Arg) => { path: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown },
) =>
  createAsyncThunk(type, async (arg: Arg, { dispatch, rejectWithValue }) => {
    try {
      const { path, method, body } = request(arg);
      const { habit } = await apiRequest<{ habit: Habit }>(path, { method, body });
      await dispatch(refreshDay(arg.day));
      return { habit };
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  });

/** Starts a pause. `from`/`to` are day keys; without `to` it is open. */
export const addPause = scheduleChange(
  "habit/addPause",
  ({ habitId, from, to }: { habitId: string; day: string; from: string; to?: string }) => ({
    path: `/habits/${habitId}/pauses`,
    method: "POST",
    body: { from, to },
  }),
);

/** Ends a pause; resuming is `to` = yesterday. */
export const endPause = scheduleChange(
  "habit/endPause",
  ({ habitId, pauseId, to }: { habitId: string; day: string; pauseId: string; to: string }) => ({
    path: `/habits/${habitId}/pauses/${pauseId}`,
    method: "PATCH",
    body: { to },
  }),
);

export const removePause = scheduleChange(
  "habit/removePause",
  ({ habitId, pauseId }: { habitId: string; day: string; pauseId: string }) => ({
    path: `/habits/${habitId}/pauses/${pauseId}`,
    method: "DELETE",
  }),
);

export const addRestDay = scheduleChange(
  "habit/addRestDay",
  ({ habitId, date }: { habitId: string; day: string; date: string }) => ({
    path: `/habits/${habitId}/rest-days`,
    method: "POST",
    body: { date },
  }),
);

export const removeRestDay = scheduleChange(
  "habit/removeRestDay",
  ({ habitId, date }: { habitId: string; day: string; date: string }) => ({
    path: `/habits/${habitId}/rest-days/${date}`,
    method: "DELETE",
  }),
);

export const deleteHabit = createAsyncThunk(
  "habit/deleteHabit",
  async (habitId: string, { rejectWithValue }) => {
    try {
      await apiRequest<{ habitId: string }>(`/habits/${habitId}`, {
        method: "DELETE",
      });
      return habitId;
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/**
 * Folds a habit the server just returned back into both lists.
 *
 * The day view's copy is the same habit with one day attached, so the habit's
 * own fields are replaced and the day it is showing is kept — an edit changes
 * what a habit *is*, and the day only changes when something marks it.
 */
const applyHabit = (state: IHabitSlice, habit: Habit) => {
  const fullIndex = state.habits.findIndex((h) => h._id === habit._id);
  if (fullIndex !== -1) state.habits[fullIndex] = habit;

  const summaryIndex = state.habitsForDate.findIndex((h) => h._id === habit._id);
  if (summaryIndex === -1) return;

  state.habitsForDate[summaryIndex] = {
    ...habit,
    day: state.habitsForDate[summaryIndex].day,
  };
};

/** Puts a freshly computed day onto the day view's copy of the habit, if it is showing that day. */
const applyDay = (state: IHabitSlice, habitId: string, day: HabitDay) => {
  const summary = state.habitsForDate.find(
    (h) => h._id === habitId && dayKeyOf(h.day.date) === dayKeyOf(day.date),
  );
  if (summary) summary.day = day;
};

const habitSlice = createSlice({
  name: "habit",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(createHabit.pending, (state) => {
        state.creating = "manual";
        state.error = null;
      })
      .addCase(createHabit.fulfilled, (state, action) => {
        state.creating = null;
        state.habits.push(action.payload.habit);
      })
      .addCase(createHabit.rejected, (state, action) => {
        state.creating = null;
        state.error = action.payload as string;
      });

    builder
      .addCase(createAIHabit.pending, (state) => {
        state.creating = "ai";
        state.error = null;
      })
      .addCase(createAIHabit.fulfilled, (state, action) => {
        state.creating = null;
        state.habits.push(action.payload.habit);
      })
      .addCase(createAIHabit.rejected, (state, action) => {
        state.creating = null;
        state.error = action.payload as string;
      });

    builder
      .addCase(getHabitsForDate.pending, (state, action) => {
        state.loading = true;
        state.error = null;
        state.dayRequestId = action.meta.requestId;
      })
      .addCase(getHabitsForDate.fulfilled, (state, action) => {
        if (action.meta.requestId !== state.dayRequestId) return;
        state.loading = false;
        state.habitsForDate = action.payload.habits || [];
      })
      .addCase(getHabitsForDate.rejected, (state, action) => {
        if (action.meta.requestId !== state.dayRequestId) return;
        state.loading = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(getAllHabits.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getAllHabits.fulfilled, (state, action) => {
        state.loading = false;
        state.habits = action.payload.habits || [];
      })
      .addCase(getAllHabits.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });

    // The server's answer is the whole truth about the day it changed — its
    // state, its week, its streak — so it replaces the copy wholesale. A local
    // guess at "done" cannot know that a habit counted by quantity, or one whose
    // week was just met, comes out differently.
    const applyMark = (
      state: IHabitSlice,
      payload: { habitId: string; habit: Habit; day: HabitDay },
    ) => {
      applyHabit(state, payload.habit);
      applyDay(state, payload.habitId, payload.day);
    };

    builder
      .addCase(markHabitCompletion.fulfilled, (state, action) => applyMark(state, action.payload))
      .addCase(setHabitValue.fulfilled, (state, action) => applyMark(state, action.payload));

    /** Flips a step in the day view's copy of the day it was ticked on. */
    const flipStep = (state: IHabitSlice, arg: { habitId: string; stepId: string; date: string }) => {
      const habit = state.habitsForDate.find(
        (h) => h._id === arg.habitId && dayKeyOf(h.day.date) === dayKeyOf(arg.date),
      );
      if (!habit) return;
      const ticked = habit.day.completedSteps;
      habit.day.completedSteps = ticked.includes(arg.stepId)
        ? ticked.filter((id) => id !== arg.stepId)
        : [...ticked, arg.stepId];
    };

    builder
      // Optimistic: a checklist that waits on the network before it ticks feels broken.
      .addCase(toggleHabitStep.pending, (state, action) => {
        flipStep(state, action.meta.arg);
      })
      // The server's answer replaces the guess wholesale — ticking the last
      // step can also finish the day, which the guess knows nothing about.
      .addCase(toggleHabitStep.fulfilled, (state, action) => {
        applyHabit(state, action.payload.habit);
        applyDay(state, action.payload.habit._id, action.payload.day);
      })
      .addCase(toggleHabitStep.rejected, (state, action) => {
        flipStep(state, action.meta.arg);
      });

    // Failures are left to the sheet that asked, which shows them beside the
    // form. The slice-wide `error` is what the day view renders *instead of*
    // the list, so a rejected rename would have blanked every habit on screen.
    builder
      .addCase(updateHabit.fulfilled, (state, action) => {
        applyHabit(state, action.payload.habit);
      })
      .addCase(renameHabitDay.fulfilled, (state, action) => {
        applyHabit(state, action.payload.habit);
      });

    // Habit-level fields only: the day itself comes back through `refreshDay`.
    for (const thunk of [addPause, endPause, removePause, addRestDay, removeRestDay]) {
      builder.addCase(thunk.fulfilled, (state, action) => {
        applyHabit(state, action.payload.habit);
      });
    }

    builder.addCase(refreshDay.fulfilled, (state, action) => {
      // Only if the screen is still on the day that was asked for.
      const showing = state.habitsForDate[0];
      if (showing && dayKeyOf(showing.day.date) !== dayKeyOf(action.payload.date)) return;
      state.habitsForDate = action.payload.habits || [];
    });

    // A published habit is published from here on. The sheet reads this to
    // offer the plan instead of a second publish the server would refuse.
    builder.addCase(publishPlan.fulfilled, (state, action) => {
      const { habitId } = action.meta.arg;
      const planId = action.payload.plan._id;
      state.habitsForDate
        .filter((h) => h._id === habitId)
        .forEach((h) => { h.publishedPlanId = planId; });
      state.habits
        .filter((h) => h._id === habitId)
        .forEach((h) => { h.publishedPlanId = planId; });
    });

    // Withdrawn, the habit may be published again, as the server now allows.
    builder.addCase(unpublishPlan.fulfilled, (state, action) => {
      const planId = action.payload;
      [...state.habitsForDate, ...state.habits]
        .filter((h) => h.publishedPlanId === planId)
        .forEach((h) => { delete h.publishedPlanId; });
    });

    builder
      .addCase(deleteHabit.pending, (state) => {
        state.loading = true;
      })
      .addCase(deleteHabit.fulfilled, (state, action) => {
        state.loading = false;
        state.habits = state.habits.filter((h) => h._id !== action.payload);
        state.habitsForDate = state.habitsForDate.filter((h) => h._id !== action.payload);
      })
      .addCase(deleteHabit.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      });
  },
});

export default habitSlice.reducer;
