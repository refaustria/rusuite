// Axis scaling (docs/charts.md "Axes and scaling"): Rusuite's
// approximation of Excel's automatic value axis, logarithmic axes and the
// category bands.

export interface ValueScale {
  min: number;
  max: number;
  major: number;
  minor: number;
  /** Major tick values from `min` to `max`. */
  ticks: number[];
  /** Logarithm base (absent: linear). */
  log?: number;
}

export interface ScaleOptions {
  min?: number;
  max?: number;
  majorUnit?: number;
  minorUnit?: number;
  logBase?: number;
  /** Bar, column, line and area charts: one more unit when the maximum lies on a bound. */
  headroom?: boolean;
  /**
   * Excel's automatic bounds (P9-C6, docs/charts.md): the major unit from the data range, the bounds
   * 5 % of the range beyond the data, rounded out to the unit. Replaces `headroom`.
   */
  excel?: boolean;
}

/** Rounds away binary noise (`0.30000000000000004` → `0.3`). */
export const clean = (v: number) => (v === 0 ? 0 : Number(v.toPrecision(12)));

/** The smallest 1, 2 or 5 × 10ⁿ that is ≥ `x` (> 0). */
export function niceUnit(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const e = Math.floor(Math.log10(x));
  for (let k = e - 1; k <= e + 1; k++) {
    for (const m of [1, 2, 5]) {
      const u = clean(m * 10 ** k);
      if (u >= x * (1 - 1e-9)) return u;
    }
  }
  return clean(10 ** (e + 1));
}

/** The number of major intervals an axis of `lengthPx` may show (vertical: 40 px, horizontal: 70 px per interval). */
export function maxIntervals(lengthPx: number, vertical: boolean): number {
  return Math.max(2, Math.floor(lengthPx / (vertical ? 40 : 70)));
}

function ticksOf(min: number, max: number, unit: number): number[] {
  const out: number[] = [];
  const n = Math.round((max - min) / unit);
  if (!Number.isFinite(n) || n > 1000 || n < 0) return [min, max];
  for (let k = 0; k <= n; k++) out.push(clean(min + k * unit));
  return out;
}

/** The automatic (or fixed) scale of a value axis over data in `dataMin..dataMax` (`null`: no data). */
export function valueScale(dataMin: number | null, dataMax: number | null, lengthPx: number, vertical: boolean, o: ScaleOptions = {}): ValueScale {
  if (o.logBase && o.logBase > 1) return logScale(dataMin, dataMax, o);
  let dmin = dataMin ?? 0;
  let dmax = dataMax ?? (dataMin === null ? 1 : dataMin);
  if (dmin > dmax) [dmin, dmax] = [dmax, dmin];
  let lo = dmin >= 0 && dmin < (5 / 6) * dmax ? 0 : dmin;
  let hi = dmax <= 0 && dmax > (5 / 6) * dmin ? 0 : dmax;
  if (o.min !== undefined) lo = o.min;
  if (o.max !== undefined) hi = o.max;
  if (hi <= lo) {
    if (o.max === undefined) hi = lo === 0 ? 1 : lo > 0 ? lo * 2 : 0;
    else if (o.min === undefined) lo = hi === 0 ? -1 : hi > 0 ? 0 : hi * 2;
    if (hi <= lo) hi = lo + 1;
  }
  const n = maxIntervals(lengthPx, vertical);
  let unit = o.majorUnit && o.majorUnit > 0 ? o.majorUnit : niceUnit((hi - lo) / n);
  if (o.excel) return excelBounds(dataMin, dataMax, lo, hi, unit, n, o);
  let min = 0;
  let max = 0;
  for (let guard = 0; guard < 8; guard++) {
    min = o.min ?? clean(Math.floor(lo / unit + 1e-9) * unit);
    max = o.max ?? clean(Math.ceil(hi / unit - 1e-9) * unit);
    if (o.headroom && o.max === undefined && dmax !== 0 && Math.abs(dmax - max) < Math.abs(unit) * 1e-9 && dataMax !== null) max = clean(max + unit);
    if (o.majorUnit || Math.round((max - min) / unit) <= n) break;
    unit = niceUnit(unit * 1.0001);
  }
  const minor = o.minorUnit && o.minorUnit > 0 ? o.minorUnit : clean(unit / 5);
  return { min, max, major: unit, minor, ticks: ticksOf(min, max, unit) };
}

/**
 * Excel's automatic bounds: with `pad = 0.05 · (dataMax − dataMin)`, max = ⌈(dataMax + pad) / unit⌉ · unit unless the
 * zero rule set it to 0; min = 0 by the zero rule, else ⌊(dataMin − pad) / unit⌋ · unit. The unit comes from the
 * unpadded range (`niceUnit(range / intervals)`) and grows while the bounds need more intervals than fit.
 */
function excelBounds(dataMin: number | null, dataMax: number | null, lo: number, hi: number, unit0: number, n: number, o: ScaleOptions): ValueScale {
  let unit = unit0;
  const dmin = dataMin ?? 0;
  const dmax = dataMax ?? (dataMin === null ? 1 : dataMin);
  const span = Math.abs(dmax - dmin) || Math.abs(dmax) || 1;
  const pad = dataMax === null ? 0 : 0.05 * span;
  const top = o.max ?? (hi === 0 && dmax <= 0 ? 0 : Math.max(hi, dmax + pad));
  const bottom = o.min ?? (lo === 0 ? 0 : Math.min(lo, dmin - pad));
  let min = 0;
  let max = 0;
  for (let guard = 0; guard < 8; guard++) {
    min = o.min ?? clean(Math.floor(bottom / unit + 1e-9) * unit);
    max = o.max ?? clean(Math.ceil(top / unit - 1e-9) * unit);
    // Positive data never gets a negative bound from the padding (and vice versa).
    if (o.min === undefined && dmin >= 0 && min < 0) min = 0;
    if (o.max === undefined && dmax <= 0 && max > 0) max = 0;
    if (max <= min) max = clean(min + unit);
    // The 5 % padding may add one interval beyond what fits.
    if (o.majorUnit || Math.round((max - min) / unit) <= n + 1) break;
    unit = niceUnit(unit * 1.0001);
  }
  const minor = o.minorUnit && o.minorUnit > 0 ? o.minorUnit : clean(unit / 5);
  return { min, max, major: unit, minor, ticks: ticksOf(min, max, unit) };
}

/** Logarithmic scale: powers of the base around the positive data; one power per major unit. */
export function logScale(dataMin: number | null, dataMax: number | null, o: ScaleOptions): ValueScale {
  const b = o.logBase!;
  const lg = (v: number) => Math.log(v) / Math.log(b);
  const pos = (v: number | null, d: number) => (v !== null && v > 0 ? v : d);
  const dmax = pos(dataMax, 1);
  const dmin = Math.min(pos(dataMin, 1), dmax);
  let min = o.min && o.min > 0 ? o.min : b ** Math.floor(lg(dmin) + 1e-9);
  let max = o.max && o.max > 0 ? o.max : b ** Math.ceil(lg(dmax) - 1e-9);
  if (max <= min) max = min * b;
  min = clean(min);
  max = clean(max);
  const ticks: number[] = [];
  for (let k = Math.round(lg(min)); b ** k <= max * (1 + 1e-9) && ticks.length < 100; k++) ticks.push(clean(b ** k));
  return { min, max, major: b, minor: b, ticks, log: b };
}

/** Fraction 0..1 of `v` along a scale (may lie outside for out-of-range values). */
export function scaleFraction(s: ValueScale, v: number): number {
  if (s.log) {
    if (v <= 0) return -1;
    const lg = (x: number) => Math.log(x) / Math.log(s.log!);
    return (lg(v) - lg(s.min)) / (lg(s.max) - lg(s.min));
  }
  return (v - s.min) / (s.max - s.min || 1);
}

/** Minor tick values strictly between the major ticks. */
export function minorTicks(s: ValueScale): number[] {
  if (s.log || !(s.minor > 0)) return [];
  const out: number[] = [];
  const n = Math.round((s.max - s.min) / s.minor);
  if (n > 2000) return out;
  for (let k = 1; k < n; k++) {
    const v = clean(s.min + k * s.minor);
    if (!s.ticks.some((t) => Math.abs(t - v) < s.minor * 1e-6)) out.push(v);
  }
  return out;
}

/** Every `k`-th category label so that `count` labels of `labelPx` (plus a gap) fit `lengthPx`. */
export function labelStep(count: number, labelPx: number, lengthPx: number, gap = 4): number {
  if (count <= 1 || lengthPx <= 0) return 1;
  const per = lengthPx / count;
  return Math.max(1, Math.ceil((labelPx + gap) / per));
}
