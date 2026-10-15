// Error toasts (backend errors surface here).

import { useEffect, useSyncExternalStore } from "react";
import type { SyncController } from "../sync/SyncPlugin";

const TTL_MS = 6000;

export function Toasts({ ctl }: { ctl: SyncController }) {
  const toasts = useSyncExternalStore(ctl.subscribe, () => ctl.getState().toasts);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => ctl.dismissToast(t.id), TTL_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, ctl]);
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role="alert" className="pointer-events-auto flex items-start gap-2 rounded bg-red-700 px-3 py-2 text-sm text-white shadow-lg">
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" className="ml-2 opacity-80 hover:opacity-100" onClick={() => ctl.dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
