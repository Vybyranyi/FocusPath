import CircleLoader from '@components/habit/CircleLoader';
import { useSwipeable } from 'react-swipeable';
import { useState, useRef, useCallback, memo } from 'react';
import type { DayStatus, HabitSummary } from '@shared/index';
import { markHabitCompletion } from '@store/habitSlice';
import { useAppDispatch } from '@store/hooks';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { dayKeyOf, todayKey } from '@/lib/dates';
import { isOff, type DayState } from '@/lib/habitStatus';
import { habitCompletion } from '@/lib/habitProgress';
import HabitDetailPopup from '@components/habit/HabitDetailPopup';
import { cn } from '@/lib/utils';
import { useToast } from '@hooks/useToast';

interface IHabitCardProps {
  habit: HabitSummary;
}

const CheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CrossIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Status carried by shape as well as colour.
 *
 * The three verdicts used to differ only by the colour of a ring — green, red,
 * amber — with the amber at 2:1 against white. That is unreadable for anyone
 * with deuteranopia and faint for everyone else, so each state now also has an
 * icon and a word.
 */
const STATE_STYLE: Record<DayState, { ring: string; badge: string; Icon: typeof CheckIcon; word: string } | null> = {
  done:    { ring: 'ring-success', badge: 'bg-success-soft text-success', Icon: CheckIcon, word: 'Done' },
  failed:  { ring: 'ring-danger',  badge: 'bg-danger-soft text-danger',   Icon: CrossIcon, word: 'Not done' },
  missed:  { ring: 'ring-missed',  badge: 'bg-missed-soft text-missed',   Icon: ClockIcon, word: 'Missed' },
  // Days the habit is deliberately not asked for. Neutral on purpose: neither
  // a success nor a slip, and they must not read as either.
  paused:  { ring: 'ring-line',    badge: 'bg-canvas text-ink-muted',     Icon: ClockIcon, word: 'Paused' },
  rest:    { ring: 'ring-line',    badge: 'bg-canvas text-ink-muted',     Icon: ClockIcon, word: 'Rest day' },
  pending: null,
};

function HabitCard({ habit }: IHabitCardProps) {
  const dispatch   = useAppDispatch();
  const [showDetail, setShowDetail] = useState(false);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const wasSwipedRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const { notify } = useToast();

  // Compared as day keys. `day.date` is midnight UTC, and reading it with
  // local getters put it on the previous day west of Greenwich — which showed
  // every unmarked habit as a failure a day early.
  const today    = todayKey();
  const habitDay = dayKeyOf(habit.day.date);
  const isFuture = habitDay > today;

  // The server says what the day is worth, `missed` included: it is derived
  // from the date there, in one place, and this component no longer repeats the
  // rule. It reads the state straight from the store — it used to be local
  // state kept in step by an effect, which died on the next refetch.
  const state = habit.day.state;
  const style = STATE_STYLE[state];
  const off = isOff(habit.day);

  const progress = habitCompletion(habit.progress);

  const handleMark = useCallback((status: DayStatus) => {
    dispatch(markHabitCompletion({
      habitId: habit._id,
      date: habit.day.date,
      status,
    }))
      .unwrap()
      // Said out loud. A refused mark used to change nothing and say nothing:
      // the card simply stayed as it was, which reads as a swipe that did not
      // register, and the user tries again into the same failure.
      .catch((reason: unknown) => {
        notify(
          `Could not save “${habit.title}” — ${typeof reason === 'string' ? reason : 'try again'}`,
          'danger',
        );
      });
  }, [dispatch, habit._id, habit.day.date, habit.title, notify]);

  const handlers = useSwipeable({
    onSwiping: e => {
      if (isFuture || off) return;
      setSwipeDelta(e.deltaX);
      if (Math.abs(e.deltaX) > 10) wasSwipedRef.current = true;
    },
    onSwiped: e => {
      if (!isFuture && !off) {
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

  // The hint used to appear only past 30px of travel, by which point the
  // gesture is already underway. It fades in from the first pixel instead.
  const revealed = Math.min(Math.abs(swipeDelta) / 60, 1);
  const swipingRight = swipeDelta > 0;

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-surface">
        {/* What the gesture will do, shown underneath the card as it moves. */}
        {!isFuture && !off && swipeDelta !== 0 && (
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 flex items-center px-5',
              swipingRight ? 'justify-start bg-success-soft' : 'justify-end bg-danger-soft',
            )}
            style={{ opacity: revealed }}
          >
            {swipingRight
              ? <CheckIcon className="w-6 h-6 text-success" />
              : <CrossIcon className="w-6 h-6 text-danger" />}
          </div>
        )}

        <motion.div
          {...handlers}
          animate={{ x: isFuture || reduceMotion ? 0 : Math.min(Math.max(swipeDelta * 0.2, -24), 24) }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className={cn(
            'relative z-20 flex items-center justify-between gap-3 p-4 rounded-2xl bg-surface',
            'ring-inset',
            style ? `ring-[1.5px] ${style.ring}` : 'ring-1 ring-line',
            isFuture && 'opacity-60',
          )}
          // Read by the tests, and by anything that needs the verdict without
          // reverse-engineering a colour.
          data-status={state}
        >
          <button
            type="button"
            onClick={handleClick}
            className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
          >
            <CircleLoader percentages={progress} emoji={habit.icon} isWhite />
            <span className="min-w-0">
              <span className="body-bold block truncate">{habit.title}</span>
              <span className="alternative block text-ink-muted truncate">
                {habit.day.session?.title || habit.description || habit.title}
              </span>
            </span>
            {style && (
              <span className={cn('chip px-2 py-0.5 rounded-full shrink-0', style.badge)}>
                {style.word}
              </span>
            )}
          </button>

          {/* These were `hidden lg:flex`, so below 1024px the only way to mark
              a habit was a swipe nobody had been told about — and there was no
              keyboard path at any width. */}
          {!isFuture && !off && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                aria-label={`Mark ${habit.title} done`}
                aria-pressed={state === 'done'}
                className={cn(
                  'w-11 h-11 flex items-center justify-center rounded-full cursor-pointer',
                  'transition-colors duration-(--duration-fast)',
                  state === 'done' ? 'bg-success text-on-accent' : 'text-ink-muted hover:bg-success-soft hover:text-success',
                )}
                onClick={() => handleMark('done')}
              >
                <CheckIcon className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label={`Mark ${habit.title} not done`}
                aria-pressed={state === 'failed'}
                className={cn(
                  'w-11 h-11 flex items-center justify-center rounded-full cursor-pointer',
                  'transition-colors duration-(--duration-fast)',
                  state === 'failed' ? 'bg-danger text-on-accent' : 'text-ink-muted hover:bg-danger-soft hover:text-danger',
                )}
                onClick={() => handleMark('failed')}
              >
                <CrossIcon className="w-5 h-5" />
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
