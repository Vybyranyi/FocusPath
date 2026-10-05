import FieldError from "@components/ui/FieldError";
import SegmentControl from "@components/ui/SegmentControl";
import Switch from "@components/ui/Switch";
import { cn } from "@/lib/utils";
import {
  TIMES_OF_DAY,
  WEEKDAY_SHORT,
  type ScheduleDraft,
  type ScheduleProblems,
} from "@/lib/schedule";

export interface IScheduleFieldsProps {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  /** Shown beside the fields they belong to. */
  problems?: ScheduleProblems;
  /** Whether the habit builds or quits, so the goal can say "at least" or "at most". */
  type: "build" | "quit";
  /** The part of the day is not editable everywhere; hide it where it is not. */
  showTimeOfDay?: boolean;
}

const FREQUENCIES = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Days" },
  { id: "weekly", label: "Per week" },
];

const inputClass = (invalid?: boolean) =>
  cn(
    "h-11 bg-surface-2 rounded-xl px-3 w-full",
    "text-xs font-normal leading-4 text-ink",
    "border border-transparent transition-colors duration-(--duration-base)",
    "placeholder:text-ink-muted focus:border-accent focus:bg-surface",
    invalid && "border-danger",
  );

/**
 * How often, how much, and when in the day.
 *
 * Used by the create form, the edit sheet and the take-a-plan sheet, so what a
 * rhythm *looks like* is decided once. The draft is held as the strings an
 * `<input>` returns — see `ScheduleDraft` for why it is not a `Frequency`.
 */
export default function ScheduleFields({
  value,
  onChange,
  problems = {},
  type,
  showTimeOfDay = true,
}: IScheduleFieldsProps) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });

  const toggleDay = (day: number) =>
    set({
      weekdays: value.weekdays.includes(day)
        ? value.weekdays.filter((chosen) => chosen !== day)
        : [...value.weekdays, day],
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="field-label mb-1.5">How often</p>
        <SegmentControl
          segments={FREQUENCIES}
          defaultSelectedId={value.frequencyKind}
          label="How often"
          onSelect={(id) => set({ frequencyKind: id as ScheduleDraft["frequencyKind"] })}
        />

        {value.frequencyKind === "weekdays" && (
          <div className="flex flex-col gap-1 mt-2">
            <div role="group" aria-label="Days of the week" className="flex gap-1.5">
              {WEEKDAY_SHORT.map((label, index) => {
                const day = index + 1;
                const chosen = value.weekdays.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "flex-1 min-h-11 rounded-xl chip cursor-pointer",
                      "transition-colors duration-(--duration-fast)",
                      chosen ? "bg-accent text-on-accent" : "bg-surface-2 text-ink-2 hover:bg-line",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <FieldError message={problems.weekdays} className="mt-0" />
          </div>
        )}

        {value.frequencyKind === "weekly" && (
          <div className="flex flex-col gap-1 mt-2">
            <input
              type="number"
              min="1"
              max="7"
              aria-label="Times per week"
              placeholder="Times per week (1-7)"
              value={value.timesPerWeek}
              onChange={(event) => set({ timesPerWeek: event.target.value })}
              className={inputClass(Boolean(problems.timesPerWeek))}
            />
            <p className="alternative text-ink-muted">
              Any days you like, Monday to Sunday. The week is met once you have done that many.
            </p>
            <FieldError message={problems.timesPerWeek} className="mt-0" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <p className="field-label">Count a quantity</p>
            <p className="alternative text-ink-muted font-normal">
              Glasses of water, kilometres, pages — instead of a single tick.
            </p>
          </div>
          <Switch
            label="Count a quantity"
            toggled={value.counted}
            onClick={() => set({ counted: !value.counted })}
          />
        </div>

        {value.counted && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.1"
                aria-label="Daily goal"
                placeholder={type === "build" ? "At least" : "At most"}
                value={value.targetValue}
                onChange={(event) => set({ targetValue: event.target.value })}
                className={inputClass(Boolean(problems.targetValue))}
              />
              <input
                type="text"
                aria-label="Unit"
                placeholder="Unit, e.g. glasses"
                value={value.targetUnit}
                onChange={(event) => set({ targetUnit: event.target.value })}
                className={inputClass(Boolean(problems.targetUnit))}
              />
            </div>
            <p className="alternative text-ink-muted">
              {type === "build"
                ? "The day is done once you reach it."
                : "A limit: going over it fails the day. A clean day is zero."}
            </p>
            <FieldError message={problems.targetValue ?? problems.targetUnit} className="mt-0" />
          </div>
        )}
      </div>

      {showTimeOfDay && (
        <div className="flex flex-col gap-1">
          <p className="field-label mb-1.5">Part of the day</p>
          <SegmentControl
            segments={TIMES_OF_DAY.map(({ value: id, label }) => ({ id, label }))}
            defaultSelectedId={value.timeOfDay}
            label="Part of the day"
            onSelect={(id) => set({ timeOfDay: id as ScheduleDraft["timeOfDay"] })}
          />
        </div>
      )}
    </div>
  );
}
