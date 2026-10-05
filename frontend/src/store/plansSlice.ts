import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type {
  Frequency,
  Habit,
  Plan,
  PlanCategory,
  PlanPage,
  PlanSection,
  PlanSummary,
  ReportReason,
  Target,
} from "@shared/index";
import { apiRequest, errorMessage } from "@api/client";

/** One editorial shelf of the Explore page, and how much of it has been read. */
export interface PlanShelf {
  plans: PlanSummary[];
  nextCursor?: string;
  loading: boolean;
}

export interface PlanFilters {
  category?: PlanCategory;
  /** Empty means every language. */
  language?: string;
}

export interface IPlansSlice {
  sections: Record<PlanSection, PlanShelf>;
  /**
   * Whether any shelf has come back yet.
   *
   * Without it "every shelf is empty and none is loading" is also true on the
   * very first render — before the effect has dispatched anything — so the page
   * flashed its empty state for a frame on every visit.
   */
  loadedOnce: boolean;
  /** The plan the detail page is showing. */
  plan: Plan | null;
  planLoading: boolean;
  myPlans: PlanSummary[];
  myPlansLoading: boolean;
  publishing: boolean;
  taking: boolean;
  error: string | null;
}

const emptyShelf = (): PlanShelf => ({ plans: [], loading: false });

const initialState: IPlansSlice = {
  sections: { official: emptyShelf(), proven: emptyShelf(), new: emptyShelf() },
  loadedOnce: false,
  plan: null,
  planLoading: false,
  myPlans: [],
  myPlansLoading: false,
  publishing: false,
  taking: false,
  error: null,
};

const shelfQuery = (
  section: PlanSection,
  filters: PlanFilters,
  cursor?: string,
): string => {
  const params = new URLSearchParams({ section });
  if (filters.category) params.set("category", filters.category);
  if (filters.language) params.set("language", filters.language);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
};

export interface FetchShelfArgs {
  section: PlanSection;
  filters: PlanFilters;
  /** Present when loading a further page, which appends rather than replaces. */
  cursor?: string;
}

export const fetchShelf = createAsyncThunk(
  "plans/fetchShelf",
  async ({ section, filters, cursor }: FetchShelfArgs, { rejectWithValue }) => {
    try {
      const page = await apiRequest<PlanPage>(`/plans?${shelfQuery(section, filters, cursor)}`);
      return { section, page, append: Boolean(cursor) };
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const fetchPlan = createAsyncThunk(
  "plans/fetchPlan",
  async (planId: string, { rejectWithValue }) => {
    try {
      return await apiRequest<{ plan: Plan }>(`/plans/${planId}`);
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const fetchMyPlans = createAsyncThunk(
  "plans/fetchMyPlans",
  async (_, { rejectWithValue }) => {
    try {
      return await apiRequest<{ plans: PlanSummary[] }>("/plans/mine");
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export interface PublishPlanArgs {
  habitId: string;
  category: PlanCategory;
  displayName?: string;
}

export const publishPlan = createAsyncThunk(
  "plans/publishPlan",
  async (body: PublishPlanArgs, { rejectWithValue }) => {
    try {
      return await apiRequest<{ plan: Plan }>("/plans", { method: "POST", body });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export const unpublishPlan = createAsyncThunk(
  "plans/unpublishPlan",
  async (planId: string, { rejectWithValue }) => {
    try {
      await apiRequest<{ plan: Plan }>(`/plans/${planId}`, { method: "DELETE" });
      return planId;
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export interface TakePlanArgs {
  planId: string;
  /** A day key, `YYYY-MM-DD` — never a full instant. */
  startDate: string;
  /** Length of the programme, in sessions. */
  sessions?: number;
  frequency?: Frequency;
  /** `null` drops the goal the plan came with. */
  target?: Target | null;
}

export const takePlan = createAsyncThunk(
  "plans/takePlan",
  async (body: TakePlanArgs, { rejectWithValue }) => {
    try {
      return await apiRequest<{ habit: Habit }>("/habits/from-plan", {
        method: "POST",
        body,
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

export interface ReportPlanArgs {
  planId: string;
  reason: ReportReason;
  comment?: string;
}

export const reportPlan = createAsyncThunk(
  "plans/reportPlan",
  async ({ planId, ...body }: ReportPlanArgs, { rejectWithValue }) => {
    try {
      return await apiRequest<{ reported: boolean }>(`/plans/${planId}/report`, {
        method: "POST",
        body,
      });
    } catch (error) {
      return rejectWithValue(errorMessage(error));
    }
  },
);

const plansSlice = createSlice({
  name: "plans",
  initialState,
  reducers: {
    /** Clears the open plan, so the detail page never shows the previous one. */
    clearPlan(state) {
      state.plan = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchShelf.pending, (state, action) => {
        state.sections[action.meta.arg.section].loading = true;
        state.error = null;
      })
      .addCase(fetchShelf.fulfilled, (state, action) => {
        const { section, page, append } = action.payload;
        const shelf = state.sections[section];

        shelf.loading = false;
        shelf.plans = append ? [...shelf.plans, ...page.plans] : page.plans;
        shelf.nextCursor = page.nextCursor;
        state.loadedOnce = true;
      })
      .addCase(fetchShelf.rejected, (state, action) => {
        state.sections[action.meta.arg.section].loading = false;
        state.loadedOnce = true;
        state.error = action.payload as string;
      });

    builder
      .addCase(fetchPlan.pending, (state) => {
        state.planLoading = true;
        state.error = null;
      })
      .addCase(fetchPlan.fulfilled, (state, action) => {
        state.planLoading = false;
        state.plan = action.payload.plan;
      })
      .addCase(fetchPlan.rejected, (state, action) => {
        state.planLoading = false;
        state.plan = null;
        state.error = action.payload as string;
      });

    builder
      .addCase(fetchMyPlans.pending, (state) => {
        state.myPlansLoading = true;
      })
      .addCase(fetchMyPlans.fulfilled, (state, action) => {
        state.myPlansLoading = false;
        state.myPlans = action.payload.plans;
      })
      .addCase(fetchMyPlans.rejected, (state, action) => {
        state.myPlansLoading = false;
        state.error = action.payload as string;
      });

    builder
      .addCase(publishPlan.pending, (state) => {
        state.publishing = true;
        state.error = null;
      })
      .addCase(publishPlan.fulfilled, (state) => {
        state.publishing = false;
      })
      .addCase(publishPlan.rejected, (state, action) => {
        state.publishing = false;
        state.error = action.payload as string;
      });

    builder.addCase(unpublishPlan.fulfilled, (state, action) => {
      // Withdrawal is soft on the server, and the author's own page is where
      // that has to be visible — the row stays, its status changes.
      const plan = state.myPlans.find((candidate) => candidate._id === action.payload);
      if (plan) plan.status = "unpublished";
    });

    builder
      .addCase(takePlan.pending, (state) => {
        state.taking = true;
        state.error = null;
      })
      .addCase(takePlan.fulfilled, (state) => {
        state.taking = false;
      })
      .addCase(takePlan.rejected, (state, action) => {
        state.taking = false;
        state.error = action.payload as string;
      });
  },
});

export const { clearPlan } = plansSlice.actions;
export default plansSlice.reducer;
