import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE,
  draftFrequency,
  draftOf,
  draftTarget,
  frequencyLabel,
  sameFrequency,
  sameTarget,
  scheduleProblems,
  streakLabel,
  targetLabel,
} from "@/lib/schedule";

describe("frequencyLabel", () => {
  it("says a rhythm in a few words", () => {
    expect(frequencyLabel({ kind: "daily" })).toBe("Every day");
    expect(frequencyLabel({ kind: "weekly", times: 3 })).toBe("3× a week");
    expect(frequencyLabel({ kind: "weekdays", days: [1, 3, 5] })).toBe("Mon, Wed, Fri");
  });
});

describe("streakLabel", () => {
  it("agrees with the number", () => {
    expect(streakLabel(1, "day")).toBe("1 day");
    expect(streakLabel(5, "day")).toBe("5 days");
    expect(streakLabel(1, "week")).toBe("1 week");
    expect(streakLabel(4, "week")).toBe("4 weeks");
  });
});

describe("targetLabel", () => {
  it("joins the number and its unit", () => {
    expect(targetLabel({ value: 8, unit: "glasses" })).toBe("8 glasses");
  });
});

describe("scheduleProblems", () => {
  it("has none for the default schedule", () => {
    expect(scheduleProblems(DEFAULT_SCHEDULE)).toEqual({});
  });

  it("wants a day for a weekdays habit", () => {
    expect(scheduleProblems({ ...DEFAULT_SCHEDULE, frequencyKind: "weekdays" }).weekdays).toBeDefined();
    expect(scheduleProblems({ ...DEFAULT_SCHEDULE, frequencyKind: "weekdays", weekdays: [2] })).toEqual({});
  });

  it.each(["", "0", "8", "2.5", "abc"])("refuses %j times a week", (timesPerWeek) => {
    expect(scheduleProblems({ ...DEFAULT_SCHEDULE, frequencyKind: "weekly", timesPerWeek }).timesPerWeek).toBeDefined();
  });

  it.each(["1", "7"])("accepts %s times a week", (timesPerWeek) => {
    expect(scheduleProblems({ ...DEFAULT_SCHEDULE, frequencyKind: "weekly", timesPerWeek })).toEqual({});
  });

  it("ignores the goal while nothing is counted", () => {
    expect(scheduleProblems({ ...DEFAULT_SCHEDULE, targetValue: "-4" })).toEqual({});
  });

  it.each(["", "0", "-1", "10001", "1.25", "x"])("refuses a goal of %j", (targetValue) => {
    expect(
      scheduleProblems({ ...DEFAULT_SCHEDULE, counted: true, targetValue, targetUnit: "km" }).targetValue,
    ).toBeDefined();
  });

  it("wants a unit no longer than twenty characters", () => {
    const counted = { ...DEFAULT_SCHEDULE, counted: true, targetValue: "5" };

    expect(scheduleProblems({ ...counted, targetUnit: " " }).targetUnit).toBeDefined();
    expect(scheduleProblems({ ...counted, targetUnit: "x".repeat(21) }).targetUnit).toBeDefined();
    expect(scheduleProblems({ ...counted, targetUnit: "km" })).toEqual({});
  });
});

describe("draftFrequency and draftTarget", () => {
  it("turn a draft into what the API takes", () => {
    expect(draftFrequency({ ...DEFAULT_SCHEDULE, frequencyKind: "weekdays", weekdays: [5, 1] }))
      .toEqual({ kind: "weekdays", days: [1, 5] });
    expect(draftFrequency({ ...DEFAULT_SCHEDULE, frequencyKind: "weekly", timesPerWeek: "2" }))
      .toEqual({ kind: "weekly", times: 2 });
    expect(draftFrequency(DEFAULT_SCHEDULE)).toEqual({ kind: "daily" });
    expect(draftTarget({ ...DEFAULT_SCHEDULE, counted: true, targetValue: "2.5", targetUnit: " km " }))
      .toEqual({ value: 2.5, unit: "km" });
    expect(draftTarget(DEFAULT_SCHEDULE)).toBeUndefined();
  });
});

describe("draftOf", () => {
  it("starts an edit from the habit as it is", () => {
    expect(
      draftOf({
        frequency: { kind: "weekdays", days: [2, 4] },
        target: { value: 5, unit: "km" },
        timeOfDay: "evening",
      }),
    ).toEqual({
      frequencyKind: "weekdays",
      weekdays: [2, 4],
      timesPerWeek: "3",
      counted: true,
      targetValue: "5",
      targetUnit: "km",
      timeOfDay: "evening",
    });
  });

  it("round-trips through the helpers without changing anything", () => {
    const habit = { frequency: { kind: "weekly" as const, times: 4 }, target: { value: 1.5, unit: "h" }, timeOfDay: "morning" as const };
    const draft = draftOf(habit);

    expect(sameFrequency(draftFrequency(draft), habit.frequency)).toBe(true);
    expect(sameTarget(draftTarget(draft), habit.target)).toBe(true);
  });
});

describe("sameFrequency and sameTarget", () => {
  it("tell rhythms and goals apart", () => {
    expect(sameFrequency({ kind: "daily" }, { kind: "weekly", times: 1 })).toBe(false);
    expect(sameFrequency({ kind: "weekly", times: 2 }, { kind: "weekly", times: 2 })).toBe(true);
    expect(sameTarget(undefined, undefined)).toBe(true);
    expect(sameTarget({ value: 1, unit: "a" }, undefined)).toBe(false);
  });
});
