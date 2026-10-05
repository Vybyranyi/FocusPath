import { memo } from "react";
import StatCard from "./StatCard";
import { getHabitProgress } from "@/lib/habitProgress";
import type { Habit } from "@shared/index";

interface StatsSummaryProps {
  habits: Habit[];
}

function StatsSummary({ habits }: StatsSummaryProps) {
  const activeCount = habits.filter((h) => !h.isCompleted).length;
  const completedCount = habits.filter((h) => h.isCompleted).length;
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.currentStreak), 0);

  // Over what is already decided, as each habit's own percentage is: the days
  // still to come would otherwise drag the rate down on every programme in
  // progress.
  const decided = habits.reduce((sum, h) => sum + h.progress.decided, 0);
  const done = habits.reduce((sum, h) => sum + h.progress.done, 0);
  const overallRate = getHabitProgress(done, decided);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard value={activeCount} label="Active" />
      <StatCard value={completedCount} label="Completed" />
      <StatCard value={`${overallRate}%`} label="Done rate" accent />
      <StatCard value={bestStreak} label="Best streak" />
    </div>
  );
}

/** Memoised: its props are a memoised selector's output, so it settles quickly. */
export default memo(StatsSummary);
