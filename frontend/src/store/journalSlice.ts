import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { JournalEntry } from "@shared/index";
import { apiRequest, errorMessage } from "@api/client";
import { dayKeyOf } from "@/lib/dates";
import { getHabitsForDate } from "@store/habitSlice";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface IJournalSlice {
  /** The entry of the day on screen, or `null` when there is none. */
  entry: JournalEntry | null;
  /**
   * Which day `entry` is the answer for. The day view changes day before the
   * answer for the new one arrives, and an entry shown against the wrong day
   * could be edited and saved onto it.
   */
  entryDay: string | null;
  /** Entries for the history, newest first. */
  history: JournalEntry[];
  historyLoading: boolean;
  historyError: string | null;
  save: SaveState;
  saveError: string | null;
}

const initialState: IJournalSlice = {
  entry: null,
  entryDay: null,
  history: [],
  historyLoading: false,
  historyError: null,
  save: "idle",
  saveError: null,
};

export interface JournalDraft {
  mood?: number;
  energy?: number;
  text?: string;
}

/**
 * Saves the whole entry of a day. The server replaces rather than merges, so
 * what is not sent is removed: an entry the person has emptied is deleted there.
 */
export const saveJournalEntry = createAsyncThunk(
  "journal/save",
  async ({ day, ...draft }: JournalDraft & { day: string }, { rejectWithValue }) => {
    try {
      const { entry } = await apiRequest<{ entry: JournalEntry | null }>(`/journal/${day}`, {
        method: "PUT",
        body: draft,
      });
      return { day, entry };
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** Entries between two day keys, for the history. */
export const fetchJournalHistory = createAsyncThunk(
  "journal/history",
  async ({ from, to }: { from: string; to: string }, { rejectWithValue }) => {
    try {
      return await apiRequest<{ entries: JournalEntry[] }>(`/journal?from=${from}&to=${to}`);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

const journalSlice = createSlice({
  name: "journal",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // The day view carries the day's entry with it, so showing a day costs no
    // second request.
    builder.addCase(getHabitsForDate.fulfilled, (state, action) => {
      const key = dayKeyOf(action.payload.date);
      state.entry = action.payload.journal ?? null;
      state.entryDay = key;
      state.save = "idle";
    });

    builder
      .addCase(saveJournalEntry.pending, (state) => {
        state.save = "saving";
        state.saveError = null;
      })
      .addCase(saveJournalEntry.fulfilled, (state, action) => {
        state.save = "saved";
        if (state.entryDay === action.payload.day) state.entry = action.payload.entry;

        // Keeps the history in step without a refetch.
        const { day, entry } = action.payload;
        const rest = state.history.filter((item) => dayKeyOf(item.day) !== day);
        state.history = entry
          ? [...rest, entry].sort((a, b) => (a.day < b.day ? 1 : -1))
          : rest;
      })
      .addCase(saveJournalEntry.rejected, (state, action) => {
        state.save = "error";
        state.saveError = action.payload as string;
      });

    builder
      .addCase(fetchJournalHistory.pending, (state) => {
        state.historyLoading = true;
        state.historyError = null;
      })
      .addCase(fetchJournalHistory.fulfilled, (state, action) => {
        state.historyLoading = false;
        state.history = [...action.payload.entries].sort((a, b) => (a.day < b.day ? 1 : -1));
      })
      .addCase(fetchJournalHistory.rejected, (state, action) => {
        state.historyLoading = false;
        state.historyError = action.payload as string;
      });
  },
});

export default journalSlice.reducer;
