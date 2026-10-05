import { useState } from "react";
import { addDays } from "date-fns";
import type { HabitSummary } from "@shared/index";
import Button from "@components/ui/Button";
import Input from "@components/ui/Input";
import Modal from "@components/ui/Modal";
import { useAppDispatch } from "@store/hooks";
import { addPause } from "@store/habitSlice";
import { useToast } from "@hooks/useToast";
import { dayKeyOf, fromDayKey, toDayKey, todayKey } from "@/lib/dates";

export interface IPauseSheetProps {
  habit: HabitSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_DAYS = 365;

/**
 * Pausing a habit from today.
 *
 * A pause is days that do not count: they are not missed, they do not break the
 * streak, and a programme's end moves out by exactly as many. It always starts
 * today — the server refuses one in the past, or any bad day could be turned
 * into a day off afterwards — so the only question is how long. Left empty it
 * is open, and ends when the person says so.
 */
export default function PauseSheet({ habit, open, onOpenChange }: IPauseSheetProps) {
  const dispatch = useAppDispatch();
  const { notify } = useToast();

  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = Number(days);
  const problem =
    days.trim() !== "" && (!/^\d+$/.test(days) || count < 1 || count > MAX_DAYS)
      ? `Must be a whole number of days, 1–${MAX_DAYS}`
      : "";

  const handlePause = async () => {
    if (problem) return;

    const from = todayKey();
    const to = days.trim() === "" ? undefined : toDayKey(addDays(fromDayKey(from), count - 1));

    setSaving(true);
    setError(null);
    try {
      await dispatch(
        addPause({ habitId: habit._id, day: dayKeyOf(habit.day.date), from, to }),
      ).unwrap();
      notify(`“${habit.title}” is paused`);
      onOpenChange(false);
    } catch (reason) {
      setError(typeof reason === "string" ? reason : "Could not pause the habit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Pause “${habit.title}”`}
      description="Paused days are not missed and do not break your streak."
    >
      <Input
        label="For how many days (optional)"
        placeholder="Leave empty to pause until you resume"
        type="text"
        value={days}
        onChange={(event) => setDays(event.target.value)}
        error={problem}
      />

      <p className="alternative text-ink-muted">
        {habit.sessions !== undefined
          ? "The end of the programme moves out by the days you are away."
          : "Nothing is owed for these days when you come back."}
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
          disabled={saving || Boolean(problem)}
          onClick={handlePause}
        >
          {saving ? "Pausing…" : "Pause"}
        </Button>
      </div>
    </Modal>
  );
}
