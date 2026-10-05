import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  motion,
  AnimatePresence,
  type Variants,
  type Transition,
} from "framer-motion";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { selectHabitGroups } from "@store/selectors";
import { getHabitsForDate } from "@store/habitSlice";
import { nextWeek, prevWeek } from "@store/calendarSlice";
import { useSwipeable } from "react-swipeable";
import { useNavigate } from "react-router";
import HabitCard      from "@components/habit/HabitCard";
import DatePicker     from "@components/pickers/DatePicker";
import ProgressBanner from "@components/habit/ProgressBanner";
import { toDayKey }   from "@/lib/dates";
import Button        from "@components/ui/Button";
import { HabitCardSkeleton } from "@components/ui/Skeleton";

const slideVariants: Variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 50 : -50, opacity: 0 }),
  center: { zIndex: 1, x: 0, opacity: 1 },
  exit: (dir: number) => ({ zIndex: 0, x: dir < 0 ? 50 : -50, opacity: 0 }),
};

const springTransition: Transition = {
  x: { type: "spring", stiffness: 300, damping: 30 },
  opacity: { duration: 0.2 },
};

export default function Main() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { habitsForDate, loading, error } = useAppSelector((s) => s.habit);
  const { currentWeekStart } = useAppSelector((s) => s.calendar);
  const groups = useAppSelector(selectHabitGroups);

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [direction, setDirection] = useState(0);
  const prevWeekRef = useRef(currentWeekStart);

  let calendarDirection = 0;
  if (currentWeekStart > prevWeekRef.current) calendarDirection = 1;
  else if (currentWeekStart < prevWeekRef.current) calendarDirection = -1;

  useEffect(() => {
    prevWeekRef.current = currentWeekStart;
  }, [currentWeekStart]);

  const dates = useMemo(() => {
    const start = new Date(currentWeekStart);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [currentWeekStart]);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => dispatch(nextWeek()),
    onSwipedRight: () => dispatch(prevWeek()),
    trackMouse: true,
  });

  // Derived rather than stored: the effect below refetches whenever it changes,
  // so a click that lands on the day already shown does not fetch it again.
  const selectedKey = toDayKey(selectedDate);

  const handleDateClick = useCallback((date: Date) => {
    // Both setters called plainly. Deciding the direction inside the
    // setSelectedDate updater made it a side effect, which React is free to
    // run twice — and does, under StrictMode.
    setDirection(date > selectedDate ? 1 : -1);
    setSelectedDate(date);
  }, [selectedDate]);

  useEffect(() => {
    dispatch(getHabitsForDate(selectedKey));
  }, [dispatch, selectedKey]);

  const renderContent = () => {
    if (loading) {
      return (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-x-6"
        >
          <span className="sr-only" role="status">Loading habits</span>
          {Array.from({ length: 3 }, (_, i) => (
            <HabitCardSkeleton key={i} />
          ))}
        </motion.div>
      );
    }
    if (error) {
      return (
        <motion.div
          key="error"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex justify-center py-8"
        >
          <p role="alert" className="body-bold text-danger">{error}</p>
        </motion.div>
      );
    }
    if (habitsForDate.length === 0) {
      return (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center py-12 gap-3 text-center"
        >
          <p className="body-bold">Nothing scheduled for this day</p>
          <p className="alternative text-ink-muted max-w-64">
            Habits you create will show up here on the days they run.
          </p>
          <div className="w-full max-w-56 pt-1">
            <Button type="primary" size="medium" onClick={() => navigate("/createhabit")}>
              Create a habit
            </Button>
          </div>
        </motion.div>
      );
    }

    return (
      <motion.div
        key={selectedKey}
        custom={direction}
        variants={slideVariants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={springTransition}
        className="flex flex-col gap-3"
      >
        <ProgressBanner />
        {groups.map((group) => (
          <section key={group.timeOfDay} aria-label={group.label} className="flex flex-col gap-3">
            {/* A heading only when there is something to tell apart: a lone
                "Anytime" over every habit of the day is noise. */}
            {groups.length > 1 && <h2 className="field-label text-ink-2">{group.label}</h2>}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-x-6">
              {group.habits.map((habit) => (
                <HabitCard key={habit._id} habit={habit} />
              ))}
            </div>
          </section>
        ))}
      </motion.div>
    );
  };

  return (
    <div className="page-gutter overflow-hidden">
      <div className="flex flex-col gap-4">
        <div {...swipeHandlers}>
          <AnimatePresence mode="wait" custom={calendarDirection}>
            <motion.div
              key={currentWeekStart}
              custom={calendarDirection}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={springTransition}
              className="flex gap-2 w-full *:flex-1 *:min-w-0"
            >
              {dates.map((date) => (
                <DatePicker
                  key={date.toISOString()}
                  date={date}
                  active={toDayKey(date) === selectedKey}
                  onClick={() => handleDateClick(date)}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait" custom={direction}>
          {renderContent()}
        </AnimatePresence>
      </div>
    </div>
  );
}
