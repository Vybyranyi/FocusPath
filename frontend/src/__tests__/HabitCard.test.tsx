import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { format } from "date-fns";
import type { DayState, HabitSummary } from "@shared/index";
import HabitCard from "@components/habit/HabitCard";
import { makeHabitSummary, renderWithProviders } from "../testUtils";


/** The suite's own zone, restored after any case that moves it. */
const SUITE_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = SUITE_TZ;
  vi.unstubAllGlobals();
});

/**
 * What the server stores for a given calendar day: midnight UTC. Reading it
 * back with local accessors is what half of this file exists to catch.
 */
const utcMidnightOf = (day: Date) => `${format(day, "yyyy-MM-dd")}T00:00:00.000Z`;

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

/**
 * The verdict the card is showing.
 *
 * These used to compare the exact `boxShadow` string, hardcoded hex and all,
 * which meant the suite could only pass while the colours were inline literals
 * — the very thing the audit asked to move into tokens. `data-status` says the
 * same thing without pinning the paint.
 */
const statusOf = (title: string) =>
  screen.getByText(title).closest("[data-status]")?.getAttribute("data-status");

/**
 * `missed` is the server's to say now — it is derived from the date there, in
 * one place — so a day that slipped past is rendered by handing the card a day
 * the server already called missed.
 */
const renderDay = (offset: number, state: DayState = "pending") =>
  renderWithProviders(
    <HabitCard
      habit={makeHabitSummary({
        day: {
          completedSteps: [],
          date: utcMidnightOf(daysFromToday(offset)),
          state,
          session: { index: 1, total: 7, title: "Read 10 pages" },
        },
      })}
    />,
  );

describe("HabitCard", () => {
  describe("what the card says", () => {
    it("names the task of the session the day carries", () => {
      renderDay(0);

      expect(screen.getByText("Read 10 pages")).toBeInTheDocument();
    });

    it("falls back to the habit's description when it has no programme", () => {
      renderWithProviders(
        <HabitCard
          habit={makeHabitSummary({
            description: "Ten pages",
            sessions: undefined,
            day: { completedSteps: [], date: utcMidnightOf(new Date()), state: "pending" },
          })}
        />,
      );

      expect(screen.getByText("Ten pages")).toBeInTheDocument();
    });
  });

  describe("days the habit is not asked for", () => {
    it.each([["paused", "Paused"], ["rest", "Rest day"]] as const)("says so on a %s day, and offers no marks", (state, word) => {
      renderDay(0, state);

      expect(screen.getByText(word)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark Read done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark Read not done" })).not.toBeInTheDocument();
    });
  });

  describe("what a day looks like", () => {
    it("leaves today neutral while it is still unmarked", () => {
      renderDay(0);

      expect(statusOf("Read")).toBe("pending");
    });

    it("marks a finished day done", () => {
      renderDay(0, "done");

      expect(statusOf("Read")).toBe("done");
    });

    /**
     * Letting a day slip and deciding you failed it are different things, and
     * a boolean made them the same colour. A day still pending once it is over
     * is missed — derived from the date, never stored.
     */
    it("shows a day that slipped past as missed, not failed", () => {
      renderDay(-1, "missed");

      expect(statusOf("Read")).toBe("missed");
    });

    it("shows a day the user marked failed as failed", () => {
      renderDay(-1, "failed");

      expect(statusOf("Read")).toBe("failed");
    });

    it("offers no verdict on a day that has not arrived", () => {
      renderDay(1);

      expect(screen.queryByRole("button", { name: /Mark Read done/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Mark Read not done/ })).not.toBeInTheDocument();
    });

    it("states the verdict in words, not only in colour", () => {
      // done / failed / missed used to differ by ring colour alone, and the
      // amber was 2:1 against white.
      renderDay(-1, "missed");

      expect(screen.getByText("Missed")).toBeInTheDocument();
    });
  });

  /**
   * The defect the enum exists to fix. "I failed today" used to be stored as
   * `completed: false`, which is indistinguishable from "today has not happened
   * yet" — so the red state lived in component state and vanished on the next
   * refetch or reload.
   */
  describe("a verdict on today", () => {
    it("survives being remounted", () => {
      const { unmount } = renderDay(0, "failed");
      expect(statusOf("Read")).toBe("failed");

      unmount();
      renderDay(0, "failed");

      expect(statusOf("Read")).toBe("failed");
    });

    it("is not the same as an unmarked day", () => {
      const { unmount } = renderDay(0, "failed");
      const failed = statusOf("Read");
      unmount();

      renderDay(0, "pending");

      expect(statusOf("Read")).not.toBe(failed);
    });
  });

  describe("marking a day", () => {
    /**
     * Both buttons were `hidden lg:flex`, so under 1024px the only way to mark
     * a habit was a horizontal swipe that nothing on screen mentioned — and
     * there was no keyboard path at any width.
     */
    it("offers done and not-done as real buttons at every width", () => {
      renderDay(0);

      expect(screen.getByRole("button", { name: "Mark Read done" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark Read not done" })).toBeInTheDocument();
    });

    it("reports which verdict is currently set", () => {
      renderDay(0, "done");

      expect(screen.getByRole("button", { name: "Mark Read done" }))
        .toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Mark Read not done" }))
        .toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("across the meridian", () => {
    /**
     * The mirror of the bug the day view had. Midnight UTC read through local
     * accessors lands on the previous day everywhere west of Greenwich, which
     * rendered every unmarked habit as overdue a day early.
     */
    it("still offers today's marks west of UTC", () => {
      process.env.TZ = "America/New_York";

      renderDay(0);

      expect(screen.getByRole("button", { name: "Mark Read done" })).toBeInTheDocument();
    });

    it("still keeps a day that has not come closed west of UTC", () => {
      process.env.TZ = "America/New_York";

      renderDay(1);

      expect(screen.queryByRole("button", { name: "Mark Read done" })).not.toBeInTheDocument();
    });
  });

  /** A refused mark changed nothing and said nothing, which reads as a missed swipe. */
  it("says so when a mark is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "The habit is not scheduled on that date" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    document.cookie = "csrf_token=token; path=/";
    renderDay(0);

    fireEvent.click(screen.getByRole("button", { name: "Mark Read done" }));

    expect(await screen.findByText(/could not save “read” — the habit is not scheduled on that date/i)).toBeInTheDocument();
  });

  describe("counting a quantity", () => {
    const fetchMock = vi.fn();

    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const counted = (day: Partial<HabitSummary["day"]> = {}, habit: Partial<HabitSummary> = {}) =>
      renderWithProviders(
        <HabitCard
          habit={makeHabitSummary({
            title: "Water",
            day: {
              completedSteps: [],
              date: utcMidnightOf(new Date()),
              state: "pending",
              target: { value: 8, unit: "glasses" },
              ...day,
            },
            ...habit,
          })}
        />,
      );

    const bodyAt = (call: number) =>
      JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body));

    beforeEach(() => {
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(ok({ habit: makeHabitSummary(), day: { date: "", state: "pending", completedSteps: [] } }));
      document.cookie = "csrf_token=token; path=/";
    });

    it("shows how far the day has got towards the goal", () => {
      counted({ value: 3 });

      expect(screen.getByText("3 / 8")).toBeInTheDocument();
      expect(screen.getByText("glasses")).toBeInTheDocument();
    });

    it("offers a count instead of a tick", () => {
      counted();

      expect(screen.queryByRole("button", { name: "Mark Water done" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /one more glasses for Water/i })).toBeInTheDocument();
    });

    const sent = () => waitFor(() => expect(fetchMock).toHaveBeenCalled());

    it("adds one with a tap", async () => {
      counted({ value: 3 });

      fireEvent.click(screen.getByRole("button", { name: /one more glasses for Water/i }));
      await sent();

      expect(String(fetchMock.mock.calls[0][0])).toContain("/habits/habit-1/value");
      expect(bodyAt(0)).toMatchObject({ value: 4 });
    });

    /**
     * Each tap computed from the number on screen, and the second went out
     * before the first had answered — two glasses were saved as one.
     */
    it("shows each tap at once and sends the taps as one request", async () => {
      counted({ value: 0 });
      const more = screen.getByRole("button", { name: /one more glasses for Water/i });

      fireEvent.click(more);
      fireEvent.click(more);
      fireEvent.click(more);

      expect(screen.getByText("3 / 8")).toBeInTheDocument();
      await sent();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bodyAt(0)).toMatchObject({ value: 3 });
    });

    it("does not lose taps when the day is left before they were sent", () => {
      const { unmount } = counted({ value: 3 });

      fireEvent.click(screen.getByRole("button", { name: /one more glasses for Water/i }));
      unmount();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bodyAt(0)).toMatchObject({ value: 4 });
    });

    it("puts the server's number back when a count is refused", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: { code: "BAD_REQUEST", message: "The habit is paused on that date" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );
      counted({ value: 3 });

      fireEvent.click(screen.getByRole("button", { name: /one more glasses for Water/i }));
      expect(screen.getByText("4 / 8")).toBeInTheDocument();

      expect(await screen.findByText(/could not save “water” — the habit is paused on that date/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("3 / 8")).toBeInTheDocument());
    });

    it("takes one off, and cannot go below nothing", async () => {
      const { unmount } = counted({ value: 3 });
      fireEvent.click(screen.getByRole("button", { name: /one less glasses for Water/i }));
      await sent();
      expect(bodyAt(0)).toMatchObject({ value: 2 });
      unmount();

      counted({ value: 0 });
      expect(screen.getByRole("button", { name: /one less glasses for Water/i })).toBeDisabled();
    });

    it("takes a number typed in, for the day that was fourteen", async () => {
      counted({ value: 3 });

      fireEvent.click(screen.getByRole("button", { name: /set glasses for Water/i }));
      const field = screen.getByRole("spinbutton");
      fireEvent.change(field, { target: { value: "14" } });
      fireEvent.keyDown(field, { key: "Enter" });
      await sent();

      expect(bodyAt(0)).toMatchObject({ value: 14 });
    });

    it("leaves the day alone when the typed number is dropped with Escape", () => {
      counted({ value: 3 });

      fireEvent.click(screen.getByRole("button", { name: /set glasses for Water/i }));
      const field = screen.getByRole("spinbutton");
      fireEvent.change(field, { target: { value: "14" } });
      fireEvent.keyDown(field, { key: "Escape" });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("has nothing to count on a day that has not come", () => {
      counted({ date: utcMidnightOf(daysFromToday(1)) });

      expect(screen.queryByRole("button", { name: /one more glasses/i })).not.toBeInTheDocument();
    });

    describe("a limit to quit", () => {
      const limit = { value: 5, unit: "cigarettes" };

      it("offers a clean day until anything is counted, and records it as zero", async () => {
        counted({ target: limit }, { type: "quit", title: "Smoking" });

        fireEvent.click(screen.getByRole("button", { name: /Mark Smoking a clean day/ }));
        await sent();

        expect(bodyAt(0)).toMatchObject({ value: 0 });
      });

      it("stops offering it once the day has a value", () => {
        counted({ target: limit, value: 0 }, { type: "quit", title: "Smoking" });

        expect(screen.queryByRole("button", { name: /a clean day/ })).not.toBeInTheDocument();
      });

      it("does not offer a clean day to a habit that is built", () => {
        counted();

        expect(screen.queryByRole("button", { name: /a clean day/ })).not.toBeInTheDocument();
      });
    });
  });

  describe("a habit a number of times a week", () => {
    const weekly = (week: { done: number; target: number }, state: DayState = "pending") =>
      renderWithProviders(
        <HabitCard
          habit={makeHabitSummary({
            frequency: { kind: "weekly", times: week.target },
            streakUnit: "week",
            day: { completedSteps: [], date: utcMidnightOf(new Date()), state, week },
          })}
        />,
      );

    it("says how the week stands", () => {
      weekly({ done: 2, target: 3 });

      expect(screen.getByText("2 / 3 this week")).toBeInTheDocument();
    });

    it("can still be marked while the week is open", () => {
      weekly({ done: 2, target: 3 });

      expect(screen.getByRole("button", { name: "Mark Read done" })).toBeInTheDocument();
    });

    it("rests, muted, once the week is met", () => {
      weekly({ done: 3, target: 3 });

      expect(screen.getByText("Week done")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark Read done" })).not.toBeInTheDocument();
    });

    it("keeps the day that met the week open to being taken back", () => {
      weekly({ done: 3, target: 3 }, "done");

      expect(screen.getByRole("button", { name: "Mark Read done" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("asking why a day was failed", () => {
    const fetchMock = vi.fn();

    const failedDay = (over: Partial<HabitSummary["day"]> = {}) => ({
      date: utcMidnightOf(new Date()),
      state: "failed" as DayState,
      completedSteps: [],
      ...over,
    });

    const answer = (day: Partial<HabitSummary["day"]>) =>
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ success: true, data: { habit: makeHabitSummary(), day: failedDay(day) } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const user = (askFailureReason: boolean | undefined) => ({
      auth: {
        user: {
          _id: "u", name: "A", surname: "B", birthday: "", gender: "male" as const, email: "a@b.c", createdAt: "", updatedAt: "",
          ...(askFailureReason === undefined ? {} : { preferences: { askFailureReason, coachReadsNotes: false } }),
        },
        loading: false,
        error: null,
        unreachable: false,
      },
    });

    beforeEach(() => {
      vi.stubGlobal("fetch", fetchMock);
      fetchMock.mockReset();
      document.cookie = "csrf_token=token; path=/";
    });

    const failIt = (preferences: boolean | undefined = true) => {
      renderWithProviders(<HabitCard habit={makeHabitSummary({ day: { date: utcMidnightOf(new Date()), state: "pending", completedSteps: [] } })} />, {
        preloadedState: user(preferences),
      });
      fireEvent.click(screen.getByRole("button", { name: "Mark Read not done" }));
    };

    it("asks right after the day is marked failed", async () => {
      answer({});

      failIt();

      expect(await screen.findByText("What got in the way?")).toBeInTheDocument();
    });

    it("asks by default, before the person has chosen anything", async () => {
      answer({});

      failIt(undefined);

      expect(await screen.findByText("What got in the way?")).toBeInTheDocument();
    });

    it("does not ask a person who asked not to be", async () => {
      answer({});

      failIt(false);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByText("What got in the way?")).not.toBeInTheDocument();
    });

    it("does not ask twice for the same day", async () => {
      answer({ reasonPrompted: true });

      failIt();

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByText("What got in the way?")).not.toBeInTheDocument();
    });

    it("does not ask after a day is marked done", async () => {
      answer({ state: "done" });
      renderWithProviders(<HabitCard habit={makeHabitSummary({ day: { date: utcMidnightOf(new Date()), state: "pending", completedSteps: [] } })} />, {
        preloadedState: user(true),
      });

      fireEvent.click(screen.getByRole("button", { name: "Mark Read done" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.queryByText("What got in the way?")).not.toBeInTheDocument();
    });

    it("asks when a limit to quit is passed", async () => {
      answer({});
      renderWithProviders(
        <HabitCard
          habit={makeHabitSummary({
            type: "quit",
            title: "Smoking",
            day: { date: utcMidnightOf(new Date()), state: "pending", completedSteps: [], target: { value: 3, unit: "cigarettes" }, value: 3 },
          })}
        />,
        { preloadedState: user(true) },
      );

      fireEvent.click(screen.getByRole("button", { name: /one more cigarettes for Smoking/i }));

      expect(await screen.findByText("What got in the way?", {}, { timeout: 2500 })).toBeInTheDocument();
    });
  });
});
