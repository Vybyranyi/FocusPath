import CircleLoader from '@components/habit/CircleLoader';
import tick_success from '@assets/images/icons/tick_success.svg';
import cross_red    from '@assets/images/icons/cross_red.svg';
import { useSwipeable } from 'react-swipeable';
import { useState, useRef, useCallback, memo } from 'react';
import type { DayStatus, HabitSummary } from '@shared/index';
import { markHabitCompletion } from '@store/habitSlice';
import { useAppDispatch } from '@store/hooks';
import { motion, AnimatePresence } from 'framer-motion';
import { dayKeyOf, todayKey } from '@/lib/dates';
import { dayState } from '@/lib/habitStatus';
import { getHabitProgress } from '@/lib/habitProgress';
import HabitDetailPopup from '@components/habit/HabitDetailPopup';

interface IHabitCardProps {
  habit: HabitSummary;
}

function HabitCard({ habit }: IHabitCardProps) {
  const dispatch   = useAppDispatch();
  const [showDetail, setShowDetail] = useState(false);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const wasSwipedRef = useRef(false);

  // Compared as day keys. `dayInfo.date` is midnight UTC, and reading it with
  // local getters put it on the previous day west of Greenwich — which showed
  // every unmarked habit as a failure a day early.
  const today    = todayKey();
  const habitDay = dayKeyOf(habit.dayInfo.date);
  const isFuture = habitDay > today;

  // Read straight from the store. This used to be local state kept in step by
  // an effect, because the server could not represent "the user marked today
  // failed" — so that verdict lived only in this component and died on the next
  // refetch. The status enum holds it, and the copy here is gone with it.
  const state = dayState(habit.dayInfo, today);

  const progress = getHabitProgress(habit.completedCount, habit.duration);

  const handleMark = useCallback((status: DayStatus) => {
    dispatch(markHabitCompletion({
      habitId: habit._id,
      date: habit.dayInfo.date,
      status,
    }));
  }, [dispatch, habit._id, habit.dayInfo.date]);

  const handlers = useSwipeable({
    onSwiping: e => {
      if (isFuture) return;
      setSwipeDelta(e.deltaX);
      if (Math.abs(e.deltaX) > 10) wasSwipedRef.current = true;
    },
    onSwiped: e => {
      if (!isFuture) {
        if (e.deltaX > 80)       handleMark('done');
        else if (e.deltaX < -80) handleMark('failed');
      }
      setSwipeDelta(0);
      setTimeout(() => { wasSwipedRef.current = false; }, 300);
    },
    trackMouse: false,
  });

  const handleClick = () => {
    if (wasSwipedRef.current) return;
    setShowDetail(true);
  };

  // `missed` gets its own colour rather than borrowing the red one. Letting a
  // day slip is not the same as deciding you failed it, and the two looked
  // identical while both were `completed: false`.
  const ringStyle: React.CSSProperties =
    state === 'done'   ? { boxShadow: 'inset 0 0 0 1.5px #3BA935' } :
    state === 'failed' ? { boxShadow: 'inset 0 0 0 1.5px #E3524F' } :
    state === 'missed' ? { boxShadow: 'inset 0 0 0 1.5px #F0A73B' } :
    { boxShadow: 'inset 0 0 0 1px #EAECF0' };

  const swipeBgClass =
    swipeDelta > 30  ? 'bg-success-20' :
    swipeDelta < -30 ? 'bg-error-20'   :
    '';

  return (
    <>
      <div className={`relative overflow-hidden rounded-2xl transition-colors duration-150 ${swipeBgClass}`}>
        <motion.div
          {...handlers}
          animate={{ x: isFuture ? 0 : Math.min(Math.max(swipeDelta * 0.2, -24), 24) }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={ringStyle}
          className={`relative z-20 flex items-center justify-between p-4 rounded-2xl cursor-pointer bg-base-white ${isFuture ? 'opacity-50' : ''}`}
          onClick={handleClick}
        >
          <div className="flex items-center gap-3">
            <CircleLoader percentages={progress} emoji={habit.icon} isWhite />
            <div>
              <p className="body-bold">{habit.title}</p>
              <p className="alternative text-primary-black-40">
                {habit.dayInfo.dayTitle || `Day ${habit.currentStreak}`}
              </p>
            </div>
          </div>

          {/* Desktop: Done / Fail buttons (hidden on mobile, hidden for future habits) */}
          {!isFuture && (
            <div className="hidden lg:flex items-center gap-1 shrink-0">
              <button
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-success-20 transition-colors"
                onClick={e => { e.stopPropagation(); handleMark('done'); }}
              >
                <img src={tick_success} className="w-4 h-4" alt="Done" />
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-error-20 transition-colors"
                onClick={e => { e.stopPropagation(); handleMark('failed'); }}
              >
                <img src={cross_red} className="w-4 h-4" alt="Fail" />
              </button>
            </div>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {showDetail && (
          <HabitDetailPopup habit={habit} onClose={() => setShowDetail(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

/** Memoised: the day view renders one per habit and re-renders on every store change. */
export default memo(HabitCard);
