import { memo } from "react";
import CircleLoader from "@components/habit/CircleLoader";
import { habitCompletion } from "@/lib/habitProgress";
import { streakLabel } from "@/lib/schedule";
import { Emoji } from "react-apple-emojis";
import type { Habit } from "@shared/index";

const FlameIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M12 2c.5 3-1.5 4.5-3 6S6 11.5 6 14a6 6 0 0 0 12 0c0-2.5-1.2-4-2.5-5.5C14 7 13 5 12 2Zm0 17a3 3 0 0 1-3-3c0-1.3.7-2.1 1.5-3 .6.9 1.1 1.4 1.5 2.4.5-1 1-1.6 1.6-2.3.7.9 1.4 1.6 1.4 2.9a3 3 0 0 1-3 3Z" />
  </svg>
);

interface HabitRowProps {
  habit: Habit;
}

function HabitRow({ habit }: HabitRowProps) {
  const { done, sessionsTotal } = habit.progress;
  const pct = habitCompletion(habit.progress);

  return (
    <div
      className="bg-surface rounded-2xl shadow-lifted p-4 flex flex-col gap-3"
      style={{ borderLeft: `4px solid ${habit.color || "#3843FF"}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${habit.color}22` }}
          >
            <Emoji name={habit.icon} className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="body-bold truncate">{habit.title}</p>
            <span
              className={[
                "chip px-2 py-0.5 rounded-full",
                habit.type === "build"
                  ? "bg-accent-soft text-accent"
                  : "bg-s-orange-soft text-s-orange",
              ].join(" ")}
            >
              {habit.type === "build" ? "Build" : "Quit"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <CircleLoader percentages={pct} emoji={habit.icon} />
          {habit.isCompleted && (
            <span className="chip text-success bg-success-soft px-2 py-0.5 rounded-full">
              Done
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="w-full h-1.5 bg-line rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: habit.color || "#3843FF",
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="alternative text-ink-muted">
            {sessionsTotal ? `${done} / ${sessionsTotal} sessions` : `${done} done`}
          </p>
          {habit.currentStreak > 0 && (
            <p className="alternative text-ink-2 font-bold inline-flex items-center gap-1">
              <FlameIcon className="w-3.5 h-3.5 text-warning" />
              {streakLabel(habit.currentStreak, habit.streakUnit)} streak
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Memoised: rendered once per habit in a list the stats page rebuilds wholesale. */
export default memo(HabitRow);
