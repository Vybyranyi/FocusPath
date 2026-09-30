import CircleLoader from "@components/habit/CircleLoader";
import { Emoji } from "react-apple-emojis";
import { useAppSelector } from "@store/hooks";
import { selectDailyProgress } from "@store/selectors";

/**
 * What the banner says. It used to be "Your daily goals almost done!" for
 * everything short of all — including 0 of 5, which is not almost anything.
 */
const bannerMessage = (completed: number, total: number): string => {
  const left = total - completed;
  if (left === 0) return "All goals completed!";
  if (completed === 0) return "Nothing done yet — pick one to start";
  if (left === 1) return "Almost there — one to go!";
  return `Keep going — ${left} to go`;
};

export default function ProgressBanner() {
  // Subscribes to the derived figures rather than the whole habit slice, so a
  // change to loading or error no longer re-renders this banner.
  const { total, completed, percentage } = useAppSelector(selectDailyProgress);

  if (total === 0) return null;

  return (
    <div className="bg-blue-gradient flex items-center gap-3 p-4 rounded-2xl">
      <CircleLoader percentages={percentage} isWhite />
      <div>
        <p className="body-bold text-on-brand mb-1 flex items-center gap-1.5">
          {bannerMessage(completed, total)}
          <Emoji name="fire" className="w-3 h-3" />
        </p>
        <p className="alternative text-brand-blue-10">{completed} of {total} completed</p>
      </div>
    </div>
  );
}
