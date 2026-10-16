// Trendlines (docs/charts.md "Trendlines"): least-squares fits of the
// series points and moving averages.

import type { TrendlineKind } from "./model";

export interface TrendFit {
  /** y at x (`NaN` outside the domain, e.g. ln of x ≤ 0). */
  at: (x: number) => number;
  /** Coefficients: linear/log `[a, b]` (y = a·x + b, y = a·ln x + b), exp/power `[a, b]` (y = a·e^(bx), y = a·x^b), polynomial `[c0, c1, …]`. */
  coef: number[];
  r2: number;
}

/** Solves `A·x = b` (Gaussian elimination with partial pivoting); `null` when singular. */
export function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

function rSquared(ys: number[], fit: number[]): number {
  const mean = ys.reduce((s, y) => s + y, 0) / (ys.length || 1);
  let tot = 0;
  let res = 0;
  ys.forEach((y, i) => {
    tot += (y - mean) ** 2;
    res += (y - fit[i]!) ** 2;
  });
  return tot === 0 ? 1 : 1 - res / tot;
}

/** Polynomial least squares of `order` (1 = linear): coefficients c0..c_order. */
export function polyFit(xs: number[], ys: number[], order: number): number[] | null {
  const k = Math.max(1, Math.min(6, Math.floor(order)));
  if (xs.length <= k) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i <= k; i++) {
    a.push([]);
    for (let j = 0; j <= k; j++) a[i]!.push(xs.reduce((s, x) => s + x ** (i + j), 0));
    b.push(xs.reduce((s, x, n) => s + ys[n]! * x ** i, 0));
  }
  return solve(a, b);
}

const polyAt = (c: number[], x: number) => c.reduce((s, ci, i) => s + ci * x ** i, 0);

/** The fitted curve of a trendline over the points (`null` when it cannot be fitted). Moving averages are not fits: see `movingAverage`. */
export function fitTrend(kind: TrendlineKind, xs: number[], ys: number[]): TrendFit | null {
  const pts = xs.map((x, i) => [x, ys[i]!] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const X = pts.map((p) => p[0]);
  const Y = pts.map((p) => p[1]);
  switch (kind.type) {
    case "linear":
    case "polynomial": {
      const c = polyFit(X, Y, kind.type === "linear" ? 1 : kind.order);
      if (!c) return null;
      const at = (x: number) => polyAt(c, x);
      return { at, coef: kind.type === "linear" ? [c[1]!, c[0]!] : c, r2: rSquared(Y, X.map(at)) };
    }
    case "logarithmic": {
      const ok = pts.filter(([x]) => x > 0);
      const c = polyFit(ok.map(([x]) => Math.log(x)), ok.map(([, y]) => y), 1);
      if (!c) return null;
      const at = (x: number) => (x > 0 ? c[1]! * Math.log(x) + c[0]! : NaN);
      return { at, coef: [c[1]!, c[0]!], r2: rSquared(ok.map(([, y]) => y), ok.map(([x]) => at(x))) };
    }
    case "exponential":
    case "power": {
      const power = kind.type === "power";
      const ok = pts.filter(([x, y]) => y > 0 && (!power || x > 0));
      const lx = ok.map(([x]) => (power ? Math.log(x) : x));
      const ly = ok.map(([, y]) => Math.log(y));
      const c = polyFit(lx, ly, 1);
      if (!c) return null;
      const a = Math.exp(c[0]!);
      const b = c[1]!;
      const at = (x: number) => (power ? (x > 0 ? a * x ** b : NaN) : a * Math.exp(b * x));
      // Excel's R² of these fits is the linear fit's on the transformed values.
      return { at, coef: [a, b], r2: rSquared(ly, lx.map((x) => c[0]! + b * x)) };
    }
    case "movingAverage":
      return null;
  }
}

/** Moving average over `period` points, starting at point `period` (1-based): `[x, y]` pairs. */
export function movingAverage(xs: number[], ys: (number | null)[], period: number): [number, number][] {
  const p = Math.max(2, Math.floor(period));
  const out: [number, number][] = [];
  for (let i = p - 1; i < ys.length; i++) {
    const win = ys.slice(i - p + 1, i + 1).filter((v): v is number => v !== null);
    if (win.length === 0) continue;
    out.push([xs[i]!, win.reduce((s, v) => s + v, 0) / win.length]);
  }
  return out;
}

const num = (v: number) => {
  const r = Number(v.toPrecision(4));
  return Math.abs(r) >= 1e6 || (r !== 0 && Math.abs(r) < 1e-4) ? r.toExponential(3) : String(r);
};
const term = (c: number, first: boolean, body: string) => {
  const s = num(Math.abs(c));
  const sign = c < 0 ? (first ? "-" : " - ") : first ? "" : " + ";
  return `${sign}${s}${body}`;
};

/** Excel's equation label: `y = 2x + 1`, `y = 3e^(0.5x)`, `y = 2ln(x) + 1`, `y = 2x^1.5`, `y = x² …`. */
export function trendEquation(kind: TrendlineKind, fit: TrendFit): string {
  const big = Math.max(...fit.coef.map(Math.abs), 1e-300);
  const c = fit.coef.map((v) => (Math.abs(v) < big * 1e-10 ? 0 : v));
  switch (kind.type) {
    case "linear":
      return `y = ${term(c[0]!, true, "x")}${c[1] ? term(c[1], false, "") : ""}`;
    case "logarithmic":
      return `y = ${term(c[0]!, true, "ln(x)")}${c[1] ? term(c[1], false, "") : ""}`;
    case "exponential":
      return `y = ${num(c[0]!)}e^(${num(c[1]!)}x)`;
    case "power":
      return `y = ${num(c[0]!)}x^${num(c[1]!)}`;
    case "polynomial": {
      const sup = ["", "", "²", "³", "⁴", "⁵", "⁶"];
      const parts: string[] = [];
      for (let i = c.length - 1; i >= 0; i--) if (c[i] || (i === 0 && parts.length === 0)) parts.push(term(c[i]!, parts.length === 0, i === 0 ? "" : i === 1 ? "x" : `x${sup[i]}`));
      return `y = ${parts.join("")}`;
    }
    default:
      return "";
  }
}

export const rSquaredLabel = (r2: number) => `R² = ${Number(r2.toFixed(4))}`;
