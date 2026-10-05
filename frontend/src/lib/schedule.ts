import type { Frequency, Target, TimeOfDay } from "@shared/index";

/** Monday first, matching the server's 1 = Monday … 7 = Sunday. */
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** One of three words for a rhythm; the rest of the app says it the same way. */
export const frequencyLabel = (frequency: Frequency): string => {
  if (frequency.kind === "weekdays") {
    return frequency.days.map((day) => WEEKDAY_SHORT[day - 1]).join(", ");
  }
  if (frequency.kind === "weekly") {
    return `${frequency.times}× a week`;
  }
  return "Every day";
};

export const targetLabel = (target: Target): string => `${target.value} ${target.unit}`;

/** The parts of the day, in the order they are shown. */
export const TIMES_OF_DAY: ReadonlyArray<{ value: TimeOfDay; label: string }> = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "anytime", label: "Anytime" },
];

/** What a streak counts, with the right number: "1 day", "4 weeks". */
export const streakLabel = (value: number, unit: "day" | "week"): string =>
  `${value} ${unit}${value === 1 ? "" : "s"}`;
