// Data › Consolidate (P9-C2: function, references with Add / Delete,
// labels in top row / left column, create links to source data) and the
// Outline settings dialog (summary rows below / columns right, Create =
// Auto Outline).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { CalcCommand } from "../generated/CalcCommand";
import type { ConsolidateFunction } from "../generated/ConsolidateFunction";
import type { SheetRect } from "../generated/SheetRect";
import { PickBar, RangeField, type Picker } from "../charts/ChartDialogs";
import { parseRange } from "../charts/refs";
import { normalize } from "../grid/Selection";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm text-ui-fg";

/** The functions in the dialog's order. */
export const CONSOLIDATE_FUNCTIONS: ConsolidateFunction[] = ["sum", "count", "average", "max", "min", "product", "countNums", "stdDev", "stdDevP", "var", "varP"];

/** What the dialog remembers between uses (Excel keeps it for the session). */
export interface ConsolidateState {
  function: ConsolidateFunction;
  refs: string[];
  topRow: boolean;
  leftCol: boolean;
  links: boolean;
}

export const DEFAULT_CONSOLIDATE: ConsolidateState = { function: "sum", refs: [], topRow: false, leftCol: false, links: false };

/** A reference of the list as a sheet rectangle (`null`: not a reference or unknown sheet). */
export function refRect(text: string, sheets: readonly { id: number; name: string }[], active: number): SheetRect | null {
  const r = parseRange(text);
  if (!r) return null;
  const sheet = r.sheet === null ? active : sheets.find((s) => s.name.toLowerCase() === r.sheet!.toLowerCase())?.id;
  return sheet === undefined ? null : { sheet, r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c1 };
}

/** The Consolidate command for the dialog's state at `(row, col)` of `sheet` (`null`: a reference is invalid or none). */
export function consolidateCommand(s: ConsolidateState, sheets: readonly { id: number; name: string }[], sheet: number, row: number, col: number): CalcCommand | null {
  const sources = s.refs.map((r) => refRect(r, sheets, sheet));
  if (!sources.length || sources.some((r) => r === null)) return null;
  return { type: "consolidate", sheet, row, col, function: s.function, sources: sources as SheetRect[], topRow: s.topRow, leftCol: s.leftCol, links: s.links };
}

export function ConsolidateDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const [st, setSt] = useState<ConsolidateState>(store.consolidateState);
  const [ref, setRef] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  if (picker) return <PickBar store={store} picker={picker} onDone={() => setPicker(null)} />;
  const sheets = store.getState().info?.sheets ?? [];
  const active = store.getState().activeSheet;
  const update = (patch: Partial<ConsolidateState>) => {
    const next = { ...st, ...patch };
    setSt(next);
    store.consolidateState = next;
  };
  const valid = (text: string) => refRect(text, sheets, active) !== null;
  return (
    <Dialog open title={t("calc.consolidate.title")} onClose={close}>
      <form
        className="flex w-[26rem] flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const sel = normalize(store.getState().selection);
          const cmd = consolidateCommand(st, sheets, active, sel.r0, sel.c0);
          if (!cmd) return;
          close();
          void store.applyChecked(cmd);
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.consolidate.function")}</span>
          <select className={FIELD} aria-label={t("calc.consolidate.function")} value={st.function} onChange={(e) => update({ function: e.target.value as ConsolidateFunction })}>
            {CONSOLIDATE_FUNCTIONS.map((f) => (
              <option key={f} value={f}>
                {t(`calc.consolidate.fn.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <RangeField label={t("calc.consolidate.reference")} testId="consolidate-ref" value={ref} onChange={setRef} onPick={(p) => setPicker({ ...p, set: setRef })} />
          </div>
          <button
            type="button"
            className={BTN}
            disabled={!valid(ref) || st.refs.includes(ref.replace(/^=/, ""))}
            onClick={() => {
              update({ refs: [...st.refs, ref.replace(/^=/, "")] });
              setRef("");
            }}
          >
            {t("calc.consolidate.add")}
          </button>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-xs">{t("calc.consolidate.all")}</span>
            <div role="listbox" aria-label={t("calc.consolidate.all")} className="flex h-28 flex-col overflow-auto rounded border border-ui-border">
              {st.refs.map((r, i) => (
                <div
                  key={r}
                  role="option"
                  aria-selected={picked === i}
                  tabIndex={0}
                  className={`cursor-default px-2 py-0.5 font-mono text-xs ${picked === i ? "bg-ui-active" : "hover:bg-ui-hover"}`}
                  onClick={() => {
                    setPicked(i);
                    setRef(r);
                  }}
                >
                  {r}
                </div>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={`${BTN} self-end`}
            disabled={picked === null}
            onClick={() => {
              update({ refs: st.refs.filter((_, i) => i !== picked) });
              setPicked(null);
            }}
          >
            {t("calc.consolidate.delete")}
          </button>
        </div>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs">{t("calc.consolidate.labels")}</legend>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={st.topRow} onChange={(e) => update({ topRow: e.target.checked })} />
            {t("calc.consolidate.topRow")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={st.leftCol} onChange={(e) => update({ leftCol: e.target.checked })} />
            {t("calc.consolidate.leftCol")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={st.links} onChange={(e) => update({ links: e.target.checked })} />
            {t("calc.consolidate.links")}
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="submit" className={BTN} disabled={st.refs.length === 0}>
            {t("common.ok")}
          </button>
          <button type="button" className={BTN} onClick={close}>
            {t("common.close")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Data › Outline settings: where summaries sit; Create runs Auto Outline. */
export function OutlineSettingsDialog({ store }: { store: CalcStore }) {
  const t = useT();
  const props = store.outlineProps();
  const [below, setBelow] = useState(props.summaryBelow);
  const [right, setRight] = useState(props.summaryRight);
  const close = () => {
    store.closeDialog();
    store.focusGrid();
  };
  const sheet = store.getState().activeSheet;
  const save = async () => {
    if (below !== props.summaryBelow || right !== props.summaryRight) await store.applyChecked({ type: "setOutlineProps", sheet, props: { summaryBelow: below, summaryRight: right } });
  };
  return (
    <Dialog open title={t("calc.outline.settingsTitle")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void save();
        }}
      >
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs">{t("calc.outline.direction")}</legend>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} />
            {t("calc.outline.summaryBelow")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={right} onChange={(e) => setRight(e.target.checked)} />
            {t("calc.outline.summaryRight")}
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              close();
              void save().then(() => store.autoOutline());
            }}
          >
            {t("calc.outline.create")}
          </button>
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
