import { describe, expect, it } from "vitest";
import { isDone, isOff, isSettled, isWeekMet } from "@/lib/habitStatus";

describe("isDone", () => {
  it("counts only a finished day", () => {
    expect(isDone({ state: "done" })).toBe(true);
    for (const state of ["failed", "pending", "missed", "paused", "rest"] as const) {
      expect(isDone({ state })).toBe(false);
    }
  });
});

describe("isWeekMet", () => {
  it("is true once the week's slots are filled, and not before", () => {
    expect(isWeekMet({ week: { done: 3, target: 3 } })).toBe(true);
    expect(isWeekMet({ week: { done: 2, target: 3 } })).toBe(false);
  });

  it("is false for a habit that is not weekly", () => {
    expect(isWeekMet({})).toBe(false);
  });

  it("is not met by a week that asks nothing", () => {
    expect(isWeekMet({ week: { done: 0, target: 0 } })).toBe(false);
  });
});

describe("isSettled", () => {
  it("is done, or a weekly habit whose week is met", () => {
    expect(isSettled({ state: "done" })).toBe(true);
    expect(isSettled({ state: "pending", week: { done: 2, target: 2 } })).toBe(true);
    expect(isSettled({ state: "pending", week: { done: 1, target: 2 } })).toBe(false);
    expect(isSettled({ state: "failed" })).toBe(false);
  });
});

describe("isOff", () => {
  it("is a pause or a rest day, and nothing else", () => {
    expect(isOff({ state: "paused" })).toBe(true);
    expect(isOff({ state: "rest" })).toBe(true);
    expect(isOff({ state: "missed" })).toBe(false);
    expect(isOff({ state: "pending" })).toBe(false);
  });
});
