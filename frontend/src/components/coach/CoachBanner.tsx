import { useMemo } from "react";
import CoachCardView from "@components/coach/CoachCardView";
import { useAppSelector } from "@store/hooks";
import { pickTopCard } from "@/lib/coach";

/**
 * The one card the day view carries: the freshest unfinished one, an offer before
 * a review before an insight. Nothing when there is nothing — the coach does not
 * fill a quiet day with encouragement.
 */
export default function CoachBanner({ day }: { day: string }) {
  const cards = useAppSelector((state) => state.coach.cards);
  // `Date.now()` is read inside the memo: the card is chosen when the list
  // changes, not re-chosen on every render of the day.
  const top = useMemo(() => pickTopCard(cards), [cards]);

  if (!top) return null;
  return <CoachCardView key={top._id} card={top} day={day} compact />;
}
