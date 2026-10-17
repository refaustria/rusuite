// Excel's Move or Copy dialog (P9-C1): "Before sheet" list with
// "(move to end)", "Create a copy"; one command (moveSheet or
// duplicateSheet with an index), one undo step. Only this workbook is a
// target ("To book" shows its name).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import { useCalc, type CalcStore } from "../state/store";
import { useT } from "../i18n";

const BTN = "h-7 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";

export function MoveCopyDialog({ store, sheet }: { store: CalcStore; sheet: number }) {
  const t = useT();
  const sheets = useCalc(store, (s) => s.info?.sheets) ?? [];
  const book = useCalc(store, (s) => s.name) ?? t("doc.untitled");
  // Positions in the full order; hidden sheets are not listed (as in Excel).
  const listed = sheets.map((s, i) => ({ ...s, at: i })).filter((s) => !s.hidden);
  const [before, setBefore] = useState<number | null>(() => {
    const at = sheets.findIndex((s) => s.id === sheet);
    return sheets[at + 1] ? at + 1 : null;
  });
  const [copy, setCopy] = useState(false);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const option = (at: number | null, label: string) => (
    <button
      key={at ?? "end"}
      type="button"
      role="option"
      aria-selected={before === at}
      className="min-h-7 px-2 text-left hover:bg-ui-hover aria-selected:bg-ui-active"
      onClick={() => setBefore(at)}
    >
      {label}
    </button>
  );
  return (
    <Dialog open title={t("calc.moveCopy.title")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.moveOrCopy(sheet, before, copy);
        }}
      >
        <div className="text-xs text-ui-muted">{t("calc.moveCopy.selected", { name: sheets.find((s) => s.id === sheet)?.name ?? "" })}</div>
        <label className="flex flex-col gap-1">
          {t("calc.moveCopy.toBook")}
          <select className="h-7 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg" aria-label={t("calc.moveCopy.toBook")} disabled>
            <option>{book}</option>
          </select>
        </label>
        <span id="calc-movecopy-before">{t("calc.moveCopy.before")}</span>
        <div role="listbox" aria-labelledby="calc-movecopy-before" className="flex max-h-48 flex-col overflow-auto rounded border border-ui-border bg-ui-bg py-0.5">
          {listed.map((s) => option(s.at, s.name))}
          {option(null, t("calc.moveCopy.toEnd"))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          {t("calc.moveCopy.copy")}
        </label>
        <div className="flex justify-end gap-2">
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
