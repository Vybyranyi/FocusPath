import { useState } from "react";
import type { HabitSummary, ReasonCode } from "@shared/index";
import Button from "@components/ui/Button";
import Modal from "@components/ui/Modal";
import { useAppDispatch } from "@store/hooks";
import { saveFailureReason } from "@store/habitSlice";
import { setPreferences } from "@store/authSlice";
import { REASON_CODES, REASON_LABELS, REASON_TEXT_MAX } from "@/lib/journal";
import { cn } from "@/lib/utils";

export interface IReasonSheetProps {
  habit: Pick<HabitSummary, "_id" | "title">;
  /** The day the failure is on, as the server named it. */
  date: string;
  /** What is already recorded, when the sheet is opened to change it. */
  current?: { code: ReasonCode; text?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Why not?", asked once, right after a habit is marked failed.
 *
 * The moment matters: the reason is known when it happens and forgotten by the
 * next morning. Seven choices rather than a text box, because a closed list is
 * what can be counted — what the coach will read is how often "no energy" came
 * before a lapse, not what anyone wrote.
 *
 * Closing it without answering counts as setting it aside: it records that the
 * question was asked, so it is not put again for the same day.
 */
export default function ReasonSheet({ habit, date, current, open, onOpenChange }: IReasonSheetProps) {
  const dispatch = useAppDispatch();
  const [code, setCode] = useState<ReasonCode | null>(current?.code ?? null);
  const [text, setText] = useState(current?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once an answer is on its way, so closing the sheet afterwards is not
  // mistaken for walking away from it.
  const [answered, setAnswered] = useState(false);

  const send = async (reason: { code: ReasonCode; text?: string } | { skipped: true }) => {
    setSaving(true);
    setError(null);
    try {
      await dispatch(saveFailureReason({ habitId: habit._id, date, reason })).unwrap();
      setAnswered(true);
      onOpenChange(false);
    } catch (reasonForFailure) {
      setError(typeof reasonForFailure === "string" ? reasonForFailure : "Could not save the reason");
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!code) return;
    const words = text.trim();
    void send({ code, ...(words ? { text: words } : {}) });
  };

  const stopAsking = async () => {
    await dispatch(setPreferences({ askFailureReason: false }));
    await send({ skipped: true });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !answered && !saving) void send({ skipped: true });
        else onOpenChange(next);
      }}
      title="What got in the way?"
      description={`“${habit.title}” was not done. Only you see this — it helps spot what keeps repeating.`}
    >
      <div role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-2">
        {REASON_CODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={code === option}
            onClick={() => setCode(option)}
            className={cn(
              "min-h-11 px-4 rounded-full chip cursor-pointer",
              "transition-colors duration-(--duration-fast)",
              code === option ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-2 hover:bg-line",
            )}
          >
            {REASON_LABELS[option]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="reason-words" className="field-label">A few words (optional)</label>
        <input
          id="reason-words"
          type="text"
          maxLength={REASON_TEXT_MAX}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-11 rounded-xl bg-surface-2 px-3 text-xs text-ink border border-transparent focus:border-accent focus:bg-surface"
        />
      </div>

      {error && (
        <p role="alert" className="alternative text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="outline" size="medium" disabled={saving} onClick={() => void send({ skipped: true })}>
          Skip
        </Button>
        <Button type="primary" size="medium" disabled={saving || !code} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void stopAsking()}
        className="self-start min-h-11 alternative text-ink-muted cursor-pointer"
      >
        Don’t ask me again
      </button>
    </Modal>
  );
}
