import { useEffect, useRef, useState } from "react";
import type { HabitType, Target } from "@shared/index";
import { cn } from "@/lib/utils";

export interface ICounterControlProps {
  /** What the habit is called, so each button can say what it changes. */
  title: string;
  type: HabitType;
  target: Target;
  /** Absent until something has been counted. */
  value?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}

const MAX = 10_000;

/** One decimal place, as the server holds a day's value. */
const round = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number): number => Math.min(MAX, Math.max(0, round(value)));

/**
 * Counting a day, one tap at a time.
 *
 * A glass of water is marked with a thumb, not a form, so the common case is
 * plus and minus. The number in the middle is a button too: tapping it turns it
 * into a field, for the day that was fourteen kilometres. A `quit` habit has one
 * more thing to say before anything is counted — that the day was clean — and
 * that is zero, which is a statement and not the absence of one.
 */
export default function CounterControl({
  title,
  type,
  target,
  value,
  disabled,
  onChange,
}: ICounterControlProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const current = value ?? 0;
  const startEditing = () => {
    if (disabled) return;
    setDraft(String(current));
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const typed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(typed)) return;

    const next = clamp(typed);
    if (next !== current || value === undefined) onChange(next);
  };

  // The state this is working towards, so the number can say how it is going.
  const over = type === "quit" && current > target.value;
  const reached = type === "build" && current >= target.value;

  const stepper = cn(
    "w-11 h-11 flex items-center justify-center rounded-full cursor-pointer text-ink-2",
    "transition-colors duration-(--duration-fast) hover:bg-canvas",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
  );

  return (
    <div className="flex items-center gap-1 shrink-0">
      {type === "quit" && value === undefined && (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Mark ${title} a clean day`}
          onClick={() => onChange(0)}
          className={cn(
            "h-11 px-3 rounded-full chip cursor-pointer bg-success-soft text-success",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          Clean day
        </button>
      )}

      <button
        type="button"
        aria-label={`One less ${target.unit} for ${title}`}
        disabled={disabled || current <= 0}
        onClick={() => onChange(clamp(current - 1))}
        className={stepper}
      >
        −
      </button>

      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.1"
          aria-label={`${target.unit} for ${title}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") setEditing(false);
          }}
          className="w-16 h-9 rounded-lg bg-surface-2 text-center text-xs text-ink border border-accent"
        />
      ) : (
        <button
          type="button"
          aria-label={`Set ${target.unit} for ${title}`}
          disabled={disabled}
          onClick={startEditing}
          className={cn(
            "min-w-16 px-1 py-1 rounded-lg cursor-pointer text-center",
            "disabled:cursor-not-allowed",
          )}
        >
          <span
            className={cn(
              "body-bold block leading-tight",
              over && "text-danger",
              reached && "text-success",
            )}
          >
            {current} / {target.value}
          </span>
          <span className="chip block text-ink-muted leading-tight">{target.unit}</span>
        </button>
      )}

      <button
        type="button"
        aria-label={`One more ${target.unit} for ${title}`}
        disabled={disabled}
        onClick={() => onChange(clamp(current + 1))}
        className={stepper}
      >
        +
      </button>
    </div>
  );
}
