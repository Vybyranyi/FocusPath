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

/** Largest quantity a day may hold; the server's own limit. */
export const MAX_TARGET = 10_000;
export const UNIT_MAX = 20;

/**
 * A schedule while it is being written: what the form fields hold, as the
 * strings an `<input>` gives back. Kept apart from `Frequency` and `Target`
 * because those cannot represent a half-filled form — "weekdays, none chosen
 * yet" is not a valid frequency, but it is a state the form passes through.
 */
export interface ScheduleDraft {
  frequencyKind: Frequency["kind"];
  /** 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  timesPerWeek: string;
  /** Whether the habit counts a quantity per day. */
  counted: boolean;
  targetValue: string;
  targetUnit: string;
  timeOfDay: TimeOfDay;
}

export const DEFAULT_SCHEDULE: ScheduleDraft = {
  frequencyKind: "daily",
  weekdays: [],
  timesPerWeek: "3",
  counted: false,
  targetValue: "",
  targetUnit: "",
  timeOfDay: "anytime",
};

/** The draft for a habit that already exists, so an edit starts from what it is now. */
export const draftOf = (habit: {
  frequency: Frequency;
  target?: Target;
  timeOfDay: TimeOfDay;
}): ScheduleDraft => ({
  frequencyKind: habit.frequency.kind,
  weekdays: habit.frequency.kind === "weekdays" ? [...habit.frequency.days] : [],
  timesPerWeek: habit.frequency.kind === "weekly" ? String(habit.frequency.times) : "3",
  counted: Boolean(habit.target),
  targetValue: habit.target ? String(habit.target.value) : "",
  targetUnit: habit.target?.unit ?? "",
  timeOfDay: habit.timeOfDay,
});

const oneDecimal = (value: number): boolean => Math.round(value * 10) / 10 === value;

export interface ScheduleProblems {
  weekdays?: string;
  timesPerWeek?: string;
  targetValue?: string;
  targetUnit?: string;
}

/** What is wrong with a draft, field by field. Empty when it can be sent. */
export const scheduleProblems = (draft: ScheduleDraft): ScheduleProblems => {
  const problems: ScheduleProblems = {};
  // Formik turns every empty string in its values into `undefined` before it
  // validates, so a field the person has not filled in arrives missing rather
  // than empty.
  const timesPerWeek = draft.timesPerWeek ?? "";
  const targetValue = draft.targetValue ?? "";
  const targetUnit = draft.targetUnit ?? "";

  if (draft.frequencyKind === "weekdays" && draft.weekdays.length === 0) {
    problems.weekdays = "Choose at least one day";
  }

  if (draft.frequencyKind === "weekly") {
    const times = Number(timesPerWeek);
    if (!/^\d+$/.test(timesPerWeek) || times < 1 || times > 7) {
      problems.timesPerWeek = "Must be a whole number from 1 to 7";
    }
  }

  if (draft.counted) {
    const value = Number(targetValue);
    if (targetValue.trim() === "" || !Number.isFinite(value) || value <= 0) {
      problems.targetValue = "Must be greater than zero";
    } else if (value > MAX_TARGET) {
      problems.targetValue = `Must be at most ${MAX_TARGET}`;
    } else if (!oneDecimal(value)) {
      problems.targetValue = "One decimal place at most";
    }

    const unit = targetUnit.trim();
    if (!unit) problems.targetUnit = "Required";
    else if (unit.length > UNIT_MAX) problems.targetUnit = `Must be ${UNIT_MAX} characters or fewer`;
  }

  return problems;
};

export const draftFrequency = (draft: ScheduleDraft): Frequency => {
  if (draft.frequencyKind === "weekdays") {
    return { kind: "weekdays", days: [...draft.weekdays].sort((a, b) => a - b) };
  }
  if (draft.frequencyKind === "weekly") {
    return { kind: "weekly", times: Number(draft.timesPerWeek) };
  }
  return { kind: "daily" };
};

/** The target the draft describes, or `undefined` when the habit is not counted. */
export const draftTarget = (draft: ScheduleDraft): Target | undefined =>
  draft.counted
    ? { value: Number(draft.targetValue), unit: draft.targetUnit.trim() }
    : undefined;

/** Whether two frequencies describe the same rhythm. */
export const sameFrequency = (a: Frequency, b: Frequency): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const sameTarget = (a?: Target, b?: Target): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
