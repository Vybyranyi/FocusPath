import type { HabitType } from "@shared/index";
import type { ScheduleDraft } from "@/lib/schedule";

/**
 * A step while it is being written. `_id` is present only for a step the habit
 * already has, so an edit can rename it without losing the days it was ticked.
 */
export interface StepDraft {
  _id?: string;
  title: string;
}

/**
 * What the create-habit form holds while it is being filled in.
 *
 * Deliberately not the API's `Habit`: the field names follow the labels on
 * screen, the duration is the string an <input> gives back, and the start date
 * is undefined until something is picked. Conflating the two is what previously
 * let the store be typed as the form while holding API payloads.
 */
export interface CreateHabitFormValues {
  color: string;
  emoji: string;
  habitName: string;
  habitDescription: string;
  /**
   * A `PlanCategory`, or empty while nothing is chosen. Optional on a habit —
   * it only becomes required when one is published as a plan, and the publish
   * sheet asks for it then.
   */
  category: string;
  /** The daily checklist, one row per step. Blank rows are dropped on submit. */
  steps: StepDraft[];
  startDate: Date | undefined;
  /**
   * The "let AI choose the number of sessions" switch — nothing more. Which
   * button submitted the form is not form state.
   */
  autoDuration: boolean;
  /** The programme's length in sessions, as typed. Unused when the habit has no end. */
  duration: string;
  /** A habit with no end: no programme, so nothing for the AI to write either. */
  noEnd: boolean;
  /** How often, how much, and when in the day. */
  schedule: ScheduleDraft;
  habitType: HabitType;
}
