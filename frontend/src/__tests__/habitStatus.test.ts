import { afterEach, describe, expect, it } from "vitest";
import type { DailyCompletion, DayStatus } from "@shared/index";
import { dayState, isDone } from "@/lib/habitStatus";

const SUITE_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = SUITE_TZ;
});

const day = (date: string, status: DayStatus): DailyCompletion => ({
  _id: "day-1",
  dayTitle: "Read 10 pages",
  date: `${date}T00:00:00.000Z`,
  status,
});

const TODAY = "2026-08-07";
const YESTERDAY = "2026-08-06";
const TOMORROW = "2026-08-08";

describe("dayState", () => {
  it("leaves a day the user acted on exactly as they left it", () => {
    expect(dayState(day(YESTERDAY, "done"), TODAY)).toBe("done");
    expect(dayState(day(YESTERDAY, "failed"), TODAY)).toBe("failed");
    expect(dayState(day(TODAY, "done"), TODAY)).toBe("done");
    expect(dayState(day(TODAY, "failed"), TODAY)).toBe("failed");
  });

  /**
   * The one derived state. Storing it would mean flipping rows at midnight in
   * every user's own timezone, and being wrong in between; reading the date
   * costs nothing and is never stale.
   */
  it("calls a day that slipped past missed", () => {
    expect(dayState(day(YESTERDAY, "pending"), TODAY)).toBe("missed");
  });

  it("gives today until it is over", () => {
    expect(dayState(day(TODAY, "pending"), TODAY)).toBe("pending");
  });

  it("does not call a day that has not arrived missed", () => {
    expect(dayState(day(TOMORROW, "pending"), TODAY)).toBe("pending");
  });

  /**
   * An explicit failure is a decision the user made and is never overwritten by
   * the passage of time — that distinction is the entire point of the enum.
   */
  it("does not rewrite an explicit failure into a missed day", () => {
    expect(dayState(day("2026-01-01", "failed"), TODAY)).toBe("failed");
  });

  it("reads the stored day in UTC, whatever the reader's zone", () => {
    process.env.TZ = "America/New_York";
    expect(dayState(day(TODAY, "pending"), TODAY)).toBe("pending");

    process.env.TZ = "Pacific/Kiritimati";
    expect(dayState(day(TODAY, "pending"), TODAY)).toBe("pending");
  });
});

describe("isDone", () => {
  it("counts only a finished day", () => {
    expect(isDone({ status: "done" })).toBe(true);
    expect(isDone({ status: "failed" })).toBe(false);
    expect(isDone({ status: "pending" })).toBe(false);
  });
});
