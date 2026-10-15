import type { AnySession } from "./session";
import { formatTime, useSession } from "./useSession";

/** Status-bar item: "Autosaved 14:05" after the session stored a recovery snapshot. */
export function AutosaveStatus({ session, className }: { session: AnySession; className?: string }) {
  const at = useSession(session, (s) => s.lastAutosave);
  if (at === null) return null;
  return (
    <span data-testid="autosave-status" className={className} title="A recovery copy of the unsaved changes was stored">
      Autosaved {formatTime(at)}
    </span>
  );
}
