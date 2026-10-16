// Table dialogs (P8-35): Create Table (Ctrl+T, "My table has headers"),
// Resize Table and the totals row dropdown.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { TotalsCell } from "../generated/TotalsCell";
import type { TotalsFunction } from "../generated/TotalsFunction";
import { PickBar, RangeField, type Picker } from "../charts/ChartDialogs";
import { parseRange, rangeFormula } from "../charts/refs";
import { useT } from "../i18n";
import type { Range } from "../grid/Selection";
import type { CalcStore } from "../state/store";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const ITEM = "flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-ui-hover";

/** The totals row functions in Excel's dropdown order. */
export const TOTALS_FUNCTIONS: TotalsFunction[] = ["average", "count", "countNums", "max", "min", "sum", "stdDev", "var"];

function useClose(store: CalcStore) {
  return () => {
    store.closeDialog();
    store.focusGrid();
  };
}

function Buttons({ onCancel, ok = true }: { onCancel: () => void; ok?: boolean }) {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <button type="submit" className={BTN} disabled={!ok}>
        {t("common.ok")}
      </button>
      <button type="button" className={BTN} onClick={onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

/** `$A$1:$C$9` of a range on the active sheet. */
export function rangeText(r: Range): string {
  return rangeFormula({ sheet: null, ...r });
}

/** Insert › Table: "Where is the data for your table?" and "My table has headers". */
export function CreateTableDialog({ store, range, hasHeaders }: { store: CalcStore; range: Range; hasHeaders: boolean }) {
  const t = useT();
  const close = useClose(store);
  const [text, setText] = useState(() => `=${rangeText(range)}`);
  const [headers, setHeaders] = useState(hasHeaders);
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  const r = parseRange(text);
  return (
    <Dialog open title={t("calc.table.createTitle")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!r) return;
          close();
          void store.tables.create(headers, { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 });
        }}
      >
        <RangeField label={t("calc.table.where")} testId="table-range" value={text} onChange={setText} onPick={(p) => setPicker({ ...p, set: setText })} />
        <label className="flex h-8 items-center gap-2">
          <input type="checkbox" checked={headers} onChange={(e) => setHeaders(e.target.checked)} data-testid="table-has-headers" />
          {t("calc.table.hasHeaders")}
        </label>
        <Buttons onCancel={close} ok={!!r} />
      </form>
    </Dialog>
  );
}

/** Table Design › Resize Table: the new range (headers stay in their row). */
export function ResizeTableDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const table = store.tables.get(id)?.table;
  const [text, setText] = useState(() => (table ? `=${rangeText(table)}` : ""));
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  if (!table) return null;
  const r = parseRange(text);
  const sameHeader = !!r && (!table.headerRow || r.r0 === table.r0);
  return (
    <Dialog open title={t("calc.table.resizeTitle")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!r || !sameHeader) return;
          close();
          void store.tables.resize(id, { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 });
        }}
      >
        <RangeField label={t("calc.table.newRange")} value={text} onChange={setText} onPick={(p) => setPicker({ ...p, set: setText })} />
        {r && !sameHeader && <span className="text-xs text-red-700">{t("calc.table.headerStays")}</span>}
        <p className="text-xs text-ui-muted">{t("calc.table.resizeNote")}</p>
        <Buttons onCancel={close} ok={!!r && sameHeader} />
      </form>
    </Dialog>
  );
}

/** The totals cell dropdown: None, the functions, More Functions… (a custom formula). */
export function TotalsMenu({ store, id, col, at }: { store: CalcStore; id: number; col: number; at: { x: number; y: number } }) {
  const t = useT();
  const close = useClose(store);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const table = store.tables.get(id)?.table;
  const current = table?.columns[col - (table?.c0 ?? 0)]?.totals;
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0, h = el?.offsetHeight ?? 0;
    setPos({ x: Math.max(0, Math.min(at.x, window.innerWidth - w - 4)), y: Math.max(0, Math.min(at.y, window.innerHeight - h - 4)) });
  }, [at]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  });
  if (!table) return null;
  const pick = (totals: TotalsCell | null) => () => {
    close();
    void store.tables.setTotals(id, col, totals);
  };
  const checked = (f: TotalsFunction | null) => (f === null ? !current : current?.kind === "function" && current.function === f);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("calc.table.totalsMenu")}
      data-testid="totals-menu"
      className="fixed z-50 flex w-48 flex-col rounded border border-ui-border bg-ui-panel p-1 text-sm text-ui-fg shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <button type="button" role="menuitemradio" aria-checked={checked(null)} className={ITEM} onClick={pick(null)}>
        {t("calc.table.totals.none")}
      </button>
      {TOTALS_FUNCTIONS.map((f) => (
        <button key={f} type="button" role="menuitemradio" aria-checked={checked(f)} className={ITEM} onClick={pick({ kind: "function", function: f })}>
          {t(`calc.table.totals.${f}`)}
        </button>
      ))}
      <div role="separator" className="my-0.5 border-t border-ui-border" />
      <button
        type="button"
        role="menuitem"
        className={ITEM}
        onClick={() => {
          close();
          // More Functions…: the totals cell gets a formula to finish (Insert Function).
          store.openDialog({ kind: "insertFunction" });
        }}
      >
        {t("calc.table.totals.more")}
      </button>
    </div>
  );
}
