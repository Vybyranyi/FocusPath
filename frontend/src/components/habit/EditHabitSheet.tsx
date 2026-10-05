import { useState } from "react";
import type { HabitSummary } from "@shared/index";
import Button from "@components/ui/Button";
import Input from "@components/ui/Input";
import Modal from "@components/ui/Modal";
import CategoryPicker from "@components/pickers/CategoryPicker";
import ColorPicker from "@components/pickers/ColorPicker";
import EmojiPicker from "@components/pickers/EmojiPicker";
import StepsEditor from "@components/habit/StepsEditor";
import { stepsProblem } from "@/lib/steps";
import type { StepDraft } from "@/types/forms";
import { useAppDispatch } from "@store/hooks";
import { renameHabitDay, updateHabit, type HabitChanges } from "@store/habitSlice";
import { useToast } from "@hooks/useToast";
import { dayKeyOf, fromDayKey } from "@/lib/dates";
import { format } from "date-fns";

export interface IEditHabitSheetProps {
  habit: HabitSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;
const DAY_TITLE_MAX = 200;

/**
 * Editing a habit.
 *
 * The server has accepted `PUT /habits/:id` and `PATCH /habits/:id/day` since
 * the first release, and nothing in the client ever called either: a typo in a
 * habit's name, or an AI-written task that did not fit, stayed for the whole
 * run. This is that missing half.
 *
 * Only what changed is sent. Sending every field would reschedule on every
 * save — the server rebuilds the plan whenever a length arrives — and would
 * quietly take a clone out of its plan's score over a colour change.
 *
 * The start date is not offered. Moving it on a habit already under way slides
 * every mark to a different calendar day, which is correct by the schedule's
 * own rule and baffling to anyone looking at last week.
 */
export default function EditHabitSheet({ habit, open, onOpenChange }: IEditHabitSheetProps) {
  const dispatch = useAppDispatch();
  const { notify } = useToast();

  const [title, setTitle] = useState(habit.title);
  const [description, setDescription] = useState(habit.description ?? "");
  const [category, setCategory] = useState(habit.category ?? "");
  const [icon, setIcon] = useState(habit.icon);
  const [color, setColor] = useState(habit.color);
  const [sessions, setSessions] = useState(String(habit.sessions ?? ""));
  const [dayTitle, setDayTitle] = useState(habit.day.session?.title ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(
    (habit.steps ?? []).map((step) => ({ _id: step._id, title: step.title })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedDayTitle = dayTitle.trim();
  const parsedSessions = Number(sessions);

  const titleProblem = !trimmedTitle
    ? "Required"
    : trimmedTitle.length > TITLE_MAX
      ? `Must be ${TITLE_MAX} characters or fewer`
      : "";
  const descriptionProblem =
    description.trim().length > DESCRIPTION_MAX
      ? `Must be ${DESCRIPTION_MAX} characters or fewer`
      : "";
  // Only a programme has a length to edit; a habit with no end is not given one.
  const sessionsProblem =
    habit.sessions !== undefined &&
    (!/^\d+$/.test(sessions) || parsedSessions < 1 || parsedSessions > 365)
      ? "Must be a whole number of sessions, 1–365"
      : "";
  const dayTitleProblem = habit.day.session && !trimmedDayTitle
    ? "Required"
    : trimmedDayTitle.length > DAY_TITLE_MAX
      ? `Must be ${DAY_TITLE_MAX} characters or fewer`
      : "";

  const invalid = Boolean(
    titleProblem || descriptionProblem || sessionsProblem || dayTitleProblem || stepsProblem(steps),
  );

  // Blank rows are what "add step" leaves behind; they are not steps.
  const cleanedSteps = steps
    .map((step) => ({ ...step, title: step.title.trim() }))
    .filter((step) => step.title);
  const originalSteps = habit.steps ?? [];
  const stepsChanged =
    cleanedSteps.length !== originalSteps.length ||
    cleanedSteps.some(
      (step, index) => step._id !== originalSteps[index]._id || step.title !== originalSteps[index].title,
    );

  const changes: HabitChanges = {};
  if (trimmedTitle !== habit.title) changes.title = trimmedTitle;
  if (description.trim() !== (habit.description ?? "")) changes.description = description.trim();
  if (category !== (habit.category ?? "")) changes.category = category;
  if (icon !== habit.icon) changes.icon = icon;
  if (color !== habit.color) changes.color = color;
  if (habit.sessions !== undefined && !sessionsProblem && parsedSessions !== habit.sessions) {
    changes.sessions = parsedSessions;
  }
  if (stepsChanged) {
    // An existing step travels with its id, so renaming it keeps its ticks.
    changes.steps = cleanedSteps.map(({ _id, title: stepTitle }) => (_id ? { _id, title: stepTitle } : { title: stepTitle }));
  }

  const renamesDay =
    habit.day.session !== undefined && trimmedDayTitle !== habit.day.session.title;
  const hasChanges = Object.keys(changes).length > 0 || renamesDay;

  const shortens =
    changes.sessions !== undefined && habit.sessions !== undefined && changes.sessions < habit.sessions;
  const leavesPlanScore =
    Boolean(habit.fromPlanId) && (changes.sessions !== undefined || renamesDay);

  const dayLabel = format(fromDayKey(dayKeyOf(habit.day.date)), "EEEE, MMM d");

  const handleSave = async () => {
    if (invalid || !hasChanges) return;

    setSaving(true);
    setError(null);
    try {
      if (Object.keys(changes).length > 0) {
        await dispatch(updateHabit({ habitId: habit._id, changes })).unwrap();
      }
      // After the update, not beside it: a rename of the habit rewrites the
      // days still titled after it, and this day may be one of them. Sent
      // second, the user's own words for the day are what is left standing.
      if (renamesDay && habit.day.session) {
        await dispatch(
          renameHabitDay({ habitId: habit._id, session: habit.day.session.index, title: trimmedDayTitle }),
        ).unwrap();
      }
      notify(`Saved “${trimmedTitle}”`);
      onOpenChange(false);
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not save the changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Edit habit"
      description="Change how this habit looks, how long it runs, or this day's task."
    >
      <Input
        label="Habit name"
        placeholder="Enter habit name"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={titleProblem}
      />

      <Input
        label="Description"
        placeholder="Describe your habit"
        type="text"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        error={descriptionProblem}
      />

      {habit.day.session && (
        <Input
          label={`Task for ${dayLabel}`}
          placeholder="What this session asks of you"
          type="text"
          value={dayTitle}
          onChange={(event) => setDayTitle(event.target.value)}
          error={dayTitleProblem}
        />
      )}

      <StepsEditor steps={steps} onChange={setSteps} />

      <CategoryPicker value={category} onChange={setCategory} />
      <EmojiPicker value={icon} onChange={setIcon} />
      <ColorPicker value={color} onChange={setColor} />

      {habit.sessions !== undefined && (
        <Input
          label="Length in sessions"
          placeholder={String(habit.sessions)}
          type="text"
          value={sessions}
          onChange={(event) => setSessions(event.target.value)}
          error={sessionsProblem}
        />
      )}

      {shortens && (
        <p className="alternative text-warning">
          Sessions past number {changes.sessions} are removed from the programme.
        </p>
      )}

      {leavesPlanScore && (
        <p className="alternative text-warning">
          This habit came from the library. A different length or a rewritten
          task makes it a different route, so it stops counting towards that
          plan’s score.
        </p>
      )}

      {error && (
        <p role="alert" className="alternative text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="outline" size="medium" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="primary"
          size="medium"
          disabled={saving || invalid || !hasChanges}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
