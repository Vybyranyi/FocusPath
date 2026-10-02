import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router";
import { makeStore, type RootState } from "@store/store";
import { ToastProvider } from "@components/ui/Toast";
import type { HabitSummary, Plan, PlanSummary } from "@shared/index";

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Slice state to start from. Anything omitted falls back to the slice's own initial state. */
  preloadedState?: Partial<RootState>;
  /** Path the router starts at, for components that branch on the current route. */
  route?: string;
}

/**
 * Renders a component with the two contexts most of this app's components
 * assume: a Redux store and a router. The store is built per call, so state
 * never leaks between tests.
 *
 * Returns the store alongside the usual RTL result, so a test can dispatch to
 * it or assert on the state a click produced.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    preloadedState,
    route = "/",
    ...renderOptions
  }: RenderWithProvidersOptions = {},
) {
  const store = makeStore(preloadedState);

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    </Provider>
  );

  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}

/**
 * A habit as `GET /habits/daily` returns it. Defaults are deliberately boring —
 * override only the fields a test actually reasons about, so the intent of each
 * case stays visible.
 */
export const makeHabitSummary = (
  overrides: Partial<HabitSummary> = {},
): HabitSummary => ({
  _id: "habit-1",
  title: "Read",
  startDate: "2025-01-06T00:00:00.000Z",
  type: "build",
  color: "blue",
  icon: "books",
  currentStreak: 0,
  isCompleted: false,
  duration: 7,
  completedCount: 0,
  dayInfo: {
    _id: "day-1",
    dayTitle: "Read 10 pages",
    completedSteps: [],
    // A string, as it arrives over JSON — the old fixture used a Date, which
    // no response has ever actually contained.
    date: "2025-01-06T00:00:00.000Z",
    status: "pending",
  },
  ...overrides,
});

/** A plan as a list returns it — no days, since a card shows none. */
export const makePlanSummary = (
  overrides: Partial<PlanSummary> = {},
): PlanSummary => ({
  _id: "plan-1",
  title: "Read every day",
  description: "Twenty pages a day, whatever the book.",
  category: "learning",
  language: "en",
  type: "build",
  duration: 30,
  color: "blue",
  icon: "books",
  author: {},
  proven: false,
  official: false,
  status: "published",
  cloneCount: 0,
  createdAt: "2026-01-06T00:00:00.000Z",
  updatedAt: "2026-01-06T00:00:00.000Z",
  ...overrides,
});

/** A plan as the detail endpoint returns it, content included. */
export const makePlan = (overrides: Partial<Plan> = {}): Plan => ({
  ...makePlanSummary(),
  days: Array.from({ length: 30 }, (_unused, index) => ({
    dayTitle: `Day ${index + 1} task`,
  })),
  ...overrides,
});

/** Preloaded plans-slice state, so a test only spells out what it cares about. */
export const plansState = (
  overrides: Partial<RootState["plans"]> = {},
): Pick<RootState, "plans"> => ({
  plans: {
    sections: {
      official: { plans: [], loading: false },
      proven: { plans: [], loading: false },
      new: { plans: [], loading: false },
    },
    loadedOnce: false,
    plan: null,
    planLoading: false,
    myPlans: [],
    myPlansLoading: false,
    publishing: false,
    taking: false,
    error: null,
    ...overrides,
  },
});

/** Preloaded habit-slice state, so a test only spells out what it cares about. */
export const habitState = (
  overrides: Partial<RootState["habit"]> = {},
): Pick<RootState, "habit"> => ({
  habit: {
    habits: [],
    habitsForDate: [],
    loading: false,
    creating: null,
    error: null,
    dayRequestId: null,
    ...overrides,
  },
});
