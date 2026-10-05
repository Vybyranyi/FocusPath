import CoachCardView from "@components/coach/CoachCardView";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { loadMoreCoach } from "@store/coachSlice";
import { Skeleton } from "@components/ui/Skeleton";

/**
 * What the coach has said, kept: reviews and offers in one list, insights in
 * their own. Cards are stored precisely so they can be read again, and so the
 * "useful / not" they carry — the only signal of whether any of this works — has
 * somewhere to be given after the day view has moved on.
 */
export default function CoachHistory() {
  const dispatch = useAppDispatch();
  const { cards, nextCursor, loading, loadedOnce, error } = useAppSelector((state) => state.coach);

  const insights = cards.filter((card) => card.kind === "insight");
  const rest = cards.filter((card) => card.kind !== "insight");

  return (
    <section aria-label="Coach" className="flex flex-col gap-4">
      <h2 className="title font-bold">Coach</h2>

      {!loadedOnce && loading ? (
        <>
          <span className="sr-only" role="status">Loading the coach</span>
          <Skeleton className="h-28 rounded-2xl" />
        </>
      ) : error && cards.length === 0 ? (
        <p role="alert" className="alternative text-danger">{error}</p>
      ) : cards.length === 0 ? (
        <p className="alternative text-ink-muted bg-surface rounded-2xl ring-card p-5">
          I’m still getting to know you — see you in a week. The coach speaks once there
          is a week of habits to look at, and keeps quiet until then.
        </p>
      ) : (
        <>
          {rest.length > 0 && (
            <div className="flex flex-col gap-3">
              {rest.map((card) => (
                <CoachCardView key={card._id} card={card} />
              ))}
            </div>
          )}

          {insights.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="field-label text-ink-2">Patterns I noticed</h3>
              {insights.map((card) => (
                <CoachCardView key={card._id} card={card} />
              ))}
            </div>
          )}

          {nextCursor && (
            <button
              type="button"
              onClick={() => dispatch(loadMoreCoach(nextCursor))}
              className="self-start min-h-11 alternative text-accent cursor-pointer"
            >
              Show earlier
            </button>
          )}
        </>
      )}
    </section>
  );
}
