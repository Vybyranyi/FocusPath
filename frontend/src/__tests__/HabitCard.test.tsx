import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { format } from "date-fns";
import type { DayState } from "@shared/index";
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
});
