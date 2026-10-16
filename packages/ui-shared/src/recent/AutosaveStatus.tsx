import type { AnySession } from "./session";
import { formatTime, useSession } from "./useSession";
import { useT } from "../i18n/react";
import { RemoteStatus } from "../connectors/ui/RemoteStatus";

/**
 * Status-bar item: "Autosaved 14:05" after the session stored a recovery snapshot; before it, the
 * connection's name for a document of a cloud connection (P8-36).
 */
export function AutosaveStatus({ session, className }: { session: AnySession; className?: string }) {
  const t = useT();
  const at = useSession(session, (s) => s.lastAutosave);
  const remote = session.connectors && <RemoteStatus connectors={session.connectors} className={className} />;
  if (at === null) return remote ?? null;
  return (
    <>
      {remote}
      <span data-testid="autosave-status" className={className} title={t("autosave.tip")}>
        {t("autosave.status", { time: formatTime(at) })}
      </span>
    </>
  );
}
