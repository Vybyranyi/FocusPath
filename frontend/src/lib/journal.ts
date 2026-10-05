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
