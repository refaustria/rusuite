// Grid, drawing guides and rulers (P8-28), pure geometry in slide px or
// EMU so it is unit-testable:
// - the grid spacing choices of the Grid and Guides dialog (fractions of a
//   centimetre or an inch, by UI language), snapping a value / a box to
//   the grid and the grid lines to draw;
// - drawing guides: the snap lines they add while shown, what a drag does
//   (move, Ctrl duplicates, dragging off the slide deletes) and the label
//   PowerPoint shows while dragging (the distance from the slide centre);
// - the ruler ticks (PowerPoint's rulers count from the slide centre).
// Snapping of a dragged box combines them in `snapMove`: smart guides
// (shapes, slide, drawing guides, equal spacing) win within the threshold,
// otherwise the box's top-left corner goes to the grid when "Snap objects
// to grid" is on.

import type { Guide } from "../generated/Guide";
import type { GuideOrient } from "../generated/GuideOrient";
import type { SlideSize } from "../generated/SlideSize";
import type { ViewProps } from "../generated/ViewProps";
import type { LayoutKind } from "../generated/LayoutKind";
import type { NodeId } from "../generated/NodeId";
import type { Presentation } from "../generated/Presentation";
import { EMU_PER_PX, type Rect } from "../geometry";
import { equalSpacing, snapBox, type Guides, type SnapTargets } from "./snap";

export type RulerUnit = "cm" | "in";
export const EMU_PER_CM = 360_000;
export const EMU_PER_IN = 914_400;
export const emuPerUnit = (u: RulerUnit): number => (u === "cm" ? EMU_PER_CM : EMU_PER_IN);

/** Rulers and grid choices in inches for English, centimetres otherwise. */
export function rulerUnit(locale: string): RulerUnit {
  return locale.startsWith("en") ? "in" : "cm";
}

/** The Grid and Guides dialog's spacing choices: fractions of the unit. */
export const GRID_FRACTIONS: readonly { n: number; d: number }[] = [
  { n: 1, d: 8 }, { n: 1, d: 6 }, { n: 1, d: 5 }, { n: 1, d: 4 }, { n: 1, d: 3 }, { n: 1, d: 2 }, { n: 1, d: 1 }, { n: 2, d: 1 },
];

/** A grid choice in EMU. */
export const gridEmu = (f: { n: number; d: number }, unit: RulerUnit): number => Math.round((emuPerUnit(unit) * f.n) / f.d);

/** "1/8 cm", "1 in", "2 cm". */
export const gridLabel = (f: { n: number; d: number }, unit: RulerUnit): string => `${f.d === 1 ? f.n : `${f.n}/${f.d}`} ${unit}`;

/** The choice nearest to `spacing` EMU (for the dialog's selection). */
export function nearestGrid(spacing: number, unit: RulerUnit): { n: number; d: number } {
  let best = GRID_FRACTIONS[0]!;
  for (const f of GRID_FRACTIONS) if (Math.abs(gridEmu(f, unit) - spacing) < Math.abs(gridEmu(best, unit) - spacing)) best = f;
  return best;
}

/** `v` (px) on the nearest grid line of spacing `step` (px). */
export const snapToGrid = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

/** Grid line positions (px) inside `length`, without the edges. */
export function gridLines(length: number, step: number, max = 400): number[] {
  if (step <= 0) return [];
  const out: number[] = [];
  for (let v = step; v < length - 1e-6 && out.length < max; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Guide positions in slide px, per axis. */
export function guideLinesPx(guides: readonly Guide[]): { xs: number[]; ys: number[] } {
  return {
    xs: guides.filter((g) => g.orient === "vertical").map((g) => g.pos / EMU_PER_PX),
    ys: guides.filter((g) => g.orient === "horizontal").map((g) => g.pos / EMU_PER_PX),
  };
}

/** The drawing guides as snap lines (none while they are hidden); `extra`: the layout's and master's guides shown with them. */
export function guideTargets(view: Pick<ViewProps, "guides" | "showGuides"> | undefined, extra: readonly Guide[] = []): SnapTargets {
  const all = [...(view?.guides ?? []), ...extra];
  if (!view?.showGuides || !all.length) return { xs: [], ys: [] };
  return guideLinesPx(all);
}

/** The colour of master and layout guides when they have none (PowerPoint's orange). */
export const DESIGN_GUIDE_COLOR = "FBAE40";

/**
 * The guides of the stage (P9-S3): `editable` – the selected master's or
 * layout's in the Slide Master view, else the slides' (view settings) –
 * and `inherited`, drawn but not draggable: on slides the layout's and
 * the master's, on a layout in the master view the master's.
 */
export function guideSets(
  pres: Pick<Presentation, "view" | "master" | "layouts" | "slides">,
  masterView: { kind: "master" } | { kind: "layout"; value: LayoutKind } | null,
  current: NodeId | null,
): { editable: Guide[]; inherited: Guide[] } {
  const master = pres.master?.guides ?? [];
  if (masterView?.kind === "master") return { editable: master, inherited: [] };
  if (masterView) return { editable: pres.layouts.find((l) => l.kind === masterView.value)?.guides ?? [], inherited: master };
  const slide = pres.slides.find((s) => s.id === current);
  const layout = slide ? (pres.layouts.find((l) => l.kind === slide.layout)?.guides ?? []) : [];
  return { editable: pres.view?.guides ?? [], inherited: [...layout, ...master] };
}

export interface SnapOptions {
  /** Smart guides: the slide, other shapes, equal spacing. */
  shapes: boolean;
  /** Grid step in slide px (0 = no grid snapping). */
  grid: number;
  /** Threshold in slide px. */
  threshold: number;
}

/**
 * Snaps a moved box (slide px): smart guides (the slide and the other
 * shapes, `shapes` lines; only when `o.shapes`) and the drawing guides
 * (`guides` lines) within the threshold, else equal spacing between three
 * objects (`others`), else the top-left corner to the grid.
 */
export function snapMove(
  box: Rect,
  lines: { shapes: SnapTargets; guides: SnapTargets },
  others: readonly Rect[],
  o: SnapOptions,
): { dx: number; dy: number; guides: Guides } {
  const targets: SnapTargets = {
    xs: [...(o.shapes ? lines.shapes.xs : []), ...lines.guides.xs],
    ys: [...(o.shapes ? lines.shapes.ys : []), ...lines.guides.ys],
  };
  const s = snapBox(box, targets, o.threshold);
  let { dx, dy } = s;
  const guides: Guides = { v: s.guides.v, h: s.guides.h };
  if (o.shapes) {
    const eq = equalSpacing({ ...box, x: box.x + dx, y: box.y + dy }, others, o.threshold);
    if (dx === 0 && eq.dx !== 0) dx = eq.dx;
    if (dy === 0 && eq.dy !== 0) dy = eq.dy;
    const marks = eq.marks.filter((m) => (m.axis === "x" ? s.dx === 0 : s.dy === 0));
    if (marks.length) guides.spacing = marks;
  }
  if (o.grid > 0) {
    if (dx === 0 && !guides.v.length && !guides.spacing?.some((m) => m.axis === "x")) dx = snapToGrid(box.x, o.grid) - box.x;
    if (dy === 0 && !guides.h.length && !guides.spacing?.some((m) => m.axis === "y")) dy = snapToGrid(box.y, o.grid) - box.y;
  }
  return { dx, dy, guides };
}

/**
 * Arrow-key nudge (slide px): Ctrl moves by 1 px; otherwise by the grid
 * step when "Snap objects to grid" is on (the box lands on the grid), else
 * 1 px; Shift multiplies by 10 (no grid).
 */
export function nudgeDelta(dir: { dx: number; dy: number }, box: Rect | null, o: { ctrl: boolean; shift: boolean; grid: number }): { dx: number; dy: number } {
  if (o.ctrl || o.grid <= 0 || !box) {
    const k = o.shift && !o.ctrl ? 10 : 1;
    return { dx: dir.dx * k, dy: dir.dy * k };
  }
  const step = (v: number, d: number) => {
    if (d === 0) return 0;
    const target = d > 0 ? Math.floor(v / o.grid + 1e-6) * o.grid + o.grid : Math.ceil(v / o.grid - 1e-6) * o.grid - o.grid;
    return target - v;
  };
  return { dx: step(box.x, dir.dx), dy: step(box.y, dir.dy) };
}

/** What dragging guide `index` to `pos` (EMU) does: moved, duplicated (Ctrl) or deleted (dragged off the slide). */
export function dragGuide(guides: readonly Guide[], index: number, pos: number, size: SlideSize, ctrl: boolean): { guides: Guide[]; result: "moved" | "copied" | "deleted" } {
  const g = guides[index];
  if (!g) return { guides: [...guides], result: "moved" };
  const length = g.orient === "vertical" ? size.width : size.height;
  if (pos < 0 || pos > length) return { guides: guides.filter((_, i) => i !== index), result: "deleted" };
  const moved = { ...g, pos: Math.round(pos) };
  if (ctrl) return { guides: [...guides, moved], result: "copied" };
  return { guides: guides.map((x, i) => (i === index ? moved : x)), result: "moved" };
}

/** A new guide through the slide centre (Add Vertical / Horizontal Guide). */
export function newGuide(orient: GuideOrient, size: SlideSize, at?: number): Guide {
  return { orient, pos: Math.round(at ?? (orient === "vertical" ? size.width / 2 : size.height / 2)) };
}

/** The label of a guide being dragged: its distance from the slide centre in the unit ("3.25", "0.00"). */
export function guideLabel(g: Pick<Guide, "orient" | "pos">, size: SlideSize, unit: RulerUnit, format: (n: number) => string = (n) => n.toFixed(2)): string {
  const centre = g.orient === "vertical" ? size.width / 2 : size.height / 2;
  return format(Math.abs(g.pos - centre) / emuPerUnit(unit));
}

export interface RulerTick {
  /** Position along the ruler (slide px). */
  at: number;
  kind: "major" | "half" | "minor";
  /** Major ticks: the distance from the centre in whole units. */
  label?: string;
}

/**
 * Ticks of a ruler `length` EMU long, counted from its centre like
 * PowerPoint: majors every unit, halves, and minor ticks (8ths of an inch,
 * millimetre-like quarters of a centimetre).
 */
export function rulerTicks(length: number, unit: RulerUnit): RulerTick[] {
  const per = emuPerUnit(unit);
  const sub = unit === "in" ? 8 : 4;
  const step = per / sub;
  const centre = length / 2;
  const out: RulerTick[] = [];
  const n = Math.floor(centre / step);
  for (let i = -n; i <= n; i++) {
    const emu = centre + i * step;
    if (emu < 0 || emu > length) continue;
    const r = ((i % sub) + sub) % sub;
    const kind: RulerTick["kind"] = r === 0 ? "major" : r === sub / 2 ? "half" : "minor";
    out.push({ at: emu / EMU_PER_PX, kind, ...(kind === "major" ? { label: String(Math.abs(i / sub)) } : {}) });
  }
  return out;
}
