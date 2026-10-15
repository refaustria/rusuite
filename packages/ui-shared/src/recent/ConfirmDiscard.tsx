import { useSyncExternalStore } from "react";
import { Dialog } from "../Dialog";
import { PromptDialog } from "../shortcuts/PromptDialog";
import type { UnsavedGuard } from "./unsaved";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 hover:bg-ui-hover";

/**
 * The guard's questions: "Save changes to <name>?" (Save / Don't save /
 * Cancel; Esc = Cancel) and, for an untitled document in the browser, the
 * Save As file name.
 */
export function ConfirmDiscard({ guard }: { guard: UnsavedGuard }) {
  const prompt = useSyncExternalStore(guard.subscribe, guard.getState);
  return (
    <>
      <Dialog open={prompt?.kind === "save"} title={`Save changes to ${prompt?.kind === "save" ? prompt.name : ""}?`} onClose={() => guard.choose("cancel")}>
        <div className="flex w-96 max-w-[80vw] flex-col gap-3 text-sm" data-testid="confirm-discard">
          <p className="text-ui-muted">Your changes will be lost if you don&apos;t save them.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={`${BTN} font-semibold`} onClick={() => guard.choose("save")}>
              Save
            </button>
            <button type="button" className={BTN} onClick={() => guard.choose("discard")}>
              Don&apos;t save
            </button>
            <button type="button" className={BTN} onClick={() => guard.choose("cancel")}>
              Cancel
            </button>
          </div>
        </div>
      </Dialog>
      <PromptDialog
        open={prompt?.kind === "name"}
        title="Save as"
        label="File name"
        initial={prompt?.kind === "name" ? prompt.initial : ""}
        confirmLabel="Save"
        onClose={() => guard.submitName(null)}
        onSubmit={(name) => guard.submitName(name)}
      />
    </>
  );
}
