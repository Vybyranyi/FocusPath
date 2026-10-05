import type { ReasonCode } from "@shared/index";

/** Five steps, lowest first. The faces are the labels people already know. */
export const MOODS = [
  { value: 1, face: "😞", label: "Awful" },
  { value: 2, face: "🙁", label: "Low" },
  { value: 3, face: "😐", label: "Okay" },
  { value: 4, face: "🙂", label: "Good" },
  { value: 5, face: "😄", label: "Great" },
] as const;

export const ENERGY_LEVELS = [
  { value: 1, label: "Drained" },
  { value: 2, label: "Tired" },
  { value: 3, label: "Steady" },
  { value: 4, label: "Energetic" },
  { value: 5, label: "Full of it" },
] as const;

/** The server's own limit on a day's words. */
export const JOURNAL_TEXT_MAX = 2000;

/** How long the entry waits after the last change before it is saved. */
export const JOURNAL_SAVE_DELAY_MS = 800;

export const moodFace = (mood?: number): string =>
  MOODS.find((entry) => entry.value === mood)?.face ?? "";

/**
 * Why a day was missed, in the words the question uses. A `Record` over the
 * union, so a reason added on the server and forgotten here is a type error
 * rather than a button that is not there.
 */
export const REASON_LABELS: Record<ReasonCode, string> = {
  no_time: "No time",
  forgot: "Forgot",
  no_energy: "No energy",
  ill: "Ill",
  circumstances: "Circumstances",
  didnt_want: "Didn't want to",
  other: "Something else",
};

/** In the order they are offered. */
export const REASON_CODES = Object.keys(REASON_LABELS) as ReasonCode[];

export const REASON_TEXT_MAX = 200;
export const NOTE_MAX = 280;
