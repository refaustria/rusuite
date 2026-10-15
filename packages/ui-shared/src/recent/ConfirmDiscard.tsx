import { useSyncExternalStore } from "react";
import { Dialog } from "../Dialog";
import { PromptDialog } from "../shortcuts/PromptDialog";
import type { UnsavedGuard } from "./unsaved";
import { useT } from "../i18n/react";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover";

/**
 * The guard's questions: "Save changes to <name>?" (Save / Don't save /
 * Cancel; Esc = Cancel) and, for an untitled document in the browser, the
 * Save As file name.
 */
export function ConfirmDiscard({ guard }: { guard: UnsavedGuard }) {
  const t = useT();
  const prompt = useSyncExternalStore(guard.subscribe, guard.getState);
  return (
    <>
      <Dialog open={prompt?.kind === "save"} title={t("unsaved.question", { name: prompt?.kind === "save" ? prompt.name : "" })} onClose={() => guard.choose("cancel")}>
        <div className="flex w-96 max-w-[80vw] flex-col gap-3 text-sm" data-testid="confirm-discard">
          <p className="text-ui-muted">{t("unsaved.lost")}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={`${BTN} font-semibold`} onClick={() => guard.choose("save")}>
              {t("unsaved.save")}
            </button>
            <button type="button" className={BTN} onClick={() => guard.choose("discard")}>
              {t("unsaved.dontSave")}
            </button>
            <button type="button" className={BTN} onClick={() => guard.choose("cancel")}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Dialog>
      <PromptDialog
        open={prompt?.kind === "name"}
        title={t("saveAs.title")}
        label={t("saveAs.fileName")}
        initial={prompt?.kind === "name" ? prompt.initial : ""}
        confirmLabel={t("unsaved.save")}
        onClose={() => guard.submitName(null)}
        onSubmit={(name) => guard.submitName(name)}
      />
    </>
  );
}
