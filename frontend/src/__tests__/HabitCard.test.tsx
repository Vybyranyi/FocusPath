import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { format } from "date-fns";
import HabitCard from "@components/habit/HabitCard";
import { makeHabitSummary, renderWithProviders } from "../testUtils";

const NEUTRAL = "inset 0 0 0 1px #EAECF0";
const RED = "inset 0 0 0 1.5px #E3524F";
const GREEN = "inset 0 0 0 1.5px #3BA935";

/** The suite's own zone, restored after any case that moves it. */
const SUITE_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = SUITE_TZ;
});

/**
 * What the server stores for a given calendar day: midnight UTC. Reading it
 * back with local accessors is what this file exists to catch.
 */
const utcMidnightOf = (day: Date) => `${format(day, "yyyy-MM-dd")}T00:00:00.000Z`;

const daysFromToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const ringOf = (title: string) => {
  const card = screen.getByText(title).closest("div[style]");
  return (card as HTMLElement).style.boxShadow;
};

const renderDay = (offset: number, completed = false) =>
  renderWithProviders(
    <HabitCard
      habit={makeHabitSummary({
        dayInfo: {
          _id: "day-1",
          dayTitle: "Read 10 pages",
          date: utcMidnightOf(daysFromToday(offset)),
          completed,
        },
      })}
    />,
  );

describe("HabitCard", () => {
  it("leaves today neutral while it is still unmarked", () => {
    renderDay(0);

    expect(ringOf("Read")).toBe(NEUTRAL);
  });

  it("marks a finished day done", () => {
    renderDay(0, true);

    expect(ringOf("Read")).toBe(GREEN);
  });

  it("treats a day that has already passed as failed", () => {
    renderDay(-1);

    expect(ringOf("Read")).toBe(RED);
  });

  it("offers no verdict on a day that has not arrived", () => {
    renderDay(1);

    expect(screen.queryByAltText("Done")).not.toBeInTheDocument();
  });

  /**
   * The mirror of the bug the day view had. Midnight UTC read through local
   * accessors lands on the previous day everywhere west of Greenwich, which
   * rendered every unmarked habit as a failure a day early.
   */
  it("classifies today the same way west of UTC", () => {
    process.env.TZ = "America/New_York";

    renderDay(0);

    expect(ringOf("Read")).toBe(NEUTRAL);
  });

  it("still treats yesterday as passed west of UTC", () => {
    process.env.TZ = "America/New_York";

    renderDay(-1);

    expect(ringOf("Read")).toBe(RED);
  });
});
