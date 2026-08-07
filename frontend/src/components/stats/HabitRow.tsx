import { memo } from "react";
import CircleLoader from "@components/habit/CircleLoader";
import { getHabitProgress } from "@/lib/habitProgress";
import { isDone } from "@/lib/habitStatus";
import { Emoji } from "react-apple-emojis";
import type { Habit } from "@shared/index";

interface HabitRowProps {
  habit: Habit;
}

function HabitRow({ habit }: HabitRowProps) {
  const completed = habit.dailyCompletions.filter(isDone).length;
  const pct = getHabitProgress(completed, habit.dailyCompletions.length);

  return (
    <div
      className="bg-base-white rounded-2xl shadow-medium p-4 flex flex-col gap-3"
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
                  ? "bg-primary-blue-10 text-primary-blue"
                  : "bg-s-orange-20 text-s-orange",
              ].join(" ")}
            >
              {habit.type === "build" ? "Build" : "Quit"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <CircleLoader percentages={pct} emoji={habit.icon} />
          {habit.isCompleted && (
            <span className="chip text-success bg-success-20 px-2 py-0.5 rounded-full">
              Done
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="w-full h-1.5 bg-primary-black-10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: habit.color || "#3843FF",
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="alternative text-primary-black-40">
            {completed} / {habit.duration} days
          </p>
          {habit.currentStreak > 0 && (
            <p className="alternative text-primary-black-60 font-bold">
              🔥 {habit.currentStreak} streak
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Memoised: rendered once per habit in a list the stats page rebuilds wholesale. */
export default memo(HabitRow);
