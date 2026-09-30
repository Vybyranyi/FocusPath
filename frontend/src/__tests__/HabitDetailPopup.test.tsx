import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import HabitDetailPopup from "@components/habit/HabitDetailPopup";
import type { HabitSummary } from "@shared/index";
import { toDayKey } from "@/lib/dates";
import { habitState, makeHabitSummary, renderWithProviders } from "../testUtils";

const fetchMock = vi.fn();

/** A day as the server names it: that local calendar day, at midnight UTC. */
const dayFromToday = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${toDayKey(date)}T00:00:00.000Z`;
};

const withSteps = (offset: number, completedSteps: string[] = []): HabitSummary =>
  makeHabitSummary({
    steps: [
      { _id: "s1", title: "Stretch" },
      { _id: "s2", title: "Drink water" },
    ],
    dayInfo: {
      _id: "day-1",
      dayTitle: "Morning",
      date: dayFromToday(offset),
      status: "pending",
      completedSteps,
    },
  });

const open = (habit: HabitSummary) =>
  renderWithProviders(<HabitDetailPopup habit={habit} onClose={vi.fn()} />, {
    preloadedState: habitState({ habitsForDate: [habit] }),
  });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
  document.cookie = "csrf_token=token; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HabitDetailPopup", () => {
  describe("the daily checklist", () => {
    it("shows the ticks of the day on screen, not of the habit", () => {
      open(withSteps(0, ["s1"]));

      expect(screen.getByRole("button", { name: /stretch/i })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /drink water/i })).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
    });

    it("ticks a step against the day on screen", () => {
      open(withSteps(0));

      fireEvent.click(screen.getByRole("button", { name: /stretch/i }));

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/steps/s1");
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ date: toDayKey(new Date()) });
    });

    it("does not let a day that has not come be ticked", () => {
      open(withSteps(2));

      expect(screen.getByRole("button", { name: /stretch/i })).toBeDisabled();
      expect(screen.getByText(/has not come yet/i)).toBeInTheDocument();
    });

    /** It used to switch to the step ratio, which says nothing about the plan. */
    it("keeps the progress bar on the plan", () => {
      open({ ...withSteps(0, ["s1", "s2"]), completedCount: 1, duration: 10 });

      expect(screen.getByRole("progressbar", { name: /overall progress/i })).toHaveAttribute("aria-valuenow", "10");
    });

    it("shows the streak even when the habit has steps", () => {
      open(withSteps(0));

      expect(screen.getByText(/current streak/i)).toBeInTheDocument();
    });
  });

  it("offers editing from the habit menu", () => {
    open(withSteps(0));

    fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

    expect(screen.getByRole("button", { name: /edit habit/i })).toBeInTheDocument();
  });

  describe("publishing", () => {
    it("offers to publish a habit that has not been", () => {
      open(withSteps(0));

      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      expect(screen.getByRole("button", { name: /publish as a plan/i })).toBeInTheDocument();
    });

    /** The server refuses a second copy; offering one only to refuse it is worse. */
    it("leads a published habit to its plan instead", () => {
      open({ ...withSteps(0), publishedPlanId: "plan-9" });

      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      expect(screen.queryByRole("button", { name: /publish as a plan/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /view published plan/i })).toBeInTheDocument();
    });
  });

  describe("the day tile", () => {
    /** The sheet opens from whichever day is selected; the tile said "Today" for all. */
    it("names the day on screen", () => {
      open(withSteps(-1));

      expect(screen.getByText("Yesterday")).toBeInTheDocument();
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
    });

    /** It used the streak, which is 0 on a fresh habit and resets on a slip. */
    it("falls back to the day's place in the plan, not the streak", () => {
      open(
        makeHabitSummary({
          startDate: dayFromToday(-11),
          currentStreak: 0,
          dayInfo: { _id: "d", dayTitle: "", date: dayFromToday(0), status: "pending", completedSteps: [] },
        }),
      );

      expect(screen.getByText("Day 12")).toBeInTheDocument();
    });
  });

  describe("the habit menu", () => {
    // The menu animates out, so it leaves the DOM a moment after it closes.
    it("closes when you click elsewhere in the sheet", async () => {
      open(withSteps(0));
      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      fireEvent.pointerDown(screen.getByText(/current streak/i));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /edit habit/i })).not.toBeInTheDocument(),
      );
    });

    /** Escape closed the whole sheet under an open menu. */
    it("closes on Escape and leaves the sheet open", async () => {
      open(withSteps(0));
      fireEvent.click(screen.getByRole("button", { name: /habit options/i }));

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /edit habit/i })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
