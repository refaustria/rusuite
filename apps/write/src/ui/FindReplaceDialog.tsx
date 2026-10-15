// Find/Replace (Rust-first `FindReplace` command; the patch updates the editor).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { SyncController } from "../sync/SyncPlugin";

const INPUT = "h-7 w-full rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";
const BUTTON = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm text-ui-fg hover:bg-ui-hover disabled:opacity-40";

export function FindReplaceDialog({ ctl, open, onClose }: { ctl: SyncController; open: boolean; onClose: () => void }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const run = async (all: boolean) => {
    setResult(null);
    await ctl.run({ type: "findReplace", find, replace, matchCase, wholeWord, all });
    setResult(ctl.getState().info);
  };
  return (
    <Dialog open={open} title="Find and replace" onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void run(true);
        }}
      >
        <h2 className="font-semibold">Find and replace</h2>
        <label className="flex flex-col gap-1">
          Find
          <input className={INPUT} value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Replace with
          <input className={INPUT} value={replace} onChange={(e) => setReplace(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words
        </label>
        <p role="status" className="min-h-5 text-ui-muted">
          {result}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON} disabled={!find} onClick={() => void run(false)}>
            Replace
          </button>
          <button type="submit" className={BUTTON} disabled={!find}>
            Replace all
          </button>
          <button type="button" className={BUTTON} onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}
