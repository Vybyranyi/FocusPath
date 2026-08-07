import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  motion,
  AnimatePresence,
  type Variants,
  type Transition,
} from "framer-motion";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { getHabitsForDate } from "@store/habitSlice";
import { nextWeek, prevWeek } from "@store/calendarSlice";
import { useSwipeable } from "react-swipeable";
import HabitCard      from "@components/habit/HabitCard";
import DatePicker     from "@components/pickers/DatePicker";
import ProgressBanner from "@components/habit/ProgressBanner";
import { toDayKey }   from "@/lib/dates";

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
  const { habitsForDate, loading, error } = useAppSelector((s) => s.habit);
  const { currentWeekStart } = useAppSelector((s) => s.calendar);

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
        <div className="flex justify-center py-8">
          <p className="body-bold text-primary-black-40">Loading habits...</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex justify-center py-8">
          <p className="body-bold text-error">Error: {error}</p>
        </div>
      );
    }
    if (habitsForDate.length === 0) {
      return (
        <motion.div
          key="empty"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center py-12 gap-2"
        >
          <p className="body-bold">No habits for this day</p>
          <p className="alternative text-primary-black-40">
            Create your first habit to get started!
          </p>
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
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-x-6">
          {habitsForDate.map((habit) => (
            <HabitCard key={habit._id} habit={habit} />
          ))}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="container overflow-hidden">
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
