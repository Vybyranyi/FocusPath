import { format, parse } from "date-fns";

/**
 * The client half of the date contract, mirroring `server/src/utils/dates.ts`.
 *
 * A calendar day is the user's *local* day — the one printed on the cell they
 * tapped. On the wire it travels as a bare `YYYY-MM-DD` key, never as a full
 * instant: the server parses that as midnight UTC, which is exactly how it
 * stores every scheduled day.
 *
 * The rule this file exists to enforce is that the two directions use different
 * accessors. A local Date is read with local getters; a timestamp that came
 * back from the server is already midnight UTC and must be read with UTC ones.
 * Mixing them is silent — `toISOString()` on a local midnight reports the
 * previous day everywhere east of Greenwich, which is how the day view spent a
 * release fetching and marking yesterday.
 */

/** The calendar day a local Date falls on, in the wire format. */
export const toDayKey = (value: Date): string => format(value, "yyyy-MM-dd");

/**
 * The day a server timestamp names. Midnight UTC read through local getters
 * lands on the previous day west of Greenwich, so this slices the ISO string
 * rather than going near a Date.
 */
export const dayKeyOf = (value: string): string => value.slice(0, 10);

/** Local midnight of a day key, for display and for the pickers. */
export const fromDayKey = (key: string): Date => parse(key, "yyyy-MM-dd", new Date());

export const todayKey = (): string => toDayKey(new Date());

/**
 * Day keys are zero-padded and fixed-width, so `<` and `>` on the strings order
 * them correctly. Comparing days needs no Date arithmetic at all.
 */
export const isBeforeDay = (key: string, other: string): boolean => key < other;
export const isAfterDay = (key: string, other: string): boolean => key > other;
