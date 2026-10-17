// Slicer dialogs (P9-C2): Insert Slicers (a checkbox per table column or
// pivot field), Slicer Settings (name, caption, header, sort) and Report
// Connections (the pivot tables of the slicer's cache).

import { useState } from "react";
import { Dialog } from "@rusuite/ui-shared";
import type { SlicerSource } from "../generated/SlicerSource";
import { useT } from "../i18n";
import type { CalcStore } from "../state/store";

const BTN = "h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40";
const FIELD = "h-8 rounded border border-ui-border bg-ui-bg px-2 text-sm";

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

/** The sources Insert Slicers offers: the table's columns or the pivot table's cache fields. */
export function slicerChoices(store: CalcStore, from: { table?: number; pivot?: number }): { label: string; source: SlicerSource }[] {
  if (from.table !== undefined) {
    const t = store.tables.get(from.table)?.table;
    return (t?.columns ?? []).map((c) => ({ label: c.name, source: { kind: "table", table: t!.id, column: c.id } }));
  }
  if (from.pivot !== undefined) {
    const info = store.pivots.info(from.pivot);
    if (!info) return [];
    return info.fields.map((f) => ({ label: f.name, source: { kind: "pivot", cache: info.table.cacheId, field: f.index, pivots: [from.pivot!] } }));
  }
  return [];
}

/** Insert › Slicer / Table Design › Insert Slicer / PivotTable Analyze › Insert Slicer. */
export function InsertSlicersDialog({ store, table, pivot }: { store: CalcStore; table?: number; pivot?: number }) {
  const t = useT();
  const close = useClose(store);
  const choices = slicerChoices(store, { table, pivot });
  const [checked, setChecked] = useState<Set<number>>(new Set());
  return (
    <Dialog open title={t("calc.slicer.insertTitle")} onClose={close}>
      <form
        className="flex w-72 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const sources = choices.filter((_, i) => checked.has(i)).map((c) => c.source);
          if (!sources.length) return;
          close();
          // Right of the data, like Excel.
          const tb = table !== undefined ? store.tables.get(table)?.table : undefined;
          const pv = pivot !== undefined ? store.pivots.get(pivot) : undefined;
          const right = tb ? tb.c1 + 2 : pv ? pv.location.c1 + 2 : store.activeAnchor().col + 1;
          const top = tb ? tb.r0 : pv ? pv.location.r0 : store.activeAnchor().row;
          void store.slicers.insert(sources, { row: top, col: right });
        }}
      >
        <div role="group" aria-label={t("calc.slicer.fields")} className="flex max-h-72 flex-col overflow-auto rounded border border-ui-border p-1" data-testid="slicer-fields">
          {choices.map((c, i) => (
            <label key={`${c.label}:${i}`} className="flex h-7 items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={checked.has(i)}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setChecked(next);
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
        <Buttons onCancel={close} ok={checked.size > 0} />
      </form>
    </Dialog>
  );
}

/** Slicer › Slicer Settings. */
export function SlicerSettingsDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const x = store.slicers.get(id);
  const v = x?.view;
  const [name, setName] = useState(v?.slicer.name ?? "");
  const [caption, setCaption] = useState(v?.slicer.caption ?? "");
  const [header, setHeader] = useState(v?.slicer.showCaption !== false);
  const [sort, setSort] = useState(v?.sort ?? "ascending");
  if (!v) return null;
  const sourceName = v.source.kind === "table" ? (store.tables.get(v.source.table)?.table.columns.find((c) => c.id === (v.source as { column: number }).column)?.name ?? "") : v.slicer.caption;
  return (
    <Dialog open title={t("calc.slicer.settingsTitle")} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          close();
          void store.slicers.update(id, { name: name.trim(), caption, showCaption: header, sort });
        }}
      >
        <div className="text-xs">
          {t("calc.slicer.sourceName")} <span className="font-medium">{sourceName}</span>
        </div>
        <div className="text-xs">
          {t("calc.slicer.formulaName")} <span className="font-mono">{v.slicer.cache}</span>
        </div>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs">{t("calc.slicer.name")}</span>
          <input className={FIELD} aria-label={t("calc.slicer.name")} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs">{t("calc.slicer.header")}</legend>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
            {t("calc.slicer.displayHeader")}
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs">{t("calc.slicer.caption")}</span>
            <input className={FIELD} aria-label={t("calc.slicer.caption")} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-1 rounded border border-ui-border p-2">
          <legend className="px-1 text-xs">{t("calc.slicer.sorting")}</legend>
          <label className="flex items-center gap-2 text-xs">
            <input type="radio" name="slicer-sort" checked={sort === "ascending"} onChange={() => setSort("ascending")} />
            {t("calc.slicer.ascending")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="radio" name="slicer-sort" checked={sort === "descending"} onChange={() => setSort("descending")} />
            {t("calc.slicer.descending")}
          </label>
        </fieldset>
        <Buttons onCancel={close} ok={!!name.trim()} />
      </form>
    </Dialog>
  );
}

/** Slicer › Report Connections: the pivot tables on the slicer's cache. */
export function ReportConnectionsDialog({ store, id }: { store: CalcStore; id: number }) {
  const t = useT();
  const close = useClose(store);
  const v = store.slicers.get(id)?.view;
  const connected = v?.source.kind === "pivot" ? v.source.pivots : [];
  const [checked, setChecked] = useState<Set<number>>(new Set(connected));
  if (!v) return null;
  const sheets = store.getState().info?.sheets ?? [];
  return (
    <Dialog open title={t("calc.slicer.connectionsTitle", { name: v.slicer.name })} onClose={close}>
      <form
        className="flex w-80 flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          void store.slicers.connections(v.slicer.cache, [...checked].sort((a, b) => a - b));
        }}
      >
        <div role="group" aria-label={t("calc.slicer.pivotTables")} className="flex max-h-72 flex-col overflow-auto rounded border border-ui-border p-1">
          {(v.pivotTables ?? []).map((p) => (
            <label key={p.id} className="flex h-7 items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={checked.has(p.id)}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setChecked(next);
                }}
              />
              <span>{p.name}</span>
              <span className="text-ui-muted">{sheets.find((s) => s.id === p.sheet)?.name ?? ""}</span>
            </label>
          ))}
        </div>
        <Buttons onCancel={close} />
      </form>
    </Dialog>
  );
}
