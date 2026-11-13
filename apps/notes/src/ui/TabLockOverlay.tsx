// "Notes is open in another tab" (src/tablock.ts): a blocked tab offers "Use here"; a tab another one took over
// is read-only and offers to use it here again (reloads, so it starts from what the other tab wrote).

import { useSyncExternalStore } from "react";
import { FOCUS_RING } from "@rusuite/ui-shared";
import type { NotesController } from "../controller";
import type { TabLock } from "../tablock";
import { useT } from "../i18n";

export function TabLockOverlay({ ctl, lock }: { ctl: NotesController; lock: TabLock }) {
  const t = useT();
  const state = useSyncExternalStore(lock.subscribe, lock.getState);
  if (state !== "blocked" && state !== "lost") return null;
  const lost = state === "lost";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" data-testid="tab-lock" data-state={state}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="tab-lock-title" className="flex max-w-md flex-col gap-3 rounded-lg bg-ui-bg p-5 text-sm shadow-xl">
        <h2 id="tab-lock-title" className="text-lg font-semibold">
          {t(lost ? "notes.lock.lostTitle" : "notes.lock.title")}
        </h2>
        <p>{t(lost ? "notes.lock.lostText" : "notes.lock.text")}</p>
        <div className="flex justify-end">
          <button
            type="button"
            autoFocus
            data-testid="tab-lock-use-here"
            className={`rounded bg-[var(--notes-accent)] px-3 py-1.5 text-white hover:brightness-110 ${FOCUS_RING}`}
            onClick={() =>
              void lock.takeOver().then(() => {
                if (lost) location.reload();
                else void ctl.start();
              })
            }
          >
            {t("notes.lock.useHere")}
          </button>
        </div>
      </div>
    </div>
  );
}
