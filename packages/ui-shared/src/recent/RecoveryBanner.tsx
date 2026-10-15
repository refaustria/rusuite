import { useState } from "react";
import type { AnySession } from "./session";
import { formatTime, useSession } from "./useSession";

const BTN =
  "h-6 rounded border border-ui-border bg-ui-bg px-2 text-xs text-ui-fg hover:bg-ui-hover disabled:opacity-50";

/**
 * "Recovered document" banner: unsaved documents of earlier sessions
 * (crash, or closed while modified), each with Restore / Discard.
 */
export function RecoveryBanner({ session }: { session: AnySession }) {
  const s = session;
  const recoveries = useSession(s, (st) => st.recoveries);
  const [busy, setBusy] = useState<string | null>(null);
  if (recoveries.length === 0) return null;
  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return (
    <section
      role="region"
      aria-label="Recovered documents"
      data-testid="recovery-banner"
      className="flex flex-col gap-1 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">
        {recoveries.length === 1 ? "Recovered document" : `${recoveries.length} recovered documents`}: unsaved changes from an
        earlier session.
      </p>
      <ul className="flex flex-col gap-1">
        {recoveries.map((r) => (
          <li key={r.id} className="flex items-center gap-2" data-testid="recovery-entry">
            <span className="min-w-0 truncate">
              <strong>{r.name ?? "Untitled"}</strong> <span className="opacity-75">autosaved {formatTime(r.savedAt)}</span>
            </span>
            <button
              type="button"
              className={BTN}
              disabled={busy !== null}
              aria-label={`Restore ${r.name ?? "Untitled"}`}
              onClick={() => void run(r.id, () => s.restore(r.id))}
            >
              Restore
            </button>
            <button
              type="button"
              className={BTN}
              disabled={busy !== null}
              aria-label={`Discard ${r.name ?? "Untitled"}`}
              onClick={() => void run(r.id, () => s.discard(r.id))}
            >
              Discard
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
