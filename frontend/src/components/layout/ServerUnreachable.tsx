import { useEffect } from "react";
import Button from "@components/ui/Button";

export interface IServerUnreachableProps {
  onRetry: () => void;
}

/**
 * Shown instead of the login form when the session could not be checked at
 * all. Sending someone who is signed in to a login form they cannot submit —
 * there is no network to submit it to — only adds a second problem to the
 * first. This says what is actually wrong, and tries again by itself as soon
 * as the browser reports a connection.
 */
export default function ServerUnreachable({ onRetry }: IServerUnreachableProps) {
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);

  return (
    <div role="alert" className="flex items-center justify-center h-screen bg-canvas page-gutter">
      <div className="flex flex-col items-center gap-4 text-center max-w-86">
        <h1 className="display-5 text-ink">Can’t reach FocusPath</h1>
        <p className="body-light text-ink-2">
          Check your connection. Your habits are safe — they will be here as soon as the
          app can reach the server again.
        </p>
        <div className="w-full sm:max-w-56">
          <Button type="primary" size="medium" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
