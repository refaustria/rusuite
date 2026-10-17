// Slicers in the Calc UI (P9-C2): the slicers of each sheet (from the
// sheet list: `SheetInfo.slicers`, buttons included), the selected slicer
// (the Slicer tab), Multi-Select per slicer, Excel's click rules and every
// slicer command. It lives on the store (`store.slicers`).

import type { ChartAnchor } from "../generated/ChartAnchor";
import type { SlicerItem } from "../generated/SlicerItem";
import type { SlicerPatch } from "../generated/SlicerPatch";
import type { SlicerSource } from "../generated/SlicerSource";
import type { SlicerView } from "../generated/SlicerView";
import { EMU_PER_PX, anchorRect, rectToAnchor, type PxRect } from "../charts/anchor";
import type { CalcStore } from "../state/store";

/** Excel's default slicer size (1.92 × 2.65 in) and button height (0.26 in), px. */
export const SLICER_W = 192;
export const SLICER_H = 265;
export const DEFAULT_ROW_HEIGHT = 241300;
/** The caption bar's height, px. */
export const CAPTION_H = 30;
/** Padding around the buttons and the gap between them, px. */
export const PAD = 8;
export const GAP = 4;

/** The button height of a slicer, px. */
export const buttonPx = (v: SlicerView): number => Math.max(12, Math.round((v.slicer.rowHeight ?? DEFAULT_ROW_HEIGHT) / EMU_PER_PX));

/**
 * The selection after a click on `name` (Excel): a plain click selects that
 * item alone; with Multi-Select (or Ctrl) a click toggles it – with every
 * item selected (no filter) it deselects just that one – and the last
 * selected item cannot be deselected. `null` = every item (no filter).
 */
export function nextSelection(items: readonly SlicerItem[], name: string, multi: boolean): string[] | null {
  if (!multi) return items.length <= 1 ? null : [name];
  let sel = items.filter((i) => i.selected).map((i) => i.name);
  if (sel.includes(name)) {
    if (sel.length === 1) return sel;
    sel = sel.filter((n) => n !== name);
  } else sel.push(name);
  return sel.length === items.length ? null : sel;
}

/** Whether the slicer filters anything (Clear Filter is enabled). */
export const isFiltered = (v: SlicerView): boolean => v.items.some((i) => !i.selected);

/** The button grid of a slicer: rows × columns of `w × h` px buttons inside `rect`. */
export function buttonLayout(v: SlicerView, rect: PxRect): { cols: number; w: number; h: number } {
  const cols = Math.max(1, v.slicer.columns ?? 1);
  const inner = rect.w - 2 * PAD;
  return { cols, w: Math.max(10, (inner - (cols - 1) * GAP) / cols), h: buttonPx(v) };
}

/** A one-cell anchor of the default size at `(row, col)`. */
export function slicerAnchor(row: number, col: number): ChartAnchor {
  return {
    type: "oneCell",
    from: { col, row, colOffset: 0, rowOffset: 0 },
    width: SLICER_W * EMU_PER_PX,
    height: SLICER_H * EMU_PER_PX,
  };
}

export class SlicerController {
  selected: { sheet: number; id: number } | null = null;
  /** Slicers in Multi-Select mode (by id). */
  multi = new Set<number>();
  /** The rectangle of a slicer being moved / resized. */
  preview: { id: number; rect: PxRect } | null = null;
  /** Re-renders the slicer layer after the grid scrolled (set by the layer). */
  positioner: (() => void) | null = null;

  constructor(private readonly store: CalcStore) {}

  reset(): void {
    this.selected = null;
    this.multi.clear();
    this.preview = null;
  }

  /** The slicers of `sheet` with their buttons. */
  of(sheet = this.store.getState().activeSheet): SlicerView[] {
    return this.store.getState().info?.sheets.find((s) => s.id === sheet)?.slicers ?? [];
  }

  get(id: number): { sheet: number; view: SlicerView } | null {
    for (const s of this.store.getState().info?.sheets ?? []) {
      const view = (s.slicers ?? []).find((v) => v.slicer.id === id);
      if (view) return { sheet: s.id, view };
    }
    return null;
  }

  /** The selected slicer (the Slicer tab), if it still exists. */
  active(): SlicerView | null {
    const s = this.selected;
    if (!s || s.sheet !== this.store.getState().activeSheet) return null;
    return this.of(s.sheet).find((v) => v.slicer.id === s.id) ?? null;
  }

  /** The slicer's rectangle in sheet px. */
  rect(sheet: number, v: SlicerView): PxRect {
    if (this.preview && this.preview.id === v.slicer.id) return this.preview.rect;
    const geo = this.store.geometry(sheet);
    return anchorRect(v.slicer.anchor, geo.col, geo.row);
  }

  select(sheet: number, id: number): void {
    this.selected = { sheet, id };
    this.store.charts.deselect();
    this.store.pictures.deselect();
    this.store.notify();
  }

  deselect(): void {
    if (!this.selected) return;
    this.selected = null;
    this.preview = null;
    this.store.notify();
  }

  toggleMulti(id: number): void {
    if (this.multi.has(id)) this.multi.delete(id);
    else this.multi.add(id);
    this.store.notify();
  }

  private apply(cmd: Parameters<CalcStore["apply"]>[0]): Promise<void> {
    return this.store.apply(cmd);
  }

  /** A click on a button (Ctrl: like Multi-Select). */
  click(v: SlicerView, name: string, ctrl = false): Promise<void> {
    const selected = nextSelection(v.items, name, ctrl || this.multi.has(v.slicer.id));
    return this.apply({ type: "setSlicerSelection", cache: v.slicer.cache, ...(selected ? { selected } : {}) });
  }

  clear(v: SlicerView): Promise<void> {
    return this.apply({ type: "setSlicerSelection", cache: v.slicer.cache });
  }

  /** Insert Slicers: one slicer per source, next to the data. */
  async insert(sources: SlicerSource[], at: { row: number; col: number }): Promise<void> {
    if (!sources.length) return;
    const sheet = this.store.getState().activeSheet;
    const before = new Set(this.of(sheet).map((v) => v.slicer.id));
    await this.apply({ type: "insertSlicers", sheet, sources, anchor: slicerAnchor(at.row, at.col) });
    const added = this.of(sheet).filter((v) => !before.has(v.slicer.id));
    const last = added[added.length - 1];
    if (last) this.select(sheet, last.slicer.id);
  }

  update(id: number, patch: SlicerPatch): Promise<void> {
    return this.apply({ type: "updateSlicer", id, patch });
  }

  setRect(id: number, rect: PxRect): Promise<void> {
    const x = this.get(id);
    if (!x) return Promise.resolve();
    const geo = this.store.geometry(x.sheet);
    return this.update(id, { anchor: rectToAnchor(rect, x.view.slicer.anchor.type, geo.col, geo.row) });
  }

  remove(id: number): Promise<void> {
    if (this.selected?.id === id) this.selected = null;
    this.multi.delete(id);
    return this.apply({ type: "deleteSlicer", id });
  }

  connections(cache: string, pivots: number[]): Promise<void> {
    return this.apply({ type: "setSlicerConnections", cache, pivots });
  }
}
