// Error toasts (backend errors surface here).

import { useEffect, useSyncExternalStore } from "react";
import type { SyncController } from "../sync/SyncPlugin";
import { useT } from "../i18n";

const TTL_MS = 6000;

export function Toasts({ ctl }: { ctl: SyncController }) {
  const t = useT();
  const toasts = useSyncExternalStore(ctl.subscribe, () => ctl.getState().toasts);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((x) => setTimeout(() => ctl.dismissToast(x.id), TTL_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, ctl]);
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} role="alert" className="pointer-events-auto flex items-start gap-2 rounded bg-red-700 px-3 py-2 text-sm text-white shadow-lg">
          <span>{toast.message}</span>
          <button type="button" aria-label={t("cmd.dismiss")} className="ml-2 opacity-80 hover:opacity-100" onClick={() => ctl.dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
