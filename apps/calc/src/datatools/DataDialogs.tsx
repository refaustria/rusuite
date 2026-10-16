// The Data tab's dialogs (P8-35): Remove Duplicates (and its result),
// Text to Columns, Goal Seek (and its status), Subtotal, Paste Special,
// opening a text file through the import wizard, Save As CSV and Page
// Layout › Print Titles.

import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { CsvOptions } from "../generated/CsvOptions";
import type { PasteOperation } from "../generated/PasteOperation";
import type { PasteParts } from "../generated/PasteParts";
import type { SubtotalFunction } from "../generated/SubtotalFunction";
import type { TextEncoding } from "../generated/TextEncoding";
import type { TextImportOptions } from "../generated/TextImportOptions";
import { PickBar, RangeField, type Picker } from "../charts/ChartDialogs";
import { parseRange, rangeFormula } from "../charts/refs";
import { colName } from "../grid/address";
import { useT } from "../i18n";
import type { Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";
import { delimited, TextWizard } from "./TextWizard";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

function useClose(store: CalcStore) {
  return () => {
    store.closeDialog();
    store.focusGrid();
  };
}

function Buttons({ onCancel, ok = true, okLabel }: { onCancel: () => void; ok?: boolean; okLabel?: string }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <button type="submit" className={BTN} disabled={!ok}>
        {okLabel ?? t("common.ok")}
      </button>
      <button type="button" className={BTN} onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

/** The label of column `col` in a column list: its header text, else `Column B`. */
export function columnLabel(store: CalcStore, headerRow: number | null, col: number): string {
  const sheet = store.getState().activeSheet;
  const text = headerRow === null ? "" : (store.cache(sheet).cells.get(headerRow)?.get(col)?.display ?? "");
  return text !== "" ? text : `${store.columnWord()} ${colName(col)}`;
}

/** Data › Remove Duplicates: the columns to compare and "My data has headers". */
export function RemoveDuplicatesDialog({ store, range, hasHeader }: { store: CalcStore; range: Range; hasHeader: boolean }) {
  const t = useT();
  const close = useClose(store);
  const all = Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => range.c0 + i);
  const [headers, setHeaders] = useState(hasHeader);
  const [cols, setCols] = useState<Set<number>>(new Set(all));
  return (
    <Dialog open title={t("calc.dup.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (cols.size === 0) return;
          close();
          void store.apply({ type: "removeDuplicates", sheet: store.getState().activeSheet, ...range, columns: [...cols].sort((a, b) => a - b), hasHeader: headers });
        }}
      >
        <p>{t("calc.dup.prompt")}</p>
        <div className="flex gap-2">
          <button type="button" className={BTN} onClick={() => setCols(new Set(all))}>
            {t("calc.dup.selectAll")}
          </button>
          <button type="button" className={BTN} onClick={() => setCols(new Set())}>
            {t("calc.dup.unselectAll")}
          </button>
        </div>
        <label className="flex h-7 items-center gap-2">
          <input type="checkbox" checked={headers} onChange={(e) => setHeaders(e.target.checked)} />
          {t("calc.dup.headers")}
        </label>
        <div role="group" aria-label={t("calc.dup.columns")} className="flex max-h-48 flex-col overflow-auto rounded border border-ui-border p-1">
          {all.map((c) => (
            <label key={c} className="flex h-7 items-center gap-2">
              <input
                type="checkbox"
                checked={cols.has(c)}
                onChange={() =>
                  setCols((s) => {
                    const n = new Set(s);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
              />
              {columnLabel(store, headers ? range.r0 : null, c)}
            </label>
          ))}
        </div>
        <Buttons onCancel={close} ok={cols.size > 0} />
      </form>
    </Dialog>
  );
}

/** Excel's message after Remove Duplicates. */
export function DuplicatesResultDialog({ store, removed, remaining }: { store: CalcStore; removed: number; remaining: number }) {
  const t = useT();
  const close = useClose(store);
  return (
    <Dialog open title={t("calc.dup.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <p data-testid="duplicates-result">{removed === 0 ? t("calc.dup.none") : t("calc.dup.result", { removed, remaining })}</p>
        <div className="flex justify-end">
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Data › Text to Columns over the selected column. */
export function TextToColumnsDialog({ store, range }: { store: CalcStore; range: Range }) {
  const t = useT();
  const close = useClose(store);
  const sheet = store.getState().activeSheet;
  const cells = store.cache(sheet).cells;
  const lines: string[] = [];
  for (let r = range.r0; r <= range.r1; r++) lines.push(cells.get(r)?.get(range.c0)?.display ?? "");
  const text = lines.join("\n");
  const preview = useCallback((txt: string, o: TextImportOptions, max: number) => store.api.splitPreview(txt, o, max), [store]);
  const sep = [";", "\t", ",", "|"].find((c) => text.includes(c)) ?? ";";
  return (
    <TextWizard
      title={t("calc.wizard.ttcTitle")}
      text={text}
      initial={{ split: delimited(sep) }}
      preview={preview}
      dest={`=${rangeFormula({ sheet: null, r0: range.r0, c0: range.c0, r1: range.r0, c1: range.c0 })}`}
      onCancel={close}
      onFinish={(options, dest) => {
        const d = dest ? parseRange(dest) : null;
        close();
        void store.apply({ type: "textToColumns", sheet, r0: range.r0, c0: range.c0, r1: range.r1, options, ...(d ? { dest: [d.r0, d.c0] as [number, number] } : {}) });
      }}
    />
  );
}

/** What-If Analysis › Goal Seek: set cell, to value, by changing cell. */
export function GoalSeekDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const a = store.activeAnchor();
  const [setCell, setSetCell] = useState(`$${colName(a.col)}$${a.row + 1}`);
  const [to, setTo] = useState("");
  const [changing, setChanging] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  const sc = parseRange(setCell);
  const cc = parseRange(changing);
  const target = Number(to);
  const ok = !!sc && !!cc && to.trim() !== "" && Number.isFinite(target);
  return (
    <Dialog open title={t("calc.goal.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          close();
          void store.goalSeek({ row: sc!.r0, col: sc!.c0 }, target, { row: cc!.r0, col: cc!.c0 });
        }}
      >
        <RangeField label={t("calc.goal.setCell")} testId="goal-set" value={setCell} onChange={setSetCell} onPick={(p) => setPicker({ ...p, set: setSetCell })} />
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.goal.toValue")}</span>
          <input className={FIELD} aria-label={t("calc.goal.toValue")} data-testid="goal-to" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <RangeField label={t("calc.goal.changing")} testId="goal-changing" value={changing} onChange={setChanging} onPick={(p) => setPicker({ ...p, set: setChanging })} />
        <Buttons onCancel={close} ok={ok} />
      </form>
    </Dialog>
  );
}

/** Goal Seek Status: OK keeps the value, Cancel undoes it. */
export function GoalSeekStatusDialog({ store, cell, target, result, found }: { store: CalcStore; cell: string; target: number; result: number; found: boolean }) {
  const t = useT();
  const close = useClose(store);
  return (
    <Dialog
      open
      title={t("calc.goal.status")}
      onClose={() => {
        close();
        void store.undo();
      }}
    >
      <form
        className="flex w-80 flex-col gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <p data-testid="goal-status">{found ? t("calc.goal.found", { cell }) : t("calc.goal.notFound", { cell })}</p>
        <p>{t("calc.goal.target", { value: target })}</p>
        <p>{t("calc.goal.current", { value: Number(result.toPrecision(12)) })}</p>
        <div className="flex justify-end gap-2">
          <button type="submit" className={BTN}>
            {t("common.ok")}
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              close();
              void store.undo();
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export const SUBTOTAL_FUNCTIONS: SubtotalFunction[] = ["sum", "count", "average", "max", "min", "product", "countNums", "stdDev", "stdDevP", "var", "varP"];

/** Data › Subtotal: at each change in, use function, add subtotal to, replace, summary below. */
export function SubtotalDialog({ store, range }: { store: CalcStore; range: Range }) {
  const t = useT();
  const close = useClose(store);
  const cols = Array.from({ length: range.c1 - range.c0 + 1 }, (_, i) => range.c0 + i);
  const [groupBy, setGroupBy] = useState(range.c0);
  const [fn, setFn] = useState<SubtotalFunction>("sum");
  const [add, setAdd] = useState<Set<number>>(new Set([range.c1]));
  const [replace, setReplace] = useState(true);
  const [below, setBelow] = useState(true);
  const sheet = store.getState().activeSheet;
  return (
    <Dialog open title={t("calc.subtotal.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (add.size === 0) return;
          close();
          void store.apply({ type: "subtotal", sheet, ...range, groupBy, function: fn, columns: [...add].sort((a, b) => a - b), replace, summaryBelow: below });
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.subtotal.changeIn")}</span>
          <select className={FIELD} value={groupBy} onChange={(e) => setGroupBy(Number(e.target.value))}>
            {cols.map((c) => (
              <option key={c} value={c}>
                {columnLabel(store, range.r0, c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.subtotal.use")}</span>
          <select className={FIELD} value={fn} onChange={(e) => setFn(e.target.value as SubtotalFunction)}>
            {SUBTOTAL_FUNCTIONS.map((f) => (
              <option key={f} value={f}>
                {t(`calc.subtotal.fn.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label={t("calc.subtotal.addTo")} className="flex max-h-40 flex-col overflow-auto rounded border border-ui-border p-1">
          <span className="text-xs">{t("calc.subtotal.addTo")}</span>
          {cols.map((c) => (
            <label key={c} className="flex h-7 items-center gap-2">
              <input
                type="checkbox"
                checked={add.has(c)}
                onChange={() =>
                  setAdd((s) => {
                    const n = new Set(s);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
              />
              {columnLabel(store, range.r0, c)}
            </label>
          ))}
        </div>
        <label className="flex h-7 items-center gap-2">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          {t("calc.subtotal.replace")}
        </label>
        <label className="flex h-7 items-center gap-2">
          <input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} />
          {t("calc.subtotal.below")}
        </label>
        <div className="flex justify-between gap-2">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              close();
              void store.apply({ type: "removeSubtotals", sheet, ...range });
            }}
          >
            {t("calc.subtotal.removeAll")}
          </button>
          <Buttons onCancel={close} ok={add.size > 0} />
        </div>
      </form>
    </Dialog>
  );
}

export const PASTE_PARTS: PasteParts[] = [
  "all", "formulas", "values", "formats", "comments", "validation", "allExceptBorders", "columnWidths", "formulasAndNumberFormats", "valuesAndNumberFormats",
];
export const PASTE_OPERATIONS: PasteOperation[] = ["none", "add", "subtract", "multiply", "divide"];

/** Home › Paste › Paste Special (Ctrl+Alt+V). */
export function PasteSpecialDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const [parts, setParts] = useState<PasteParts>("all");
  const [operation, setOperation] = useState<PasteOperation>("none");
  const [skipBlanks, setSkipBlanks] = useState(false);
  const [transpose, setTranspose] = useState(false);
  const opsOn = ["all", "formulas", "values", "allExceptBorders", "formulasAndNumberFormats", "valuesAndNumberFormats"].includes(parts);
  return (
    <Dialog open title={t("calc.ps.title")} onClose={close}>
      <form
        className="flex w-[30rem] max-w-full flex-col gap-3 text-sm"
        data-testid="paste-special"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.pasteSpecial({ parts, operation: opsOn ? operation : "none", skipBlanks, transpose });
        }}
      >
        <fieldset className="grid grid-cols-2 gap-x-4">
          <legend className="font-medium">{t("calc.ps.paste")}</legend>
          {PASTE_PARTS.map((p) => (
            <label key={p} className="flex h-7 items-center gap-2">
              <input type="radio" name="ps-parts" checked={parts === p} onChange={() => setParts(p)} />
              {t(`calc.ps.part.${p}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="grid grid-cols-3 gap-x-4" disabled={!opsOn}>
          <legend className="font-medium">{t("calc.ps.operation")}</legend>
          {PASTE_OPERATIONS.map((o) => (
            <label key={o} className="flex h-7 items-center gap-2">
              <input type="radio" name="ps-op" checked={operation === o} onChange={() => setOperation(o)} />
              {t(`calc.ps.op.${o}`)}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-6">
          <label className="flex h-7 items-center gap-2">
            <input type="checkbox" checked={skipBlanks} onChange={(e) => setSkipBlanks(e.target.checked)} />
            {t("calc.ps.skipBlanks")}
          </label>
          <label className="flex h-7 items-center gap-2">
            <input type="checkbox" checked={transpose} onChange={(e) => setTranspose(e.target.checked)} data-testid="ps-transpose" />
            {t("calc.ps.transpose")}
          </label>
        </div>
        <div className="flex justify-between gap-2">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              close();
              void store.pasteSpecial({ link: true });
            }}
          >
            {t("calc.ps.link")}
          </button>
          <Buttons onCancel={close} />
        </div>
      </form>
    </Dialog>
  );
}

/** Opening a `.csv` / `.txt` file: the import wizard, then a new document. */
export function TextImportDialog({ store, name, bytesBase64 }: { store: CalcStore; name: string; bytesBase64: string }) {
  const t = useT();
  const close = useClose(store);
  const [decoded, setDecoded] = useState<{ text: string; encoding: TextEncoding; separator: string; decimal: string } | null>(null);
  const load = useCallback(
    (encoding?: TextEncoding) => {
      void store.api.decodeText(bytesBase64, encoding).then(setDecoded, (e) => {
        store.pushError(e);
        close();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, bytesBase64],
  );
  useEffect(() => load(), [load]);
  const preview = useCallback((txt: string, o: TextImportOptions, max: number) => store.api.splitPreview(txt, o, max), [store]);
  if (!decoded) return null;
  return (
    <TextWizard
      key={decoded.encoding}
      title={t("calc.wizard.importTitle", { name })}
      text={decoded.text}
      initial={{ split: delimited(decoded.separator), decimal: decoded.decimal, thousands: decoded.decimal === "," ? "." : "," }}
      preview={preview}
      encoding={{ value: decoded.encoding, onChange: (e) => load(e) }}
      onCancel={close}
      onFinish={(options) => {
        close();
        void store.openText(decoded.text, name, options);
      }}
    />
  );
}

/** Save As › CSV: separator, BOM, quotes; Excel's warning about lost features. */
export function SaveCsvDialog({ store, name }: { store: CalcStore; name?: string }) {
  const t = useT();
  const close = useClose(store);
  const [o, setO] = useState<CsvOptions>({ separator: ",", bom: true, quoteAll: false });
  return (
    <Dialog open title={t("calc.csv.title")} onClose={close}>
      <form
        className="flex w-96 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.saveCsv(o, name);
        }}
      >
        <p className="rounded bg-amber-50 p-2 text-amber-900" data-testid="csv-warning">
          {t("calc.csv.warning")}
        </p>
        <label className="flex items-center gap-2">
          {t("calc.csv.separator")}
          <select className={FIELD} value={o.separator} onChange={(e) => setO({ ...o, separator: e.target.value })}>
            <option value=",">{t("calc.csv.comma")}</option>
            <option value=";">{t("calc.csv.semicolon")}</option>
            <option value={"\t"}>{t("calc.csv.tab")}</option>
            <option value="|">|</option>
          </select>
        </label>
        <label className="flex h-7 items-center gap-2">
          <input type="checkbox" checked={!!o.bom} onChange={(e) => setO({ ...o, bom: e.target.checked })} />
          {t("calc.csv.bom")}
        </label>
        <label className="flex h-7 items-center gap-2">
          <input type="checkbox" checked={!!o.quoteAll} onChange={(e) => setO({ ...o, quoteAll: e.target.checked })} />
          {t("calc.csv.quoteAll")}
        </label>
        <Buttons onCancel={close} okLabel={t("calc.csv.save")} />
      </form>
    </Dialog>
  );
}

/** Page Layout › Print Titles: print area and rows / columns to repeat (the sheet's built-in names). */
export function PrintTitlesDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = useClose(store);
  const sheet = store.getState().activeSheet;
  const names = store.getState().info?.names ?? [];
  const own = (b: "printArea" | "printTitles") => names.find((n) => n.builtin === b && n.sheet === sheet);
  const titles = (own("printTitles")?.refersTo ?? "").replace(/^[^!]*!/g, "");
  const parts = titles.split(",").map((p) => p.replace(/^[^!]*!/, ""));
  const [area, setArea] = useState((own("printArea")?.refersTo ?? "").replace(/^[^!]*!/, ""));
  const [rows, setRows] = useState(parts.find((p) => /^\$?\d+:\$?\d+$/.test(p)) ?? "");
  const [cols, setCols] = useState(parts.find((p) => /^\$?[A-Za-z]+:\$?[A-Za-z]+$/.test(p)) ?? "");
  const rowsOk = rows === "" || /^\$?\d+:\$?\d+$/.test(rows);
  const colsOk = cols === "" || /^\$?[A-Za-z]+:\$?[A-Za-z]+$/.test(cols);
  const areaOk = area === "" || !!parseRange(area);
  return (
    <Dialog open title={t("calc.printTitles.title")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!rowsOk || !colsOk || !areaOk) return;
          close();
          void store.setPrintNames(area, rows, cols);
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.printTitles.area")}</span>
          <input className={`${FIELD} font-mono`} aria-label={t("calc.printTitles.area")} value={area} onChange={(e) => setArea(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.printTitles.rows")}</span>
          <input className={`${FIELD} font-mono`} aria-label={t("calc.printTitles.rows")} placeholder="$1:$1" value={rows} onChange={(e) => setRows(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.printTitles.cols")}</span>
          <input className={`${FIELD} font-mono`} aria-label={t("calc.printTitles.cols")} placeholder="$A:$A" value={cols} onChange={(e) => setCols(e.target.value)} />
        </label>
        <Buttons onCancel={close} ok={rowsOk && colsOk && areaOk} />
      </form>
    </Dialog>
  );
}
