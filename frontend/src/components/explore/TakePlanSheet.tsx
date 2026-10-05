import { useState } from "react";
import type { Plan } from "@shared/index";
import Button from "@components/ui/Button";
import Input from "@components/ui/Input";
import Modal from "@components/ui/Modal";
import WeekDatePicker from "@components/pickers/WeekDatePicker";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { takePlan } from "@store/plansSlice";
import { useToast } from "@hooks/useToast";
import { toDayKey } from "@/lib/dates";

export interface ITakePlanSheetProps {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Taking a plan.
 *
 * The start date is asked for rather than assumed: the schema refuses a start
 * in the past, so a silent "today" would be the only date that ever worked and
 * would still be wrong for anyone planning to begin on Monday.
 *
 * The length may be changed, and the sheet says plainly what that costs — a
 * clone of a different length no longer matches the plan and drops out of its
 * statistics. Someone who did 30 days of a 90-day plan did not walk that plan,
 * and letting their result count would poison the one number this library is
 * built on.
 */
export default function TakePlanSheet({ plan, open, onOpenChange }: ITakePlanSheetProps) {
  const dispatch = useAppDispatch();
  const { notify } = useToast();
  const taking = useAppSelector((state) => state.plans.taking);
  const error = useAppSelector((state) => state.plans.error);

  const [startDate, setStartDate] = useState<Date>(new Date());
  const [sessions, setSessions] = useState(String(plan.duration));

  const parsedSessions = Number(sessions);
  const sessionsProblem =
    !/^\d+$/.test(sessions) || parsedSessions < 1 || parsedSessions > 365
      ? "Must be a whole number of sessions, 1–365"
      : "";

  const changesLength = !sessionsProblem && parsedSessions !== plan.duration;

  const handleTake = async () => {
    if (sessionsProblem) return;

    try {
      await dispatch(
        takePlan({
          planId: plan._id,
          // The picker hands back local midnight; as a full instant that is the
          // previous day east of Greenwich. It travels as a day key instead.
          startDate: toDayKey(startDate),
          sessions: parsedSessions,
        }),
      ).unwrap();

      // Stays put, like publishing does: you were reading this plan, and the
      // day view is not where you asked to be.
      notify(`“${plan.title}” is now one of your habits`);
      onOpenChange(false);
    } catch {
      // The reason is in the store and rendered below.
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Take “${plan.title}”`}
      description="It becomes a habit of your own — edit any day you like afterwards."
    >
      <WeekDatePicker
        label="Start date"
        selectedDate={startDate}
        onDateSelect={setStartDate}
      />

      <Input
        label="Length in sessions"
        placeholder={String(plan.duration)}
        type="text"
        value={sessions}
        onChange={(event) => setSessions(event.target.value)}
        error={sessionsProblem}
      />

      {changesLength && (
        <p className="alternative text-warning">
          A different length means this is no longer the same route, so your
          result will not count towards this plan’s score.
        </p>
      )}

      <p className="alternative text-ink-muted">
        Whether you finish feeds this plan’s completion rate — anonymously, as a
        number only, and only once ten people have taken it.
      </p>

      {error && (
        <p role="alert" className="alternative text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="outline" size="medium" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="primary"
          size="medium"
          disabled={taking || Boolean(sessionsProblem)}
          onClick={handleTake}
        >
          {taking ? "Adding…" : "Add to my habits"}
        </Button>
      </div>
    </Modal>
  );
}
