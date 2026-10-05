import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalEntry } from "@shared/index";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { saveJournalEntry, type JournalDraft } from "@store/journalSlice";
import {
  ENERGY_LEVELS,
  JOURNAL_SAVE_DELAY_MS,
  JOURNAL_TEXT_MAX,
  MOODS,
} from "@/lib/journal";
import { cn } from "@/lib/utils";

export interface IJournalCardProps {
  /** The day this card is for, as a day key. The card is keyed by it. */
  day: string;
  entry: JournalEntry | null;
}

const toDraft = (entry: JournalEntry | null): JournalDraft => ({
  mood: entry?.mood,
  energy: entry?.energy,
  text: entry?.text,
});

/**
 * How the day went as a whole: a mood, an energy, a few words.
 *
 * It saves itself. A journal that asks to be submitted is one more thing to do
 * at the end of the day, and the entries that matter are the ones written on a
 * bad evening — so the card keeps what is typed, after a short pause, and says
 * so. Nothing in it is required; an entry emptied out is simply deleted.
 *
 * Mounted per day (`key={day}`): leaving a day with changes still waiting sends
 * them on the way out rather than dropping them.
 */
export default function JournalCard({ day, entry }: IJournalCardProps) {
  const dispatch = useAppDispatch();
  const { save, saveError } = useAppSelector((state) => state.journal);

  const [draft, setDraft] = useState<JournalDraft>(() => toDraft(entry));
  const [writing, setWriting] = useState(Boolean(entry?.text));

  const pending = useRef<JournalDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const send = useCallback(
    (next: JournalDraft) => {
      pending.current = null;
      void dispatch(saveJournalEntry({ day, ...next }));
    },
    [dispatch, day],
  );
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const change = (patch: Partial<JournalDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => sendRef.current(next), JOURNAL_SAVE_DELAY_MS);
  };

  // Leaving the day with words still waiting must not lose them.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current) sendRef.current(pending.current);
    },
    [],
  );

  const text = draft.text ?? "";

  return (
    <section
      aria-label="Your day"
      className="bg-surface rounded-2xl ring-card p-5 flex flex-col gap-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="title font-bold">How was your day?</h2>
        <p
          role="status"
          className={cn("alternative", save === "error" ? "text-danger" : "text-ink-muted")}
        >
          {save === "saving" && "Saving…"}
          {save === "saved" && "Saved"}
          {save === "error" && (saveError ?? "Could not save")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="field-label" id={`mood-${day}`}>Mood</p>
        <div role="radiogroup" aria-labelledby={`mood-${day}`} className="flex gap-2">
          {MOODS.map(({ value, face, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={draft.mood === value}
              aria-label={`${label} (${value} of 5)`}
              // Tapping the chosen one again takes it back.
              onClick={() => change({ mood: draft.mood === value ? undefined : value })}
              className={cn(
                "flex-1 min-h-11 rounded-xl text-xl cursor-pointer",
                "transition-colors duration-(--duration-fast)",
                draft.mood === value ? "bg-accent-soft ring-1 ring-accent" : "bg-surface-2 hover:bg-line",
              )}
            >
              <span aria-hidden>{face}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="field-label" id={`energy-${day}`}>Energy</p>
        <div role="radiogroup" aria-labelledby={`energy-${day}`} className="flex gap-2">
          {ENERGY_LEVELS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={draft.energy === value}
              aria-label={`${label} (${value} of 5)`}
              onClick={() => change({ energy: draft.energy === value ? undefined : value })}
              className={cn(
                "flex-1 min-h-11 rounded-xl chip cursor-pointer",
                "transition-colors duration-(--duration-fast)",
                draft.energy === value ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-2 hover:bg-line",
              )}
            >
              <span aria-hidden>{value}</span>
            </button>
          ))}
        </div>
      </div>

      {writing ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`words-${day}`} className="field-label">A few words</label>
          <textarea
            id={`words-${day}`}
            rows={4}
            maxLength={JOURNAL_TEXT_MAX}
            value={text}
            onChange={(event) => change({ text: event.target.value || undefined })}
            placeholder="What stood out today?"
            className="w-full rounded-xl bg-surface-2 p-3 text-xs leading-5 text-ink placeholder:text-ink-muted border border-transparent focus:border-accent focus:bg-surface"
          />
          <p className="alternative text-ink-muted text-right">
            {text.length} / {JOURNAL_TEXT_MAX}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWriting(true)}
          className="self-start min-h-11 alternative text-accent cursor-pointer"
        >
          + Add a few words
        </button>
      )}
    </section>
  );
}
