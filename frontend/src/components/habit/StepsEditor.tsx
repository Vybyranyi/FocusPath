import type { StepDraft } from "@/types/forms";
import { cn } from "@/lib/utils";
import { MAX_STEPS, STEP_TITLE_MAX, stepsProblem } from "@/lib/steps";

export interface IStepsEditorProps {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
}

const RemoveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * The daily checklist, as a list of rows.
 *
 * Steps existed in the API from the start, but nothing in the client could
 * create one — the only habits that had them were ones made by hand through
 * the API. Each row is a plain text field; a blank row is simply not sent,
 * which is kinder than refusing the form over an "add" pressed once too often.
 */
export default function StepsEditor({ steps, onChange }: IStepsEditorProps) {
  const problem = stepsProblem(steps);

  const setTitle = (index: number, title: string) =>
    onChange(steps.map((step, at) => (at === index ? { ...step, title } : step)));

  const remove = (index: number) => onChange(steps.filter((_step, at) => at !== index));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="field-label mb-1.5">Daily checklist (optional)</legend>
      <p className="alternative text-ink-muted -mt-1">
        Small steps to tick each day. Ticking the last one marks the day done.
      </p>

      {steps.length > 0 && (
        <ul className="flex flex-col gap-2">
          {steps.map((step, index) => (
            // Index keys are safe here: every row is controlled, so its text
            // always comes from `steps`, never from the DOM node React reuses.
            <li key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={step.title}
                onChange={(event) => setTitle(index, event.target.value)}
                placeholder={`Step ${index + 1}`}
                aria-label={`Step ${index + 1}`}
                aria-invalid={step.title.trim().length > STEP_TITLE_MAX ? true : undefined}
                className={cn(
                  "flex-1 h-11 text-[1rem] font-medium bg-transparent",
                  "ring-input focus:ring-input-focus placeholder:text-ink-muted",
                  step.title.trim().length > STEP_TITLE_MAX && "ring-input-error",
                )}
              />
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove step ${index + 1}`}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-ink-2 hover:bg-canvas hover:text-danger transition-colors cursor-pointer"
              >
                <RemoveIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {problem && (
        <p role="alert" className="alternative text-danger">
          {problem}
        </p>
      )}

      <button
        type="button"
        onClick={() => onChange([...steps, { title: "" }])}
        disabled={steps.length >= MAX_STEPS}
        className="self-start body-bold text-accent px-1 py-2 min-h-11 cursor-pointer disabled:cursor-not-allowed disabled:text-ink-muted"
      >
        {steps.length >= MAX_STEPS ? `Up to ${MAX_STEPS} steps` : "+ Add step"}
      </button>
    </fieldset>
  );
}
