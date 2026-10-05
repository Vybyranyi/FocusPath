import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CoachCard, Habit } from "@shared/index";
import { apiRequest, errorMessage } from "@api/client";
import { deleteAccount, logoutUser } from "@store/authSlice";

export interface ICoachSlice {
  /** Every card worth showing, newest first: the offers and the ones that were written. */
  cards: CoachCard[];
  nextCursor: string | null;
  loading: boolean;
  /** Set once the first refresh-and-fetch has finished, so "nothing yet" is not shown while it is on its way. */
  loadedOnce: boolean;
  error: string | null;
  /** Cards with something in flight — opening, applying — so a button can say so and be pressed once. */
  busy: Record<string, true>;
  /** The reason the last open or apply was refused, by card. */
  problems: Record<string, string>;
}

const initialState: ICoachSlice = {
  cards: [],
  nextCursor: null,
  loading: false,
  loadedOnce: false,
  error: null,
  busy: {},
  problems: {},
};

interface CardsPage {
  cards: CoachCard[];
  nextCursor?: string;
}

/**
 * Asks the coach to say whatever has come due, then reads what there is.
 *
 * Both in one go because the second depends on the first: a refresh may have
 * made a card, and an offer worked out by a write is only seen by reading. The
 * refresh costs nothing when nothing is due, and a failure of it is not the
 * person's problem — the cards already there are still worth showing.
 */
export const loadCoach = createAsyncThunk("coach/load", async (_: void, { rejectWithValue }) => {
  try {
    await apiRequest<{ cards: CoachCard[] }>("/coach/refresh", { method: "POST" }).catch(() => undefined);
    return await apiRequest<CardsPage>("/coach/cards?limit=20");
  } catch (error) {
    return rejectWithValue(errorMessage(error));
  }
});

export const loadMoreCoach = createAsyncThunk(
  "coach/loadMore",
  async (before: string, { rejectWithValue }) => {
    try {
      return await apiRequest<CardsPage>(
        `/coach/cards?limit=20&before=${encodeURIComponent(before)}`,
      );
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** The model explains an offer. May take a few seconds, and may be refused. */
export const openCoachCard = createAsyncThunk(
  "coach/open",
  async (id: string, { rejectWithValue }) => {
    try {
      return await apiRequest<{ card: CoachCard }>(`/coach/cards/${id}/open`, { method: "POST" });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

/** Makes the change the offer describes, through the ordinary edit. */
export const applyCoachCard = createAsyncThunk(
  "coach/apply",
  async (id: string, { rejectWithValue }) => {
    try {
      return await apiRequest<{ card: CoachCard; habit: Habit }>(`/coach/cards/${id}/apply`, {
        method: "POST",
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const dismissCoachCard = createAsyncThunk(
  "coach/dismiss",
  async (id: string, { rejectWithValue }) => {
    try {
      return await apiRequest<{ card: CoachCard }>(`/coach/cards/${id}/dismiss`, { method: "POST" });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const rateCoachCard = createAsyncThunk(
  "coach/rate",
  async ({ id, helpful }: { id: string; helpful: boolean }, { rejectWithValue }) => {
    try {
      return await apiRequest<{ card: CoachCard }>(`/coach/cards/${id}/feedback`, {
        method: "POST",
        body: { helpful },
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

const replace = (state: ICoachSlice, card: CoachCard) => {
  const index = state.cards.findIndex((item) => item._id === card._id);
  if (index !== -1) state.cards[index] = card;
};

const coachSlice = createSlice({
  name: "coach",
  initialState,
  reducers: {
    /** Forgets what was read, for signing out. */
    reset: () => initialState,
    clearProblem: (state, action: PayloadAction<string>) => {
      delete state.problems[action.payload];
    },
  },
  extraReducers: (builder) => {
    // What the coach said is built from one person's journal. It must not still be
    // in memory when somebody else signs in on the same page.
    builder.addCase(logoutUser.fulfilled, () => initialState);
    builder.addCase(deleteAccount.fulfilled, () => initialState);

    builder
      .addCase(loadCoach.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadCoach.fulfilled, (state, action) => {
        state.loading = false;
        state.loadedOnce = true;
        // Defaulted: a reply without a list is a reply this slice cannot use, and
        // an empty coach is better than a day view that will not draw.
        state.cards = action.payload.cards ?? [];
        state.nextCursor = action.payload.nextCursor ?? null;
      })
      .addCase(loadCoach.rejected, (state, action) => {
        state.loading = false;
        state.loadedOnce = true;
        state.error = action.payload as string;
      });

    builder.addCase(loadMoreCoach.fulfilled, (state, action) => {
      const known = new Set(state.cards.map((card) => card._id));
      state.cards.push(...(action.payload.cards ?? []).filter((card) => !known.has(card._id)));
      state.nextCursor = action.payload.nextCursor ?? null;
    });

    builder
      .addCase(openCoachCard.pending, (state, action) => {
        state.busy[action.meta.arg] = true;
        delete state.problems[action.meta.arg];
      })
      .addCase(openCoachCard.fulfilled, (state, action) => {
        delete state.busy[action.meta.arg];
        replace(state, action.payload.card);
      })
      .addCase(openCoachCard.rejected, (state, action) => {
        delete state.busy[action.meta.arg];
        state.problems[action.meta.arg] = action.payload as string;
      });

    builder
      .addCase(applyCoachCard.pending, (state, action) => {
        state.busy[action.meta.arg] = true;
        delete state.problems[action.meta.arg];
      })
      .addCase(applyCoachCard.fulfilled, (state, action) => {
        delete state.busy[action.meta.arg];
        replace(state, action.payload.card);
      })
      .addCase(applyCoachCard.rejected, (state, action) => {
        delete state.busy[action.meta.arg];
        state.problems[action.meta.arg] = action.payload as string;
      });

    builder.addCase(dismissCoachCard.fulfilled, (state, action) => {
      replace(state, action.payload.card);
    });
    builder.addCase(rateCoachCard.fulfilled, (state, action) => {
      replace(state, action.payload.card);
    });
  },
});

export const { reset: resetCoach, clearProblem } = coachSlice.actions;
export default coachSlice.reducer;
