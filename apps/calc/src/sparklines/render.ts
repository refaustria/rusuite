// Sparklines (P9-C6): drawing a sparkline inside its cell (docs/charts.md
// "Sparklines"). `sparklineOps` is pure (unit-tested); the canvas and SVG
// painters only read its ops, so the grid and the printout draw alike.

import { resolveColor, type ChartTheme } from "@rusuite/ui-shared";
import type { SparklineAxis } from "../generated/SparklineAxis";
import type { SparklineColors } from "../generated/SparklineColors";
import type { SparklineData } from "../generated/SparklineData";
import type { SparklineGroup } from "../generated/SparklineGroup";
import { sparklineStyle } from "./styles";

export type SparkOp =
  | { t: "line"; points: [number, number][]; color: string; width: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { t: "dot"; x: number; y: number; r: number; color: string };

export interface CellBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PT = 4 / 3;
/** Inner padding of a sparkline in its cell, px (Excel leaves about 2 px). */
const PAD_X = 2;
const PAD_Y = 3;

/** The vertical range shared by the group (axis type `group`): over all its sparklines. */
export function groupRange(data: SparklineData[], group: SparklineGroup): { min: number; max: number } | null {
  const vals = data.flatMap((d) => d.values).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!vals.length) return null;
  const zero = group.emptyCells === "zero" && data.some((d) => d.values.some((v) => v === null));
  return { min: Math.min(...vals, ...(zero ? [0] : [])), max: Math.max(...vals, ...(zero ? [0] : [])) };
}

function bound(axis: SparklineAxis | undefined, own: number, shared: number | undefined): number {
  if (!axis || axis.type === "individual") return own;
  if (axis.type === "custom") return axis.value;
  return shared ?? own;
}

/**
 * The drawing of one sparkline in `box`: values evenly spaced (or by date), scaled between the
 * vertical bounds; empty cells per the group's setting; highlighted points in their colours.
 */
export function sparklineOps(group: SparklineGroup, data: SparklineData, box: CellBox, theme: ChartTheme = {}, shared: { min: number; max: number } | null = null): SparkOp[] {
  const colors: SparklineColors = group.colors ?? sparklineStyle(1);
  const col = (c: SparklineColors[keyof SparklineColors]) => resolveColor(c, theme);
  const kind = group.kind ?? "line";
  const empty = group.emptyCells ?? "gap";
  let values = data.values.map((v) => (v === null || !Number.isFinite(v) ? (empty === "zero" ? 0 : null) : v));
  let dates = data.dates ? [...data.dates] : null;
  if (group.rightToLeft) {
    values = values.reverse();
    dates = dates?.reverse() ?? null;
  }
  const n = values.length;
  const nums = values.filter((v): v is number => v !== null);
  if (!n || !nums.length) return [];
  const inner: CellBox = { x: box.x + PAD_X, y: box.y + PAD_Y, w: Math.max(1, box.w - 2 * PAD_X), h: Math.max(1, box.h - 2 * PAD_Y) };
  const ops: SparkOp[] = [];
  const ownMin = Math.min(...nums);
  const ownMax = Math.max(...nums);
  // Index of each highlighted point (first/last of the non-empty points).
  const idx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  const first = idx[0]!;
  const last = idx[idx.length - 1]!;
  const hi = values.indexOf(ownMax);
  const lo = values.indexOf(ownMin);
  const pointColor = (i: number, v: number): string | null => {
    if (group.high && i === hi) return col(colors.high);
    if (group.low && i === lo) return col(colors.low);
    if (group.first && i === first) return col(colors.first);
    if (group.last && i === last) return col(colors.last);
    if (group.negative && v < 0) return col(colors.negative);
    return null;
  };

  if (kind === "winLoss") {
    const slot = inner.w / n;
    const bw = Math.max(1, slot * 0.8);
    const mid = inner.y + inner.h / 2;
    values.forEach((v, i) => {
      if (v === null || v === 0) return;
      const x = inner.x + i * slot + (slot - bw) / 2;
      const color = pointColor(i, v) ?? (v < 0 && group.negative ? col(colors.negative) : col(colors.series));
      ops.push(v > 0 ? { t: "rect", x, y: inner.y, w: bw, h: inner.h / 2 - 0.5, color } : { t: "rect", x, y: mid + 0.5, w: bw, h: inner.h / 2 - 0.5, color });
    });
    if (group.showAxis) ops.push({ t: "line", points: [[inner.x, mid], [inner.x + inner.w, mid]], color: col(colors.axis), width: 1 });
    return ops;
  }

  let min = bound(group.minAxis, ownMin, shared?.min);
  let max = bound(group.maxAxis, ownMax, shared?.max);
  if (max === min) {
    max += 1;
    min -= 1;
  }
  const yOf = (v: number) => inner.y + inner.h - ((v - min) / (max - min)) * inner.h;
  const zeroY = min < 0 && max > 0 ? yOf(0) : null;

  if (kind === "column") {
    // Columns grow from zero when the data crosses it, else from the lower (all negative: the upper) bound.
    const slot = inner.w / n;
    const bw = Math.max(1, slot * 0.8);
    const base = zeroY ?? (max <= 0 ? yOf(max) : yOf(min));
    values.forEach((v, i) => {
      if (v === null) return;
      const x = inner.x + i * slot + (slot - bw) / 2;
      const y = yOf(Math.max(min, Math.min(max, v)));
      // The lowest column keeps a sliver (Excel never draws an empty column for a value).
      const h = Math.max(1, Math.abs(base - y));
      const top = y < base ? y : base;
      const color = pointColor(i, v) ?? col(colors.series);
      ops.push({ t: "rect", x, y: h === 1 && y >= base ? base - 1 : top, w: bw, h, color });
    });
    if (group.showAxis && zeroY !== null) ops.push({ t: "line", points: [[inner.x, zeroY], [inner.x + inner.w, zeroY]], color: col(colors.axis), width: 1 });
    return ops;
  }

  // Line: by date (when the dates are numbers) or evenly spaced.
  const ds = dates?.map((d) => (d === null || d === undefined ? null : d));
  const dateOk = !!ds && ds.every((d, i) => values[i] === null || d !== null);
  const dmin = dateOk ? Math.min(...(ds!.filter((d): d is number => d !== null))) : 0;
  const dmax = dateOk ? Math.max(...(ds!.filter((d): d is number => d !== null))) : 0;
  const xOf = (i: number) => {
    if (dateOk && dmax > dmin) return inner.x + ((ds![i]! - dmin) / (dmax - dmin)) * inner.w;
    return n === 1 ? inner.x + inner.w / 2 : inner.x + (i / (n - 1)) * inner.w;
  };
  const width = Math.max(0.5, (group.lineWeight ?? 0.75) * PT);
  if (group.showAxis && zeroY !== null) ops.push({ t: "line", points: [[inner.x, zeroY], [inner.x + inner.w, zeroY]], color: col(colors.axis), width: 1 });
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length > 1) ops.push({ t: "line", points: run, color: col(colors.series), width });
    run = [];
  };
  values.forEach((v, i) => {
    if (v === null) {
      if (empty !== "span") flush();
      return;
    }
    run.push([xOf(i), yOf(v)]);
  });
  flush();
  const r = Math.max(1.5, width * 1.25);
  values.forEach((v, i) => {
    if (v === null) return;
    const c = pointColor(i, v) ?? (group.markers ? col(colors.markers) : null);
    if (c) ops.push({ t: "dot", x: xOf(i), y: yOf(v), r, color: c });
  });
  return ops;
}

/** Paints sparkline ops on a canvas (clipped to the cell by the caller). */
export function paintSparkOps(ctx: CanvasRenderingContext2D, ops: SparkOp[]): void {
  for (const op of ops) {
    if (op.t === "rect") {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.t === "dot") {
      ctx.fillStyle = op.color;
      ctx.beginPath();
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      op.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The ops as a standalone SVG of the cell's size (print, PDF); ops are in cell coordinates. */
export function sparkOpsSvg(ops: SparkOp[], w: number, h: number): string {
  const body = ops
    .map((op) => {
      if (op.t === "rect") return `<rect x="${r2(op.x)}" y="${r2(op.y)}" width="${r2(op.w)}" height="${r2(op.h)}" fill="${op.color}"/>`;
      if (op.t === "dot") return `<circle cx="${r2(op.x)}" cy="${r2(op.y)}" r="${r2(op.r)}" fill="${op.color}"/>`;
      return `<polyline points="${op.points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ")}" fill="none" stroke="${op.color}" stroke-width="${r2(op.width)}" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
