import { afterEach, describe, expect, it } from "vitest";
import { dayKeyOf, fromDayKey, isAfterDay, isBeforeDay, toDayKey, todayKey } from "@/lib/dates";

const SUITE_TZ = process.env.TZ;

afterEach(() => {
  process.env.TZ = SUITE_TZ;
});

/**
 * Every case runs in three zones on purpose. Under UTC this whole family of
 * bugs is invisible — local midnight and midnight UTC are the same instant, so
 * converting between them does nothing. It only shows up either side of it.
 */
const ZONES = ["UTC", "Europe/Kyiv", "America/New_York"] as const;

const inZone = (zone: string, run: () => void) => {
  process.env.TZ = zone;
  run();
};

describe("toDayKey", () => {
  it.each(ZONES)("names the local calendar day in %s", (zone) => {
    inZone(zone, () => {
      expect(toDayKey(new Date(2026, 7, 7))).toBe("2026-08-07");
      expect(toDayKey(new Date(2026, 7, 7, 23, 59, 59))).toBe("2026-08-07");
      expect(toDayKey(new Date(2026, 7, 7, 0, 0, 0))).toBe("2026-08-07");
    });
  });

  it.each(ZONES)("pads single-digit months and days in %s", (zone) => {
    inZone(zone, () => {
      expect(toDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    });
  });
});

describe("dayKeyOf", () => {
  it.each(ZONES)("names the day a server timestamp holds in %s", (zone) => {
    inZone(zone, () => {
      expect(dayKeyOf("2026-08-07T00:00:00.000Z")).toBe("2026-08-07");
    });
  });

  /**
   * The defect this replaced: `new Date(utcMidnight)` read with local getters
   * is the previous day west of Greenwich and the same day east of it, so the
   * bug only appeared for half the world.
   */
  it.each(ZONES)("does not drift the way local getters do in %s", (zone) => {
    inZone(zone, () => {
      const localReading = new Date("2026-08-07T00:00:00.000Z").getDate();
      const key = dayKeyOf("2026-08-07T00:00:00.000Z");

      expect(key).toBe("2026-08-07");
      // Proof the naive reading really does differ somewhere.
      if (zone === "America/New_York") expect(localReading).toBe(6);
    });
  });
});

describe("round trip", () => {
  it.each(ZONES)("survives Date to key to Date in %s", (zone) => {
    inZone(zone, () => {
      const key = "2026-08-07";

      expect(toDayKey(fromDayKey(key))).toBe(key);
    });
  });

  it.each(ZONES)("puts a key at local midnight in %s", (zone) => {
    inZone(zone, () => {
      const parsed = fromDayKey("2026-08-07");

      expect(parsed.getHours()).toBe(0);
      expect(parsed.getDate()).toBe(7);
    });
  });
});

describe("comparison", () => {
  it("orders keys as strings, since they are fixed-width", () => {
    expect(isBeforeDay("2026-08-07", "2026-08-08")).toBe(true);
    expect(isAfterDay("2026-08-08", "2026-08-07")).toBe(true);
    expect(isBeforeDay("2026-08-07", "2026-08-07")).toBe(false);
  });

  it("orders across month and year boundaries", () => {
    expect(isBeforeDay("2026-08-31", "2026-09-01")).toBe(true);
    expect(isBeforeDay("2026-12-31", "2027-01-01")).toBe(true);
  });
});

describe("todayKey", () => {
  it.each(ZONES)("agrees with toDayKey of now in %s", (zone) => {
    inZone(zone, () => {
      expect(todayKey()).toBe(toDayKey(new Date()));
    });
  });
});
