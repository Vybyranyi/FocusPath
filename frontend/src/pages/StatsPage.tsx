import HabitGroup from "@components/stats/HabitGroup";
import JournalHistory from "@components/journal/JournalHistory";
import StatsSummary from "@components/stats/StatsSummary";
import { getAllHabits } from "@store/habitSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import {
  selectAllHabits,
  selectBuildHabits,
  selectQuitHabits,
} from "@store/selectors";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import Button from "@components/ui/Button";
import { Skeleton } from "@components/ui/Skeleton";

export default function StatsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  // The store holds the API's Habit, so this page reads it directly. It used to
  // reach the shape it needed through a double cast, which switched off type
  // checking for everything below it.
  const habits = useAppSelector(selectAllHabits);
  const buildHabits = useAppSelector(selectBuildHabits);
  const quitHabits = useAppSelector(selectQuitHabits);
  const loading = useAppSelector((state) => state.habit.loading);

  useEffect(() => {
    dispatch(getAllHabits());
  }, [dispatch]);

  return (
    <div className="min-h-screen bg-canvas pb-28 md:pb-12">
      <div className="page-gutter max-w-120 md:max-w-5xl mx-auto pt-6 md:pt-10 flex flex-col gap-6">
        {loading && habits.length === 0 ? (
          <div className="flex flex-col gap-6">
            <span className="sr-only" role="status">Loading stats</span>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {Array.from({ length: 2 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
          </div>
        ) : habits.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3 text-center">
            <p className="body-bold">No habits yet</p>
            <p className="alternative text-ink-muted max-w-64">
              Stats appear once you have a habit to track.
            </p>
            <div className="w-full max-w-56 pt-1">
              <Button type="primary" size="medium" onClick={() => navigate("/createhabit")}>
                Create a habit
              </Button>
            </div>
          </div>
        ) : (
          <>
            <StatsSummary habits={habits} />
            {/* Build and Quit sit side by side rather than stacking: they are
                two different things the user compares, not two halves of one
                list. An empty group renders nothing, so the other takes the
                full width on its own. */}
            <div className="grid gap-6 md:grid-cols-2 md:items-start">
              <HabitGroup habits={buildHabits} type="build" />
              <HabitGroup habits={quitHabits} type="quit" />
            </div>
          </>
        )}

        {/* Outside the habit branches: the journal is the person's, not a habit's,
            and is worth reading with no habit at all. */}
        <JournalHistory />
      </div>
    </div>
  );
}
