import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Emoji } from 'react-apple-emojis';
import { useAppDispatch } from '@store/hooks';
import { toggleHabitStep, deleteHabit } from '@store/habitSlice';
import { habitCompletion } from '@/lib/habitProgress';
import { dayKeyOf, fromDayKey, relativeDayLabel, todayKey } from '@/lib/dates';
import { isDone, isOff } from '@/lib/habitStatus';
import type { HabitSummary } from '@shared/index';
import { format } from 'date-fns';
import Button from '@components/ui/Button';
import PublishPlanSheet from '@components/explore/PublishPlanSheet';
import EditHabitSheet from '@components/habit/EditHabitSheet';
import { cn } from '@/lib/utils';
import { useToast } from '@hooks/useToast';
import { useNavigate } from 'react-router';

interface IHabitDetailPopupProps {
  habit: HabitSummary;
  onClose: () => void;
}

const DotsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="7" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="17" r="1.5" />
  </svg>
);

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
);

const PencilIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * The habit sheet.
 *
 * This used to be a bare portal: no dialog role, no focus trap, no Escape, no
 * focus restored on close, and nothing stopping the page behind it from
 * scrolling. Focus stayed on the card underneath, so a screen reader carried on
 * reading the list through the overlay. Radix's Dialog supplies all of that;
 * the previous version had none of it, and there was not a single `onKeyDown`
 * anywhere in the app to build it from.
 */
export default function HabitDetailPopup({ habit, onClose }: IHabitDetailPopupProps) {
  const dispatch = useAppDispatch();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * The menu closes when you click away from it or press Escape. Both were
   * lost when the sheet moved to Radix: the menu stayed open until its own
   * button was pressed again, and Escape closed the whole sheet under it.
   * Escape is caught in the capture phase and stopped, so it closes only the
   * menu and Radix's own Escape handling never sees it.
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menuOpen]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState(false);

  /**
   * Radix hands focus back to its own `Dialog.Trigger`. This sheet is mounted
   * from state by the card instead, so there is no trigger to return to and
   * focus was landing on the document body — closing the sheet dropped a
   * keyboard user at the top of the page. It mounts already open, so whatever
   * had focus at that moment is the card that opened it.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
  }, []);

  // The bar measures the plan. It used to switch to the steps whenever a habit
  // had any, on the grounds that they were "a finer measure of the same thing"
  // — but a day's checklist says nothing about how far through ninety days
  // someone is, and the number jumped between two meanings.
  const progress = habitCompletion(habit.progress);

  const steps = habit.steps ?? [];
  const ticked = new Set(habit.day.completedSteps);
  const tickedCount = steps.filter(step => ticked.has(step._id)).length;
  // Like marking the day itself, a checklist is not for a day that has not come.
  const isFutureDay = dayKeyOf(habit.day.date) > todayKey();

  const handleToggleStep = (stepId: string) => {
    dispatch(toggleHabitStep({ habitId: habit._id, stepId, date: habit.day.date }));
  };

  const handleDelete = () => {
    dispatch(deleteHabit(habit._id));
    notify(`Deleted “${habit.title}”`);
    onClose();
  };

  // The projected last day, which the server moves with every pause. A habit
  // with no end has none to show; one paused with no end has none to know.
  const deadline = habit.endDate
    ? format(fromDayKey(dayKeyOf(habit.endDate)), 'MMM do, yyyy')
    : habit.sessions === undefined
      ? 'No end'
      : null;

  return (
    /*
     * Closed while the publish sheet is up, rather than left open underneath
     * it. Two stacked sheets meant two overlays, two blurs and a card the user
     * could see but not reach; cancelling brings this one straight back.
     */
    <Dialog.Root open={!publishing && !editing} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-ink/60 backdrop-blur-sm"
          />
        </Dialog.Overlay>

        {/* Focus is allowed to move in. It used to be held back with
            `preventDefault`, which left a keyboard user on the card behind the
            overlay while the sheet covered it. */}
        <Dialog.Content
          asChild
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current;
            if (!opener?.isConnected) return;
            event.preventDefault();
            opener.focus();
          }}
        >
          <motion.div
            initial={{ y: '100%', scale: 0.95 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: '100%', scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={cn(
              'fixed z-[201] bg-surface shadow-ambient',
              'inset-x-0 bottom-0 rounded-t-3xl',
              'lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2',
              'lg:w-full lg:max-w-md lg:rounded-3xl',
              'max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-6',
            )}
          >
            {/* Header Area */}
            <div className="flex items-start justify-between gap-3 relative">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-14 h-14 shrink-0 rounded-2xl bg-canvas flex items-center justify-center">
                   <Emoji name={habit.icon || "dart"} className="w-8 h-8" />
                </div>
                <div className="min-w-0 flex flex-col pt-1 gap-1.5">
                  <Dialog.Title className="display-5 truncate text-ink">{habit.title}</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Progress and steps for this habit
                  </Dialog.Description>
                  <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'chip px-2 py-1 rounded-full leading-none',
                          habit.type === 'build'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-danger-soft text-danger',
                        )}
                      >
                        {habit.category || (habit.type === 'build' ? 'BUILD' : 'QUIT')}
                      </span>
                      {deadline && (
                         <span className="alternative text-ink-2 bg-canvas px-2 py-1 rounded-full flex items-center gap-1 leading-none border border-line">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            {deadline}
                         </span>
                      )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="relative" ref={menuRef}>
                   <button
                     type="button"
                     onClick={() => setMenuOpen(!menuOpen)}
                     aria-label="Habit options"
                     aria-expanded={menuOpen}
                     className="w-11 h-11 flex items-center justify-center rounded-full bg-canvas text-ink-2 hover:bg-line hover:text-ink transition-colors cursor-pointer"
                   >
                     <DotsIcon />
                   </button>
                   <AnimatePresence>
                     {menuOpen && (
                       <motion.div
                         initial={{ opacity: 0, scale: 0.95, y: -10 }}
                         animate={{ opacity: 1, scale: 1, y: 0 }}
                         exit={{ opacity: 0, scale: 0.95, y: -10 }}
                         transition={{ duration: 0.15 }}
                         className="absolute right-0 top-full mt-2 w-48 bg-surface rounded-xl shadow-lifted border border-line overflow-hidden z-10"
                       >
                         {/* Publishing lives beside deleting because this menu
                             is where things you do *to* a habit already are —
                             and it is the only place a habit is fully in view.
                             A habit already published leads to its plan: the
                             server refuses a second copy, and offering one only
                             to refuse it after the form is filled in is worse
                             than not offering it. */}
                         <button
                           type="button"
                           onClick={() => { setMenuOpen(false); setEditing(true); }}
                           className="w-full text-left px-4 py-3 body-bold text-ink hover:bg-canvas transition-colors flex items-center gap-2 cursor-pointer"
                         >
                            <PencilIcon />
                            Edit habit
                         </button>
                         {/* Only a programme can be published: a habit with no
                             end has no tasks to hand to the library. */}
                         {habit.sessions === undefined ? null : habit.publishedPlanId ? (
                           <button
                             type="button"
                             onClick={() => { setMenuOpen(false); onClose(); navigate(`/explore/${habit.publishedPlanId}`); }}
                             className="w-full text-left px-4 py-3 body-bold text-ink hover:bg-canvas transition-colors flex items-center gap-2 cursor-pointer"
                           >
                              <ShareIcon />
                              View published plan
                           </button>
                         ) : (
                           <button
                             type="button"
                             onClick={() => { setMenuOpen(false); setPublishing(true); }}
                             className="w-full text-left px-4 py-3 body-bold text-ink hover:bg-canvas transition-colors flex items-center gap-2 cursor-pointer"
                           >
                              <ShareIcon />
                              Publish as a plan
                           </button>
                         )}
                         <button
                           type="button"
                           onClick={() => { setMenuOpen(false); setConfirmingDelete(true); }}
                           className="w-full text-left px-4 py-3 body-bold text-danger hover:bg-danger-soft transition-colors flex items-center gap-2 cursor-pointer"
                         >
                            <TrashIcon />
                            Delete habit
                         </button>
                       </motion.div>
                     )}
                   </AnimatePresence>
                </div>

                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close"
                    className="w-11 h-11 flex items-center justify-center rounded-full bg-canvas text-ink-2 hover:bg-line hover:text-ink transition-colors shrink-0 cursor-pointer"
                  >
                    <CloseIcon />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            {/* Deleting is not reversible, so it is confirmed in the app's own
                voice and names the habit. `window.confirm` could do neither. */}
            {confirmingDelete && (
              <div role="alertdialog" aria-label="Confirm deletion" className="bg-danger-soft border border-danger/30 rounded-2xl p-4 flex flex-col gap-3">
                <p className="body-bold text-ink">
                  Delete “{habit.title}”? Its history goes with it.
                </p>
                <div className="flex gap-3">
                  <Button type="outline" size="small" onClick={() => setConfirmingDelete(false)}>
                    Keep it
                  </Button>
                  <Button type="primary" size="small" onClick={handleDelete}>
                    Delete habit
                  </Button>
                </div>
              </div>
            )}

            {/* Progress Section */}
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end">
                   <p className="field-label text-ink-2">Overall progress</p>
                   <p className="display-4 text-ink leading-none">{progress}%</p>
                </div>
                <div
                  className="w-full h-4 bg-canvas rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Overall progress"
                >
                    <motion.div
                       className="h-full bg-accent rounded-full"
                       initial={{ width: 0 }}
                       animate={{ width: `${progress}%` }}
                       transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                </div>
            </div>

            {/* Description Section */}
            {habit.description && (
                <div className="bg-canvas rounded-2xl p-4 border border-line relative overflow-hidden">
                   <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent/30 rounded-l-2xl" aria-hidden />
                   <p className="text-ink-2 body-light leading-relaxed whitespace-pre-wrap">{habit.description}</p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div className="bg-canvas rounded-2xl p-5 flex flex-col justify-center items-center border border-line">
                    <p className="chip text-ink-muted mb-2">Current streak</p>
                    <p className="display-3 text-ink leading-none">{habit.currentStreak}</p>
                    <p className="chip text-ink-muted mt-1">{habit.streakUnit === 'week' ? 'Weeks' : 'Days'}</p>
                </div>
                <div
                    className={cn(
                      'rounded-2xl p-5 flex flex-col justify-center items-center border transition-colors',
                      isDone(habit.day)
                        ? 'bg-success-soft border-success/30'
                        : 'bg-canvas border-line',
                    )}
                >
                    {/* The day on screen, which is only sometimes today: the
                        sheet opens from whichever day is selected, and this
                        tile said "Today" for all of them. */}
                    <p className={cn('chip mb-2', isDone(habit.day) ? 'text-success' : 'text-ink-muted')}>
                      {relativeDayLabel(dayKeyOf(habit.day.date))}
                    </p>
                    {isDone(habit.day) ? (
                         <span className="flex flex-col items-center gap-1 text-success">
                           <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                             <polyline points="20 6 9 17 4 12" />
                           </svg>
                           <span className="chip">Done</span>
                         </span>
                    ) : (
                        <p className="title text-ink-2 text-center leading-tight">
                           {isOff(habit.day)
                             ? (habit.day.state === 'paused' ? 'Paused' : 'Rest day')
                             : habit.day.session?.title || habit.title}
                        </p>
                    )}
                </div>
            </div>

            {/* The day's checklist */}
            {steps.length > 0 && (
                <div className="flex flex-col gap-3">
                   <div className="flex justify-between items-baseline">
                     <p className="field-label text-ink-2">Checklist for this day</p>
                     <p className="alternative text-ink-muted">{tickedCount} of {steps.length}</p>
                   </div>
                   {isFutureDay && (
                     <p className="alternative text-ink-muted">This day has not come yet.</p>
                   )}
                   <ul className="flex flex-col gap-2">
                   {steps.map((step) => (
                       <li key={step._id}>
                         <button
                            type="button"
                            aria-pressed={ticked.has(step._id)}
                            disabled={isFutureDay}
                            onClick={() => handleToggleStep(step._id)}
                            className={cn(
                              'w-full flex items-center gap-4 p-3.5 rounded-2xl cursor-pointer text-left border disabled:cursor-not-allowed disabled:opacity-60',
                              'transition-colors duration-(--duration-base)',
                              ticked.has(step._id)
                                 ? 'bg-success-soft border-success/30'
                                 : 'bg-surface border-line hover:border-accent/30',
                            )}
                         >
                            <span className={cn(
                              'w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                              ticked.has(step._id) ? 'bg-success text-on-accent' : 'border-2 border-line-strong',
                            )}>
                                {ticked.has(step._id) && (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                )}
                            </span>
                            <span className={cn(
                              'body-bold transition-colors',
                              ticked.has(step._id) ? 'text-ink-muted line-through' : 'text-ink',
                            )}>
                                {step.title}
                            </span>
                         </button>
                       </li>
                   ))}
                   </ul>
                </div>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Mounted only while open, so every edit starts from the habit as it is
          now rather than from whatever was typed and abandoned last time. */}
      {editing && (
        <EditHabitSheet habit={habit} open={editing} onOpenChange={setEditing} />
      )}

      <PublishPlanSheet
        habit={habit}
        open={publishing}
        onOpenChange={setPublishing}
        // Once it is published there is nothing left to come back to: the sheet
        // navigates to the new plan, and this card would otherwise reappear for
        // a frame on the way out.
        onPublished={onClose}
      />
    </Dialog.Root>
  );
}
