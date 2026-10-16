// The PivotTable Fields pane (P8-33), right of the grid as in Excel 365:
// the source fields with checkboxes and a search box, the four areas
// (Filters, Columns, Rows, Values) with drag and drop between and within
// them (pointer events; dropping outside the areas removes a field), a
// menu per area entry (move, remove, Field Settings… / Value Field
// Settings…) and Defer Layout Update with Update.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ContextMenu, type ContextMenuItem } from "@rusuite/ui-shared";
import type { PivotFieldInfo } from "../generated/PivotFieldInfo";
import type { PivotInfo } from "../generated/PivotInfo";
import { useT } from "../i18n";
import { useCalc, type CalcStore } from "../state/store";
import { addField, AREAS, areaItems, captionOf, isUsed, moveItem, removeItem, searchFields, toggleField, type Area, type AreaItem, type PaneLayout } from "./model";

/** Where a dragged entry comes from. */
export type DragSource = { kind: "list"; field: number } | { kind: "area"; area: Area; index: number };

/** The insertion index among entries with vertical extents `rects` for a pointer at `y`. */
export function dropIndex(rects: readonly { top: number; bottom: number }[], y: number): number {
  for (let i = 0; i < rects.length; i++) if (y < (rects[i]!.top + rects[i]!.bottom) / 2) return i;
  return rects.length;
}

/** The layout after dropping `src` on `to` (`null` = outside every area: an area entry is removed). */
export function dropLayout(l: PaneLayout, src: DragSource, to: { area: Area; index: number } | null, fields: readonly PivotFieldInfo[]): PaneLayout {
  const kind = (f: number) => fields.find((x) => x.index === f)?.kind;
  if (src.kind === "list") return to ? addField(l, src.field, to.area, to.index, kind(src.field)) : l;
  if (!to) return removeItem(l, src.area, src.index);
  return moveItem(l, { area: src.area, index: src.index }, to, kind);
}

const AREA_LABEL: Record<Area, string> = { filters: "calc.pivot.area.filters", cols: "calc.pivot.area.cols", rows: "calc.pivot.area.rows", values: "calc.pivot.area.values" };
const AREA_ICON: Record<Area, string> = { filters: "▽", cols: "▥", rows: "▤", values: "Σ" };

export function PivotPane({ store }: { store: CalcStore }) {
  const t = useT();
  useCalc(store, (s) => s.version);
  useCalc(store, (s) => s.selection);
  const pivots = store.pivots;
  const shown = pivots.paneShown();
  const info = shown ? pivots.info(shown.id) : null;
  const layout = shown && info ? pivots.layout(shown.id) : null;
  if (!shown) return null;
  return (
    <aside
      className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-ui-border bg-ui-panel p-3 text-sm text-ui-fg"
      aria-label={t("calc.pivot.fields")}
      data-testid="pivot-pane"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          store.focusGrid();
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("calc.pivot.fields")}</h2>
        <button type="button" className="h-8 w-8 rounded text-sm hover:bg-ui-hover" aria-label={t("common.close")} onClick={() => pivots.togglePane()}>
          ✕
        </button>
      </div>
      {info && layout ? <PaneBody key={shown.id} store={store} id={shown.id} info={info} layout={layout} /> : <p className="text-ui-muted">{t("calc.filter.loading")}</p>}
    </aside>
  );
}

function PaneBody({ store, id, info, layout }: { store: CalcStore; id: number; info: PivotInfo; layout: PaneLayout }) {
  const t = useT();
  const pivots = store.pivots;
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null);
  const [drag, setDrag] = useState<{ src: DragSource; label: string; x: number; y: number; over: { area: Area; index: number } | null; outside: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const press = useRef<{ src: DragSource; label: string; x: number; y: number; started: boolean } | null>(null);
  const ro = !!info.readOnly;
  const fieldName = (f: number) => info.fields[f]?.name ?? "";
  const itemLabel = (it: AreaItem): string =>
    it.kind === "values" ? t("calc.pivot.sigmaValues") : it.kind === "data" ? captionOf(layout.values[it.index]!, fieldName(it.field)) : fieldName(it.field);
  const apply = (next: PaneLayout) => void pivots.setLayout(id, next);

  /** The area and insertion index under a viewport point (`outside`: the pointer left the pane's areas). */
  const targetAt = (x: number, y: number): { over: { area: Area; index: number } | null; outside: boolean } => {
    const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
    const box = el?.closest<HTMLElement>("[data-pivot-area]");
    if (!box) return { over: null, outside: !el?.closest("[data-testid='pivot-pane']") };
    const area = box.dataset.pivotArea as Area;
    const rects = [...box.querySelectorAll<HTMLElement>("[data-pivot-item]")].map((n) => n.getBoundingClientRect());
    return { over: { area, index: dropIndex(rects, y) }, outside: false };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (!p.started && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
      p.started = true;
      setDrag({ src: p.src, label: p.label, x: e.clientX, y: e.clientY, ...targetAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      press.current = null;
      if (!p?.started) return;
      setDrag(null);
      const { over, outside } = targetAt(e.clientX, e.clientY);
      if (!over && !(outside && p.src.kind === "area")) return;
      const cur = pivots.layout(id);
      if (cur) apply(dropLayout(cur, p.src, over, info.fields));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const startDrag = (e: ReactPointerEvent, src: DragSource, label: string) => {
    if (ro || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("input,button")) return;
    press.current = { src, label, x: e.clientX, y: e.clientY, started: false };
  };

  const itemMenu = (area: Area, index: number, it: AreaItem, at: { x: number; y: number }) => {
    const items = areaItems(layout, area);
    const mv = (to: { area: Area; index: number | null }) => () => apply(moveItem(layout, { area, index }, to, (f) => info.fields[f]?.kind));
    const entries: ContextMenuItem[] = [
      { id: "up", label: t("calc.pivot.moveUp"), disabled: index === 0, onSelect: mv({ area, index: index - 1 }) },
      { id: "down", label: t("calc.pivot.moveDown"), disabled: index >= items.length - 1, onSelect: mv({ area, index: index + 2 }) },
      { id: "begin", label: t("calc.pivot.moveBegin"), disabled: index === 0, onSelect: mv({ area, index: 0 }) },
      { id: "end", label: t("calc.pivot.moveEnd"), disabled: index >= items.length - 1, onSelect: mv({ area, index: null }) },
      { separator: true },
    ];
    for (const a of AREAS) {
      if (a === area) continue;
      if (it.kind === "values" && (a === "filters" || a === "values")) continue;
      entries.push({ id: `to-${a}`, label: t(`calc.pivot.moveTo.${a}`), onSelect: mv({ area: a, index: null }) });
    }
    entries.push({ separator: true });
    if (it.kind !== "values") entries.push({ id: "remove", label: t("calc.pivot.removeField"), onSelect: () => apply(removeItem(layout, area, index)) });
    if (it.kind === "data") entries.push({ id: "vfs", label: t("calc.pivot.valueFieldSettings"), onSelect: () => store.openDialog({ kind: "pivotValueField", id, index: it.index }) });
    else if (it.kind === "field") entries.push({ id: "fs", label: t("calc.pivot.fieldSettings"), onSelect: () => store.openDialog({ kind: "pivotFieldSettings", id, field: it.field }) });
    setMenu({ at, items: entries });
  };

  const fields = searchFields(info.fields, search);
  return (
    <div ref={root} className="flex flex-col gap-2">
      {ro && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{t("calc.pivot.readOnly")}</p>}
      <p className="text-xs text-ui-muted">{t("calc.pivot.chooseFields")}</p>
      <input type="search" className="h-8 rounded border border-ui-border bg-ui-bg px-2" aria-label={t("calc.pivot.searchFields")} placeholder={t("calc.pivot.searchFields")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="flex max-h-56 flex-col overflow-auto rounded border border-ui-border bg-ui-bg" aria-label={t("calc.pivot.fieldList")} data-testid="pivot-field-list">
        {fields.map((f) => (
          <li
            key={f.index}
            className="flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-2 px-2 hover:bg-ui-hover"
            data-pivot-field={f.index}
            onPointerDown={(e) => startDrag(e, { kind: "list", field: f.index }, f.name)}
          >
            <input type="checkbox" aria-label={f.name} checked={isUsed(layout, f.index)} disabled={ro} onChange={() => apply(toggleField(layout, f.index, f.kind))} />
            <span className="flex-1 truncate">{f.name}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ui-muted">{t("calc.pivot.dragBetween")}</p>
      <div className="grid grid-cols-2 gap-2">
        {AREAS.map((area) => {
          const items = areaItems(layout, area);
          const over = drag?.over?.area === area ? drag.over.index : null;
          return (
            <section key={area} className="flex min-h-28 flex-col rounded border border-ui-border bg-ui-bg" aria-label={t(AREA_LABEL[area])}>
              <h3 className="flex items-center gap-1 border-b border-ui-border px-2 py-1 text-xs font-medium">
                <span aria-hidden="true">{AREA_ICON[area]}</span>
                {t(AREA_LABEL[area])}
              </h3>
              <ul className="flex flex-1 flex-col p-1" data-pivot-area={area} data-testid={`pivot-area-${area}`}>
                {items.map((it, index) => (
                  <li
                    key={`${it.kind}:${"field" in it ? it.field : "s"}:${index}`}
                    data-pivot-item=""
                    className={`flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-1 rounded border border-ui-border bg-ui-panel px-2 text-xs ${over === index ? "border-t-2 border-t-[#217346]" : ""}`}
                    onPointerDown={(e) => startDrag(e, { kind: "area", area, index }, itemLabel(it))}
                  >
                    <span className="flex-1 truncate">{itemLabel(it)}</span>
                    <button
                      type="button"
                      className="h-7 w-7 rounded hover:bg-ui-hover"
                      aria-label={t("calc.pivot.itemMenu", { name: itemLabel(it) })}
                      disabled={ro}
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        itemMenu(area, index, it, { x: r.left, y: r.bottom });
                      }}
                    >
                      ▾
                    </button>
                  </li>
                ))}
                {over === items.length && <li aria-hidden="true" className="h-0.5 bg-[#217346]" />}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-ui-border pt-2">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={pivots.defer} disabled={ro} onChange={(e) => void pivots.setDefer(e.target.checked)} />
          {t("calc.pivot.defer")}
        </label>
        <button type="button" className="h-8 rounded border border-ui-border bg-ui-bg px-3 text-sm hover:bg-ui-hover disabled:opacity-40" disabled={!pivots.defer || !pivots.draft} onClick={() => void pivots.flush()}>
          {t("calc.pivot.update")}
        </button>
      </div>
      {drag && (
        <div className="pointer-events-none fixed z-50 rounded border border-ui-border bg-ui-panel px-2 py-1 text-xs shadow" style={{ left: drag.x + 8, top: drag.y + 8 }} data-testid="pivot-drag-ghost">
          {drag.outside && drag.src.kind === "area" ? "✕ " : ""}
          {drag.label}
        </div>
      )}
      <ContextMenu at={menu?.at ?? null} label={t("calc.pivot.fields")} items={menu?.items ?? []} onClose={() => setMenu(null)} />
    </div>
  );
}
