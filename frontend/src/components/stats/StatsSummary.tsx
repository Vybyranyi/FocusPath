import { memo } from "react";
import StatCard from "./StatCard";
import { getHabitProgress } from "@/lib/habitProgress";
import { isDone } from "@/lib/habitStatus";
import type { Habit } from "@shared/index";

interface StatsSummaryProps {
  habits: Habit[];
}

function StatsSummary({ habits }: StatsSummaryProps) {
  const activeCount = habits.filter((h) => !h.isCompleted).length;
  const completedCount = habits.filter((h) => h.isCompleted).length;
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.currentStreak), 0);

  const totalDays = habits.reduce((sum, h) => sum + h.dailyCompletions.length, 0);
  const doneDays = habits.reduce(
    (sum, h) => sum + h.dailyCompletions.filter(isDone).length,
    0,
  );
  const overallRate = getHabitProgress(doneDays, totalDays);

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard value={activeCount} label="Active" />
      <StatCard value={completedCount} label="Completed" />
      <StatCard value={`${overallRate}%`} label="Done rate" accent />
      <StatCard value={`${bestStreak} 🔥`} label="Best streak" />
    </div>
  );
}

/** Memoised: its props are a memoised selector's output, so it settles quickly. */
export default memo(StatsSummary);
