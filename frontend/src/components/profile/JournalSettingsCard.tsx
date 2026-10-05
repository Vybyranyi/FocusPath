import Switch from "@components/ui/Switch";
import { setPreferences } from "@store/authSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";

/**
 * Whether to be asked why, right after a habit is marked not done.
 *
 * On by default: the moment of a lapse is the one moment the reason is known, and
 * someone who never sees the question can never answer it. It is a setting
 * because some people will find it nagging, and the app should take that as an
 * answer rather than ask again.
 */
export default function JournalSettingsCard() {
  const dispatch = useAppDispatch();
  const asks = useAppSelector((state) => state.auth.user?.preferences?.askFailureReason !== false);

  return (
    <section className="bg-surface rounded-2xl shadow-lifted p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="title font-bold">Journal</h2>
        <p className="alternative text-ink-2">
          Your reasons and notes are for you — they are never shown on a plan you publish.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="body-light flex-1">Ask why when I don’t do a habit</p>
        <Switch
          label="Ask why when I don't do a habit"
          toggled={asks}
          onClick={() => void dispatch(setPreferences({ askFailureReason: !asks }))}
        />
      </div>
    </section>
  );
}
