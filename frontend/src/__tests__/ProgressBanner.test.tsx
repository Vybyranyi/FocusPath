import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProgressBanner from "@components/habit/ProgressBanner";
import { habitState, makeHabitSummary, renderWithProviders } from "../testUtils";
import type { HabitSummary } from "@shared/index";

// The emoji package resolves sprite data through its own context provider,
// which a unit test has no reason to stand up.
vi.mock("react-apple-emojis", () => ({
  Emoji: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid="emoji" data-name={name} className={className} />
  ),
}));

const habit = (id: string, completed: boolean, day: Partial<HabitSummary["day"]> = {}) =>
  makeHabitSummary({
    _id: id,
    day: {
      completedSteps: [],
      date: "2025-01-06T00:00:00.000Z",
      state: completed ? "done" : "pending",
      ...day,
    },
  });

const withHabits = (habits: HabitSummary[]) => habitState({ habitsForDate: habits });

describe("ProgressBanner", () => {
  it("renders nothing when the day has no habits", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([]),
    });

    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
  });

  it("counts how many of the day's habits are done", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([
        habit("a", true),
        habit("b", false),
        habit("c", false),
      ]),
    });

    expect(screen.getByText("1 of 3 completed")).toBeInTheDocument();
    expect(screen.getByText("Keep going — 2 to go")).toBeInTheDocument();
  });

  /** "Almost done" at 0 of 5 was not almost anything. */
  it("does not call a day with nothing done almost done", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([habit("a", false), habit("b", false)]),
    });

    expect(screen.getByText("Nothing done yet — pick one to start")).toBeInTheDocument();
  });

  it("says so when one is left", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([habit("a", true), habit("b", false)]),
    });

    expect(screen.getByText("Almost there — one to go!")).toBeInTheDocument();
  });

  it("shows the completed share as a rounded percentage", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([
        habit("a", true),
        habit("b", false),
        habit("c", false),
      ]),
    });

    // 1 of 3 rounds to 33.
    expect(screen.getByText("%33")).toBeInTheDocument();
  });

  it("switches the message once every habit is done", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([habit("a", true), habit("b", true)]),
    });

    expect(screen.getByText("All goals completed!")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 completed")).toBeInTheDocument();
    // At 100% the loader swaps its label for a tick.
    expect(screen.getByAltText("done")).toBeInTheDocument();
  });

  /** A habit that is paused, or resting today, asks nothing — it is neither owed nor done. */
  it("leaves out habits that are paused or resting", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([
        habit("a", true),
        habit("b", false, { state: "paused" }),
        habit("c", false, { state: "rest" }),
      ]),
    });

    expect(screen.getByText("1 of 1 completed")).toBeInTheDocument();
  });

  it("counts a weekly habit whose week is met as done", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([
        habit("a", false, { week: { done: 3, target: 3 } }),
        habit("b", false, { week: { done: 1, target: 3 } }),
      ]),
    });

    expect(screen.getByText("1 of 2 completed")).toBeInTheDocument();
  });

  it("renders nothing when every habit of the day is paused", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([habit("a", false, { state: "paused" })]),
    });

    expect(screen.queryByText(/completed/)).not.toBeInTheDocument();
  });

  it("renders the fire emoji alongside the message", () => {
    renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([habit("a", false)]),
    });

    expect(screen.getByTestId("emoji")).toHaveAttribute("data-name", "fire");
  });

  it("uses the blue gradient background", () => {
    const { container } = renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([habit("a", false)]),
    });

    expect(container.firstChild).toHaveClass("bg-blue-gradient");
  });
});
