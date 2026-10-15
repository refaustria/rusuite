// Error toasts (backend errors surface here).

import { useEffect } from "react";
import { useShow, type ShowStore } from "../state/store";
import { useT } from "../i18n";

const TTL_MS = 6000;

export function Toasts({ store }: { store: ShowStore }) {
  const t = useT();
  const toasts = useShow(store, (s) => s.toasts);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((x) => setTimeout(() => store.dismissToast(x.id), TTL_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, store]);
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} role="alert" className="pointer-events-auto flex items-start gap-2 rounded bg-red-700 px-3 py-2 text-sm text-white shadow-lg">
          <span>{toast.message}</span>
          <button type="button" aria-label={t("cmd.dismiss")} className="ml-2 opacity-80 hover:opacity-100" onClick={() => store.dismissToast(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
