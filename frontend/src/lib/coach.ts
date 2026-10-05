import type { CoachCard } from "@shared/index";
import { frequencyLabel, targetLabel } from "@/lib/schedule";
import type { Recalibration } from "@shared/index";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a card stays the one on top of the day view. A review is about last
 * week and is stale by the next; an insight is a passing remark; an offer is
 * per week. Without this a card nobody dismissed would sit above the day for
 * ever.
 */
const FRESH_DAYS: Record<CoachCard["kind"], number> = {
  recalibration: 7,
  weekly_review: 7,
  insight: 2,
};

/** Offers first — they are about to be too late — then the review, then the remark. */
const PRIORITY: Record<CoachCard["kind"], number> = {
  recalibration: 0,
  weekly_review: 1,
  insight: 2,
};

const isLive = (card: CoachCard): boolean => card.status === "candidate" || card.status === "ready";

/**
 * The single card the day view shows: the freshest unfinished one, with offers
 * ahead of reviews ahead of insights. One card, not a feed — the day view is
 * for the day.
 */
export const pickTopCard = (cards: readonly CoachCard[], now: number = Date.now()): CoachCard | null => {
  const live = cards.filter(
    (card) => isLive(card) && now - new Date(card.createdAt).getTime() < FRESH_DAYS[card.kind] * DAY_MS,
  );

  return (
    [...live].sort(
      (a, b) =>
        PRIORITY[a.kind] - PRIORITY[b.kind] ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0] ?? null
  );
};

/** One side of "before → after", in the words the rest of the app uses. */
export const describeRule = (rule: Recalibration): string =>
  [frequencyLabel(rule.frequency), rule.target ? targetLabel(rule.target) : null]
    .filter(Boolean)
    .join(" · ");

/** What an offer is about, before the model has said anything about it. */
export const offerHeadline = (card: CoachCard): string =>
  card.proposal ? `Make “${card.proposal.habitTitle}” easier?` : "A gentler plan";
