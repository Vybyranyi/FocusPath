import { describe, expect, it } from "vitest";
import { describeRule, offerHeadline, pickTopCard } from "@/lib/coach";
import { makeCoachCard, makeOffer } from "../testUtils";

const NOW = new Date("2026-03-18T10:00:00.000Z").getTime();
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe("pickTopCard", () => {
  it("is nothing when there is nothing", () => {
    expect(pickTopCard([], NOW)).toBeNull();
  });

  it("puts an offer ahead of a review ahead of an insight", () => {
    const insight = makeCoachCard({ _id: "i", kind: "insight", createdAt: daysAgo(0) });
    const review = makeCoachCard({ _id: "r", kind: "weekly_review", createdAt: daysAgo(1) });
    const offer = makeOffer({ _id: "o", createdAt: daysAgo(3) });

    expect(pickTopCard([insight, review, offer], NOW)?._id).toBe("o");
    expect(pickTopCard([insight, review], NOW)?._id).toBe("r");
    expect(pickTopCard([insight], NOW)?._id).toBe("i");
  });

  it("takes the newest of one kind", () => {
    const older = makeCoachCard({ _id: "old", createdAt: daysAgo(4) });
    const newer = makeCoachCard({ _id: "new", createdAt: daysAgo(1) });

    expect(pickTopCard([older, newer], NOW)?._id).toBe("new");
  });

  it("passes over a card that has been dismissed, applied or could not be written", () => {
    for (const status of ["dismissed", "applied", "failed"] as const) {
      expect(pickTopCard([makeCoachCard({ status, createdAt: daysAgo(0) })], NOW)).toBeNull();
    }
  });

  it("shows an offer before it has been opened", () => {
    expect(pickTopCard([makeOffer({ createdAt: daysAgo(0) })], NOW)?.status).toBe("candidate");
  });

  it("lets an old card go rather than pin it above every day for ever", () => {
    expect(pickTopCard([makeCoachCard({ kind: "weekly_review", createdAt: daysAgo(8) })], NOW)).toBeNull();
    expect(pickTopCard([makeCoachCard({ kind: "insight", createdAt: daysAgo(3) })], NOW)).toBeNull();
    expect(pickTopCard([makeOffer({ createdAt: daysAgo(8) })], NOW)).toBeNull();
  });

  it("keeps a review for a week and an insight for two days", () => {
    expect(pickTopCard([makeCoachCard({ kind: "weekly_review", createdAt: daysAgo(6) })], NOW)).not.toBeNull();
    expect(pickTopCard([makeCoachCard({ kind: "insight", createdAt: daysAgo(1) })], NOW)).not.toBeNull();
  });
});

describe("describeRule", () => {
  it("says the rhythm, and the goal when there is one", () => {
    expect(describeRule({ frequency: { kind: "daily" } })).toBe("Every day");
    expect(describeRule({ frequency: { kind: "weekly", times: 5 } })).toBe("5× a week");
    expect(describeRule({ frequency: { kind: "daily" }, target: { value: 6, unit: "glasses" } })).toBe("Every day · 6 glasses");
  });
});

describe("offerHeadline", () => {
  it("names the habit", () => {
    expect(offerHeadline(makeOffer())).toBe("Make “Read” easier?");
  });
});
