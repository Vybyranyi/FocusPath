import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addDays, format, startOfWeek } from "date-fns";
import Main from "@pages/Main";
import { renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

const emptyDay = () =>
  new Response(JSON.stringify({ success: true, data: { date: "", habits: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** Every `?date=` the page has asked for so far, in order. */
const requestedDays = () =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/habits/daily"))
    .map((url) => new URL(url, "http://localhost").searchParams.get("date"));

const lastRequestedDay = () => requestedDays()[requestedDays().length - 1];

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(emptyDay());
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const weekStart = () => startOfWeek(new Date(), { weekStartsOn: 1 });

/**
 * The week strip is built from local dates, so the day a user sees is their
 * local one. Preloaded rather than left to the slice's own initial state, which
 * is evaluated once at import and would not follow a fixture.
 */
const thisWeek = () => ({ calendar: { currentWeekStart: weekStart().toISOString() } });

/** Some other day the strip is already showing, whichever day today happens to be. */
const anotherDayThisWeek = () => {
  const today = new Date();
  const candidate = addDays(weekStart(), 0);
  return format(candidate, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")
    ? addDays(weekStart(), 1)
    : candidate;
};

const clickCell = (user: ReturnType<typeof userEvent.setup>, date: Date) =>
  user.click(screen.getByText(String(date.getDate())));

describe("Main", () => {
  it("asks for today when it mounts", async () => {
    renderWithProviders(<Main />, { preloadedState: thisWeek() });

    await waitFor(() => expect(requestedDays()).toHaveLength(1));
    expect(requestedDays()[0]).toBe(format(new Date(), "yyyy-MM-dd"));
  });

  it("asks for the day whose cell was clicked", async () => {
    const user = userEvent.setup();
    const other = anotherDayThisWeek();

    renderWithProviders(<Main />, { preloadedState: thisWeek() });
    await waitFor(() => expect(requestedDays()).toHaveLength(1));

    await clickCell(user, other);

    await waitFor(() => expect(requestedDays()).toHaveLength(2));
    expect(lastRequestedDay()).toBe(format(other, "yyyy-MM-dd"));
  });

  /**
   * The reported sequence, exactly: create a habit today, step to another day,
   * step back. Coming back used to ask for the day *before* today and answer
   * "no habits for this day" until the page was reloaded.
   */
  it("comes back to the day it started on", async () => {
    const user = userEvent.setup();
    const today = new Date();
    const other = anotherDayThisWeek();

    renderWithProviders(<Main />, { preloadedState: thisWeek() });
    await waitFor(() => expect(requestedDays()).toHaveLength(1));

    await clickCell(user, other);
    await waitFor(() => expect(requestedDays()).toHaveLength(2));

    await clickCell(user, today);

    await waitFor(() => expect(requestedDays()).toHaveLength(3));
    expect(lastRequestedDay()).toBe(format(today, "yyyy-MM-dd"));
  });

  it("does not refetch a day it is already showing", async () => {
    const user = userEvent.setup();
    const today = new Date();

    renderWithProviders(<Main />, { preloadedState: thisWeek() });
    await waitFor(() => expect(requestedDays()).toHaveLength(1));

    await clickCell(user, today);

    expect(requestedDays()).toEqual([format(today, "yyyy-MM-dd")]);
  });
});
