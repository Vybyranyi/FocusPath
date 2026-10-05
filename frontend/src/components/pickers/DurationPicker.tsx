import FieldError from "@components/ui/FieldError";
import Switch from "@components/ui/Switch";
import { cn } from "@/lib/utils";

export interface IDurationPickerProps {
  /** The AI picks the length; the sessions field is hidden and nothing typed is sent. */
  autoDuration: boolean;
  /** No programme at all: the habit simply goes on. */
  noEnd: boolean;
  duration: string;
  onAiToggle: () => void;
  onNoEndToggle: () => void;
  onDurationChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDurationBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
  error?: string;
  disabled?: boolean;
}

export default function DurationPicker({
  autoDuration,
  noEnd,
  duration,
  onAiToggle,
  onNoEndToggle,
  onDurationChange,
  onDurationBlur,
  error,
  disabled,
}: IDurationPickerProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="field-label mb-1.5" id="duration-heading">Length of the programme</p>

      <div className="bg-surface ring-card rounded-2xl p-[18px_16px] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="alternative text-ink-muted font-normal flex-1">
            No end — a habit for as long as you keep it
          </p>
          <Switch
            label="No end"
            toggled={noEnd}
            onClick={onNoEndToggle}
            disabled={disabled}
          />
        </div>

        {!noEnd && (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="alternative text-ink-muted font-normal flex-1">
                Let AI determine the optimal number of sessions
              </p>
              <Switch
                label="Let AI choose the number of sessions"
                toggled={autoDuration}
                onClick={onAiToggle}
                disabled={disabled}
              />
            </div>

            {!autoDuration && (
              <input
                type="number"
                min="1"
                max="365"
                aria-label="Number of sessions"
                placeholder="Enter number of sessions (1-365)"
                value={duration}
                onChange={onDurationChange}
                onBlur={onDurationBlur}
                disabled={disabled}
                className={cn(
                  "h-11 bg-surface-2 rounded-xl px-3",
                  "text-xs font-normal leading-4 text-ink",
                  "border border-transparent transition-colors duration-(--duration-base)",
                  "placeholder:text-ink-muted",
                  "focus:border-accent focus:bg-surface",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  error && "border-danger",
                )}
              />
            )}
          </>
        )}
      </div>

      <FieldError message={error} className="mt-0" />
    </div>
  );
}
