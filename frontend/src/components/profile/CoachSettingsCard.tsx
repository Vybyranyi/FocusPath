import Select from "@components/ui/Select";
import Switch from "@components/ui/Switch";
import { setPreferences } from "@store/authSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { PLAN_LANGUAGE_LABELS } from "@/lib/planLanguages";

/** "Automatic" is the empty value: the language the habits are named in. */
const AUTO = "";

const OPTIONS = [
  { value: AUTO, label: "Automatic — the language of your habits" },
  ...Object.entries(PLAN_LANGUAGE_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * What the coach is allowed to do with what the person has written.
 *
 * Off by default, and said plainly: the numbers — how often, how much, which
 * reason came up — carry most of the coach's value without a word of anything
 * personal leaving the account. Reading notes sends them to OpenAI, and that is
 * the sentence the switch sits under, not a footnote.
 */
export default function CoachSettingsCard() {
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.auth.user?.preferences);
  const language = preferences?.coachLanguage ?? AUTO;
  const reads = preferences?.coachReadsNotes === true;

  return (
    <section className="bg-surface rounded-2xl shadow-lifted p-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="title font-bold">Coach</h2>
        <p className="alternative text-ink-2">
          Once a week the coach looks over your habits, and now and then points out a
          pattern. It never changes anything without your tap.
        </p>
      </div>

      <Select
        label="Language"
        placeholder="Automatic"
        options={OPTIONS}
        value={language}
        onChange={(event) =>
          void dispatch(setPreferences({ coachLanguage: event.target.value || null }))
        }
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="body-light flex-1">Let the coach read my notes</p>
          <Switch
            label="Let the coach read my notes"
            toggled={reads}
            onClick={() => void dispatch(setPreferences({ coachReadsNotes: !reads }))}
          />
        </div>
        <p className="alternative text-ink-muted">
          Off by default. When on, the notes on your habit days and the words in your
          journal from the last two weeks — short extracts of them — are sent to OpenAI
          to write your review. Your name, email and anything that identifies you are
          never sent, and neither is anything when this is off.
        </p>
      </div>
    </section>
  );
}
