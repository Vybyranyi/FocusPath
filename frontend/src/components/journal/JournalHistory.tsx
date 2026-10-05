import { useEffect, useState } from "react";
import { addDays } from "date-fns";
import type { JournalEntry } from "@shared/index";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { fetchJournalHistory } from "@store/journalSlice";
import { dayKeyOf, fromDayKey, relativeDayLabel, toDayKey, todayKey } from "@/lib/dates";
import { ENERGY_LEVELS, moodFace, MOODS } from "@/lib/journal";
import { Skeleton } from "@components/ui/Skeleton";

/** How far back one request reaches; the server allows 92 days at most. */
const STEP_DAYS = 30;
const MAX_STEPS = 3;

/** Words past this many characters are folded behind "Show more". */
const FOLD_AT = 140;

const Entry = ({ entry }: { entry: JournalEntry }) => {
  const [open, setOpen] = useState(false);
  const text = entry.text ?? "";
  const folded = text.length > FOLD_AT && !open;
  const mood = MOODS.find((item) => item.value === entry.mood);
  const energy = ENERGY_LEVELS.find((item) => item.value === entry.energy);

  return (
    <li className="py-3 flex flex-col gap-1.5 border-t border-line first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <p className="body-bold">{relativeDayLabel(dayKeyOf(entry.day))}</p>
        <p className="alternative text-ink-muted flex items-center gap-3">
          {mood && (
            <span aria-label={`Mood: ${mood.label}`}>
              <span aria-hidden>{moodFace(entry.mood)}</span> {mood.label}
            </span>
          )}
          {energy && <span>Energy: {energy.label}</span>}
        </p>
      </div>

      {text && (
        <>
          <p className="body-light text-ink-2 whitespace-pre-wrap">
            {folded ? `${text.slice(0, FOLD_AT).trimEnd()}…` : text}
          </p>
          {text.length > FOLD_AT && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="self-start min-h-11 alternative text-accent cursor-pointer"
            >
              {open ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
    </li>
  );
};

/**
 * The days written about, newest first.
 *
 * Journaling is only worth doing if it can be read back: a mood is one number on
 * one day, and what means something is the run of them. Reaches back a month and
 * can be asked for more, up to what the server will read in one go.
 */
export default function JournalHistory() {
  const dispatch = useAppDispatch();
  const { history, historyLoading, historyError } = useAppSelector((state) => state.journal);
  const [steps, setSteps] = useState(1);

  useEffect(() => {
    const today = todayKey();
    const from = toDayKey(addDays(fromDayKey(today), -(steps * STEP_DAYS - 1)));
    dispatch(fetchJournalHistory({ from, to: today }));
  }, [dispatch, steps]);

  return (
    <section aria-label="Journal" className="bg-surface rounded-2xl shadow-lifted p-6 flex flex-col gap-3">
      <h2 className="title font-bold">Journal</h2>

      {historyLoading && history.length === 0 ? (
        <>
          <span className="sr-only" role="status">Loading journal</span>
          <Skeleton className="h-16 rounded-xl" />
        </>
      ) : historyError ? (
        <p role="alert" className="alternative text-danger">{historyError}</p>
      ) : history.length === 0 ? (
        <p className="alternative text-ink-muted">
          Nothing written yet. The card under each day’s habits is where it starts —
          a mood is enough.
        </p>
      ) : (
        <ul>
          {history.map((entry) => (
            <Entry key={entry._id} entry={entry} />
          ))}
        </ul>
      )}

      {steps < MAX_STEPS && history.length > 0 && (
        <button
          type="button"
          disabled={historyLoading}
          onClick={() => setSteps((value) => value + 1)}
          className="self-start min-h-11 alternative text-accent cursor-pointer"
        >
          Show earlier
        </button>
      )}
    </section>
  );
}
