import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router";
import { makeStore, type RootState } from "@store/store";
import type { HabitSummary } from "@shared/index";

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
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
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
    // A string, as it arrives over JSON — the old fixture used a Date, which
    // no response has ever actually contained.
    date: "2025-01-06T00:00:00.000Z",
    status: "pending",
  },
  ...overrides,
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
    ...overrides,
  },
});
