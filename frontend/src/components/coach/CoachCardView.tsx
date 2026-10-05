import type { CoachCard, WeeklyReviewFacts } from "@shared/index";
import Button from "@components/ui/Button";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import {
  applyCoachCard,
  dismissCoachCard,
  openCoachCard,
  rateCoachCard,
} from "@store/coachSlice";
import { refreshDay } from "@store/habitSlice";
import { describeRule, offerHeadline } from "@/lib/coach";
import { cn } from "@/lib/utils";

export interface ICoachCardViewProps {
  card: CoachCard;
  /** The day on screen, refetched after an offer is applied so it shows the new rhythm. */
  day?: string;
  /** The day view's version: the words and the offer, without the figures behind them. */
  compact?: boolean;
}

const LABEL: Record<CoachCard["kind"], string> = {
  weekly_review: "Your week",
  recalibration: "Coach",
  insight: "Something I noticed",
};

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * One thing the coach has to say, in whichever state it is in.
 *
 * An offer arrives as a headline and a before-and-after — worked out, free, and
 * not yet explained. Opening it is what asks the model to speak, so the figure at
 * the top is something the person chose to spend a moment on. Applying it is a
 * second, separate tap that follows seeing exactly what will change: nothing the
 * coach suggests happens on its own.
 */
export default function CoachCardView({ card, day, compact = false }: ICoachCardViewProps) {
  const dispatch = useAppDispatch();
  const busy = useAppSelector((state) => state.coach.busy[card._id] === true);
  const problem = useAppSelector((state) => state.coach.problems[card._id]);

  const live = card.status === "candidate" || card.status === "ready";
  const { proposal, content } = card;
  const rewrite = proposal?.rewrite;

  const handleApply = async () => {
    const result = await dispatch(applyCoachCard(card._id));
    if (applyCoachCard.fulfilled.match(result) && day) dispatch(refreshDay(day));
  };

  const review = card.kind === "weekly_review" ? (card.facts as unknown as WeeklyReviewFacts) : null;

  return (
    <article
      aria-label={LABEL[card.kind]}
      className={cn(
        "relative rounded-2xl p-5 flex flex-col gap-3",
        card.kind === "recalibration" ? "bg-accent-soft" : "bg-surface ring-card",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="chip text-ink-muted">{LABEL[card.kind]}</p>
          <h3 className="title text-ink">
            {card.status === "candidate" ? offerHeadline(card) : (content?.title ?? offerHeadline(card))}
          </h3>
        </div>

        {live && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dispatch(dismissCoachCard(card._id))}
            className="w-11 h-11 -mt-2 -mr-2 shrink-0 flex items-center justify-center rounded-full text-ink-muted hover:text-ink cursor-pointer"
          >
            <CloseIcon />
          </button>
        )}
      </header>

      {/* An offer that has not been opened yet says only what it would change. */}
      {proposal && (
        <p className="body-light text-ink-2">
          <span className="line-through">{describeRule(proposal.from)}</span>
          {" → "}
          <strong className="text-ink">{describeRule(proposal.to)}</strong>
        </p>
      )}

      {content && <p className="body-light text-ink-2 whitespace-pre-wrap">{content.body}</p>}

      {content?.win && !compact && (
        <p className="body-light text-ink-2">
          <strong className="text-success">Win:</strong> {content.win}
        </p>
      )}
      {content?.tip && (
        <p className="body-light text-ink-2">
          <strong className="text-ink">Try:</strong> {content.tip}
        </p>
      )}

      {review && !compact && review.habits.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-3">
          {review.habits.map((habit) => (
            <li key={habit.title} className="alternative text-ink-2 flex justify-between gap-3">
              <span className="truncate">{habit.title}</span>
              <span className="shrink-0">
                {habit.done} / {habit.slots} · {habit.percentage}%
              </span>
            </li>
          ))}
        </ul>
      )}

      {rewrite && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <p className="field-label text-ink-2">
            {rewrite.proposed ? "The next sessions, made gentler" : "The next sessions would be rewritten"}
          </p>
          <ol className="flex flex-col gap-1">
            {(rewrite.proposed ?? rewrite.current).map((title, index) => (
              <li key={index} className="alternative text-ink-2">
                <span className="text-ink-muted">{rewrite.fromSession + index}.</span> {title}
              </li>
            ))}
          </ol>
        </div>
      )}

      {problem && (
        <p role="alert" className="alternative text-danger">
          {problem}
        </p>
      )}

      {card.status === "applied" && (
        <p role="status" className="alternative text-success">
          Done — your plan is updated from today. Earlier days keep the rule they ran under.
        </p>
      )}

      {card.status === "candidate" && card.kind === "recalibration" && (
        <div className="flex gap-3">
          <Button
            type="primary"
            size="small"
            disabled={busy}
            onClick={() => dispatch(openCoachCard(card._id))}
          >
            {busy ? "Thinking…" : "See the plan"}
          </Button>
        </div>
      )}

      {card.status === "ready" && card.kind === "recalibration" && (
        <div className="flex gap-3">
          <Button type="outline" size="small" disabled={busy} onClick={() => dispatch(dismissCoachCard(card._id))}>
            Not now
          </Button>
          <Button type="primary" size="small" disabled={busy} onClick={handleApply}>
            {busy ? "Applying…" : "Apply"}
          </Button>
        </div>
      )}

      {content && (
        <div className="flex items-center gap-2 pt-1" role="group" aria-label="Was this useful?">
          <p className="alternative text-ink-muted mr-1">Useful?</p>
          {([true, false] as const).map((helpful) => {
            const chosen = card.feedback === (helpful ? "helpful" : "not_helpful");
            return (
              <button
                key={String(helpful)}
                type="button"
                aria-pressed={chosen}
                onClick={() => dispatch(rateCoachCard({ id: card._id, helpful }))}
                className={cn(
                  "min-h-11 px-4 rounded-full chip cursor-pointer transition-colors duration-(--duration-fast)",
                  chosen ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-2 hover:bg-line",
                )}
              >
                {helpful ? "Yes" : "No"}
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}
