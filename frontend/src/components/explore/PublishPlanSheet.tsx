import { useState } from "react";
import type { HabitSummary, PlanCategory } from "@shared/index";
import Button from "@components/ui/Button";
import Input from "@components/ui/Input";
import Modal from "@components/ui/Modal";
import CategoryPicker from "@components/pickers/CategoryPicker";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { publishPlan } from "@store/plansSlice";
import { useToast } from "@hooks/useToast";
import { isPlanCategory } from "@/lib/planCategories";

export interface IPublishPlanSheetProps {
  habit: Pick<HabitSummary, "_id" | "title" | "sessions" | "category">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the plan exists, so whatever opened this can close itself. */
  onPublished?: () => void;
}

/**
 * Publishing a habit as a plan.
 *
 * The sheet sends only the habit id, a category and, if the author asks for it,
 * a name — everything else is read from the habit on the server. Two things are
 * therefore worth saying here rather than leaving to be discovered: the content
 * is frozen at this moment, and the author is anonymous unless they choose not
 * to be.
 */
export default function PublishPlanSheet({
  habit,
  open,
  onOpenChange,
  onPublished,
}: IPublishPlanSheetProps) {
  const dispatch = useAppDispatch();
  const { notify } = useToast();
  const publishing = useAppSelector((state) => state.plans.publishing);
  const error = useAppSelector((state) => state.plans.error);
  const storedName = useAppSelector((state) => state.auth.user?.displayName ?? "");

  const [category, setCategory] = useState<PlanCategory | undefined>(
    habit.category && isPlanCategory(habit.category) ? habit.category : undefined,
  );
  const [displayName, setDisplayName] = useState(storedName);
  const [signed, setSigned] = useState(Boolean(storedName));
  // The category is required, but saying so before anyone has tried to publish
  // is scolding someone for not having filled in a form they just opened.
  const [attempted, setAttempted] = useState(false);

  const handlePublish = async () => {
    setAttempted(true);
    if (!category) return;

    try {
      await dispatch(
        publishPlan({
          habitId: habit._id,
          category,
          displayName: signed && displayName.trim() ? displayName.trim() : undefined,
        }),
      ).unwrap();

      // Deliberately does not go to the new plan. Publishing is something you
      // do *to* a habit while you are busy with something else; being thrown
      // onto a library page afterwards loses your place to show you a page you
      // did not ask for. The toast says it worked and names where it went.
      notify(`“${habit.title}” is in Explore now`);
      onOpenChange(false);
      onPublished?.();
    } catch {
      // The reason — including a moderator's verdict — is in the store below.
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Publish as a plan"
      description={`A copy of “${habit.title}” — all ${habit.sessions} sessions — goes into the public library.`}
    >
      <CategoryPicker
        value={category}
        onChange={setCategory}
        error={attempted && !category ? "Pick a category so people can find it" : ""}
      />

      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={signed}
            onChange={(event) => setSigned(event.target.checked)}
            className="mt-1 w-5 h-5 accent-[var(--accent)] cursor-pointer"
          />
          <span className="body-light text-ink-2">
            Sign it with a name. Leave this off and the plan is published
            anonymously — your real name, email and profile are never shown
            either way.
          </span>
        </label>

        {signed && (
          <Input
            label="Name on the plan"
            placeholder="How you want to be credited"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onClear={() => setDisplayName("")}
          />
        )}
      </div>

      <p className="alternative text-ink-muted">
        The days are frozen as they are now. You can still edit the title,
        description and category later — for different days, publish a new plan.
      </p>

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
          disabled={publishing}
          onClick={handlePublish}
        >
          {publishing ? "Checking…" : "Publish"}
        </Button>
      </div>
    </Modal>
  );
}
