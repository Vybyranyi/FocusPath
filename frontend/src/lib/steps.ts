import type { StepDraft } from "@/types/forms";

/** Matches the server's cap: an unbounded list is copied into every response. */
export const MAX_STEPS = 20;
export const STEP_TITLE_MAX = 100;

/** Whether any row is too long to be accepted — for a form to block on. */
export const stepsProblem = (steps: StepDraft[]): string =>
  steps.some((step) => step.title.trim().length > STEP_TITLE_MAX)
    ? `Each step must be ${STEP_TITLE_MAX} characters or fewer`
    : "";
