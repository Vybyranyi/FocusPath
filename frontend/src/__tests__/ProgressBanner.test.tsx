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

const habit = (id: string, completed: boolean) =>
  makeHabitSummary({
    _id: id,
    dayInfo: {
      _id: `${id}-day`,
      dayTitle: "task",
      date: "2025-01-06T00:00:00.000Z",
      status: completed ? "done" : "pending",
    },
  });

const withHabits = (habits: HabitSummary[]) => habitState({ habitsForDate: habits });

describe("ProgressBanner", () => {
  it("renders nothing when the day has no habits", () => {
    const { container } = renderWithProviders(<ProgressBanner />, {
      preloadedState: withHabits([]),
    });

    expect(container).toBeEmptyDOMElement();
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
    expect(screen.getByText("Your daily goals almost done!")).toBeInTheDocument();
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
