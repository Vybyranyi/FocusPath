import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { DayStatus, Habit, HabitSummary } from "@shared/index";
import type { CreateHabitFormValues, StepDraft } from "@/types/forms";
import { apiRequest, errorMessage } from "@api/client";
import { dayKeyOf, toDayKey, todayKey } from "@/lib/dates";

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
}

const initialState: IHabitSlice = {
  habits: [],
  habitsForDate: [],
  loading: false,
  creating: null,
  error: null,
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
  duration: allowAutoDuration && !values.duration ? null : Number(values.duration),
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
      return await apiRequest<{ date: string; habits: HabitSummary[] }>(
        `/habits/daily?date=${day}`,
      );
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

export const markHabitCompletion = createAsyncThunk(
  "habit/markHabitCompletion",
  async (
    { habitId, date, status }: { habitId: string; date: string; status: DayStatus },
    { rejectWithValue },
  ) => {
    try {
      const { habit } = await apiRequest<{ habit: Habit }>(
        `/habits/${habitId}/complete`,
        {
          // `date` is the day the server itself named, so it only needs
          // narrowing to a key — never a round trip through a local Date.
          method: "PATCH",
          body: { date: dayKeyOf(date), status },
        },
      );
      return { habitId, date, status, updatedHabit: habit };
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
      return await apiRequest<{ stepId: string; completed: boolean; habit: Habit }>(
        `/habits/${habitId}/steps/${stepId}`,
        { method: "PATCH", body: { date: dayKeyOf(date) } },
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
  duration?: number;
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

/** Rewrites the task of one day. `date` is a day the server named. */
export const renameHabitDay = createAsyncThunk(
  "habit/renameHabitDay",
  async (
    { habitId, date, dayTitle }: { habitId: string; date: string; dayTitle: string },
    { rejectWithValue },
  ) => {
    try {
      return await apiRequest<{ habit: Habit }>(`/habits/${habitId}/day`, {
        method: "PATCH",
        body: { date: dayKeyOf(date), dayTitle },
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
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
 * Folds a habit the server just returned in full back into both lists.
 *
 * The day view holds a narrowed copy, so it is rebuilt from the full schedule
 * rather than patched field by field: an edit can rename the day, move its
 * status or — when the habit is shortened — take the selected day out of the
 * schedule altogether, in which case the habit leaves that day's list.
 */
const applyHabit = (state: IHabitSlice, habit: Habit) => {
  const fullIndex = state.habits.findIndex((h) => h._id === habit._id);
  if (fullIndex !== -1) state.habits[fullIndex] = habit;

  const summaryIndex = state.habitsForDate.findIndex((h) => h._id === habit._id);
  if (summaryIndex === -1) return;

  const summary = state.habitsForDate[summaryIndex];
  const day = habit.dailyCompletions.find(
    (entry) => dayKeyOf(entry.date) === dayKeyOf(summary.dayInfo.date),
  );

  if (!day) {
    state.habitsForDate.splice(summaryIndex, 1);
    return;
  }

  state.habitsForDate[summaryIndex] = {
    _id: habit._id,
    title: habit.title,
    description: habit.description,
    category: habit.category,
    steps: habit.steps,
    startDate: habit.startDate,
    duration: habit.duration,
    type: habit.type,
    color: habit.color,
    icon: habit.icon,
    currentStreak: habit.currentStreak,
    isCompleted: habit.isCompleted,
    fromPlanId: habit.fromPlanId,
    publishedPlanId: habit.publishedPlanId,
    dayInfo: day,
    completedCount: habit.dailyCompletions.filter((entry) => entry.status === "done").length,
  };
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
      .addCase(getHabitsForDate.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(getHabitsForDate.fulfilled, (state, action) => {
        state.loading = false;
        state.habitsForDate = action.payload.habits || [];
      })
      .addCase(getHabitsForDate.rejected, (state, action) => {
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

    builder.addCase(markHabitCompletion.fulfilled, (state, action) => {
      const { habitId, date, status, updatedHabit } = action.payload;

      const habit = state.habitsForDate.find((h) => h._id === habitId);
      if (habit) {
        const wasDone = habit.dayInfo.status === "done";
        const isDone = status === "done";
        habit.dayInfo.status = status;
        habit.currentStreak = updatedHabit.currentStreak;
        habit.isCompleted = updatedHabit.isCompleted;
        // Adjusted locally rather than refetched, since the change is known.
        if (isDone && !wasDone) habit.completedCount += 1;
        if (!isDone && wasDone) habit.completedCount = Math.max(0, habit.completedCount - 1);
      }

      // The stats page reads `habits`, not `habitsForDate`. It used to survive
      // on refetching everything when it mounts, which made it right by luck
      // rather than because the store was consistent.
      const full = state.habits.find((h) => h._id === habitId);
      if (full) {
        const day = full.dailyCompletions.find((entry) => dayKeyOf(entry.date) === dayKeyOf(date));
        if (day) day.status = status;
        full.currentStreak = updatedHabit.currentStreak;
        full.isCompleted = updatedHabit.isCompleted;
      }
    });

    /** Flips a step in the day view's copy of the day it was ticked on. */
    const flipStep = (state: IHabitSlice, arg: { habitId: string; stepId: string; date: string }) => {
      const habit = state.habitsForDate.find(
        (h) => h._id === arg.habitId && dayKeyOf(h.dayInfo.date) === dayKeyOf(arg.date),
      );
      if (!habit) return;
      const ticked = habit.dayInfo.completedSteps;
      habit.dayInfo.completedSteps = ticked.includes(arg.stepId)
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
