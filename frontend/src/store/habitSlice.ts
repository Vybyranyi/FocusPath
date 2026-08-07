import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { Habit, HabitSummary } from "@shared/index";
import type { CreateHabitFormValues } from "@/types/forms";
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

/** The form's shape, translated into what the API expects. */
const toHabitBody = (values: CreateHabitFormValues, allowAutoDuration = false) => ({
  title: values.habitName.trim(),
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
    { habitId, date, completed }: { habitId: string; date: string; completed: boolean },
    { rejectWithValue },
  ) => {
    try {
      const { habit } = await apiRequest<{ habit: Habit }>(
        `/habits/${habitId}/complete`,
        {
          // `date` is the day the server itself named, so it only needs
          // narrowing to a key — never a round trip through a local Date.
          method: "PATCH",
          body: { date: dayKeyOf(date), completed },
        },
      );
      return { habitId, completed, updatedHabit: habit };
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const toggleHabitStep = createAsyncThunk(
  "habit/toggleHabitStep",
  async (
    { habitId, stepId }: { habitId: string; stepId: string },
    { rejectWithValue },
  ) => {
    try {
      const { completed } = await apiRequest<{ stepId: string; completed: boolean }>(
        `/habits/${habitId}/steps/${stepId}`,
        { method: "PATCH" },
      );
      return { habitId, stepId, completed };
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
      const { habitId, completed, updatedHabit } = action.payload;
      const habit = state.habitsForDate.find((h) => h._id === habitId);
      if (habit) {
        const wasCompleted = habit.dayInfo.completed;
        habit.dayInfo.completed = completed;
        habit.currentStreak = updatedHabit.currentStreak;
        habit.isCompleted = updatedHabit.isCompleted;
        // Adjusted locally rather than refetched, since the change is known.
        if (completed && !wasCompleted) habit.completedCount += 1;
        if (!completed && wasCompleted) habit.completedCount = Math.max(0, habit.completedCount - 1);
      }
    });

    builder
      .addCase(toggleHabitStep.pending, (state, action) => {
        // Optimistic update
        const { habitId, stepId } = action.meta.arg;
        const habit = state.habitsForDate.find((h) => h._id === habitId);
        const step = habit?.steps?.find((s) => s._id === stepId);
        if (step) {
          step.completed = !step.completed;
        }
      })
      .addCase(toggleHabitStep.fulfilled, (state, action) => {
        // Confirmation from the server; corrects the guess above if it differed.
        const { habitId, stepId, completed } = action.payload;
        const habit = state.habitsForDate.find((h) => h._id === habitId);
        const step = habit?.steps?.find((s) => s._id === stepId);
        if (step) {
          step.completed = completed;
        }
      })
      .addCase(toggleHabitStep.rejected, (state, action) => {
        // Rollback on failure
        const { habitId, stepId } = action.meta.arg;
        const habit = state.habitsForDate.find((h) => h._id === habitId);
        const step = habit?.steps?.find((s) => s._id === stepId);
        if (step) {
          step.completed = !step.completed;
        }
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
