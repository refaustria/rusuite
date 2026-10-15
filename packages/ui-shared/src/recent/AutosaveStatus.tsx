import type { AnySession } from "./session";
import { formatTime, useSession } from "./useSession";
import { useT } from "../i18n/react";

/** Status-bar item: "Autosaved 14:05" after the session stored a recovery snapshot. */
export function AutosaveStatus({ session, className }: { session: AnySession; className?: string }) {
  const t = useT();
  const at = useSession(session, (s) => s.lastAutosave);
  if (at === null) return null;
  return (
    <span data-testid="autosave-status" className={className} title={t("autosave.tip")}>
      {t("autosave.status", { time: formatTime(at) })}
    </span>
  );
}
