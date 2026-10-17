// Shape outlines from the core (`shapePaths`, P8-14): one process-wide
// cache keyed by geometry + box size + adjust values (so a shape's entry
// is invalidated by any patch that changes its size, geometry or adjust
// values; equal shapes share one entry). Missing outlines are fetched in
// batches; renderers subscribe and draw a simple fallback meanwhile.
// The editor, thumbnails, presenter, print and the gallery icons all use
// it; the audience window gets the entries with the deck.

import { useSyncExternalStore } from "react";
import type { PathCmd } from "../generated/PathCmd";
import type { PathQuery } from "../generated/PathQuery";
import type { Shape } from "../generated/Shape";
import type { ShapePaths } from "../generated/ShapePaths";
import type { Slide } from "../generated/Slide";
import { EMU_PER_PX } from "../geometry";

export type PathFetcher = (queries: PathQuery[]) => Promise<ShapePaths[]>;

/** The cache key of a query (adjust keys sorted). */
export function pathKey(q: PathQuery): string {
  const adj = q.adjust ? Object.keys(q.adjust).sort().map((k) => `${k}=${q.adjust![k]}`).join(",") : "";
  return `${JSON.stringify(q.kind)}|${Math.round(q.w)}x${Math.round(q.h)}|${adj}`;
}

/** The outline query of a shape (auto shapes and connectors; `null` for pictures, tables, groups). */
export function pathQueryOf(shape: Shape): PathQuery | null {
  const t = shape.transform;
  const k = shape.kind;
  if (k.kind === "auto") {
    const q: PathQuery = { kind: { kind: "preset", value: k.value.geometry }, w: t.w, h: t.h };
    if (k.value.adjust && Object.keys(k.value.adjust).length) q.adjust = k.value.adjust;
    return q;
  }
  if (k.kind === "connector") {
    const c = k.value;
    const q: PathQuery = { kind: { kind: "connector", value: c.bends === undefined ? { kind: c.kind } : { kind: c.kind, bends: c.bends } }, w: t.w, h: t.h };
    if (c.adjust && Object.keys(c.adjust).length) q.adjust = c.adjust;
    return q;
  }
  if (k.kind === "picture" && k.value.props?.geometry && k.value.props.geometry !== "rect") {
    const q: PathQuery = { kind: { kind: "preset", value: k.value.props.geometry }, w: t.w, h: t.h };
    // the picture shape's adjust values (rounded corners …; P9-S5)
    const adjust = k.value.props.adjust;
    if (adjust && Object.keys(adjust).length) q.adjust = adjust;
    return q;
  }
  return null;
}

/** The query whose `sites` are the connection sites of a shape (pictures and tables: a rectangle's). */
export function siteQueryOf(shape: Shape): PathQuery | null {
  const k = shape.kind.kind;
  if (k === "picture" || k === "table") return { kind: { kind: "preset", value: "rect" }, w: shape.transform.w, h: shape.transform.h };
  return k === "auto" ? pathQueryOf(shape) : null;
}

/** Every outline query of the slides' shapes (also inside groups). */
export function slideQueries(slides: readonly Slide[]): PathQuery[] {
  const out: PathQuery[] = [];
  const walk = (shapes: Shape[]) => {
    for (const s of shapes) {
      if (s.kind.kind === "group") walk(s.kind.value.children);
      const q = pathQueryOf(s);
      if (q) out.push(q);
    }
  };
  slides.forEach((s) => walk(s.shapes));
  return out;
}

const n = (v: number, k: number) => String(Math.round((v / k) * 100) / 100);

/** SVG path data of commands in EMU, divided by `k` (default: EMU → slide px). Arcs are not expected (the core converts them). */
export function svgPath(commands: readonly PathCmd[], k = EMU_PER_PX): string {
  const out: string[] = [];
  for (const c of commands) {
    switch (c.kind) {
      case "moveTo":
        out.push(`M${n(c.x, k)} ${n(c.y, k)}`);
        break;
      case "lineTo":
        out.push(`L${n(c.x, k)} ${n(c.y, k)}`);
        break;
      case "quadTo":
        out.push(`Q${n(c.x1, k)} ${n(c.y1, k)} ${n(c.x, k)} ${n(c.y, k)}`);
        break;
      case "cubicTo":
        out.push(`C${n(c.x1, k)} ${n(c.y1, k)} ${n(c.x2, k)} ${n(c.y2, k)} ${n(c.x, k)} ${n(c.y, k)}`);
        break;
      case "close":
        out.push("Z");
        break;
      case "arcTo":
        break;
    }
  }
  return out.join("");
}

/** Points of a path in drawing order (control points included), for tangents at the ends. */
export function pathPoints(commands: readonly PathCmd[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const c of commands) {
    if (c.kind === "moveTo" || c.kind === "lineTo") out.push({ x: c.x, y: c.y });
    else if (c.kind === "quadTo") out.push({ x: c.x1, y: c.y1 }, { x: c.x, y: c.y });
    else if (c.kind === "cubicTo") out.push({ x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y });
  }
  return out;
}

export class PathCache {
  private map = new Map<string, ShapePaths | null>();
  private pending = new Map<string, PathQuery>();
  private waiting = new Map<string, Promise<void>>();
  private scheduled = false;
  private listeners = new Set<() => void>();
  private fetcher: PathFetcher | null = null;
  /** Bumped whenever outlines arrive. */
  version = 0;

  constructor(readonly limit = 5000) {}

  /** Where missing outlines come from (the store sets the core's `shapePaths`). */
  setFetcher(f: PathFetcher | null): void {
    this.fetcher = f;
    if (f && this.pending.size) this.schedule();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  /** The cached outline (`null`: the core failed for it), else `undefined` and the query is fetched. */
  get(q: PathQuery): ShapePaths | null | undefined {
    const key = pathKey(q);
    const hit = this.map.get(key);
    if (hit !== undefined) return hit;
    this.request(key, q);
    return undefined;
  }

  /** The cached outline without fetching. */
  peek(q: PathQuery): ShapePaths | null | undefined {
    return this.map.get(pathKey(q));
  }

  /** Resolves when every query is cached (or failed). */
  ensure(queries: readonly PathQuery[]): Promise<void> {
    // without a core (audience window, tests) there is nothing to wait for
    if (!this.fetcher) return Promise.resolve();
    const waits: Promise<void>[] = [];
    for (const q of queries) {
      const key = pathKey(q);
      if (this.map.has(key)) continue;
      this.request(key, q);
      const w = this.waiting.get(key);
      if (w) waits.push(w);
    }
    return Promise.all(waits).then(() => undefined);
  }

  /** The cached entries, all or of `queries` (sent to the audience window). */
  entries(queries?: readonly PathQuery[]): [string, ShapePaths][] {
    const keys = queries ? [...new Set(queries.map(pathKey))] : [...this.map.keys()];
    return keys.flatMap((k) => {
      const v = this.map.get(k);
      return v ? [[k, v] as [string, ShapePaths]] : [];
    });
  }

  /** Adds entries (the audience window, tests). */
  load(entries: readonly [string, ShapePaths][]): void {
    for (const [k, v] of entries) this.put(k, v);
    this.bump();
  }

  /** Forgets everything (tests). */
  clear(): void {
    this.map.clear();
    this.pending.clear();
    this.waiting.clear();
    this.bump();
  }

  get size(): number {
    return this.map.size;
  }

  private put(key: string, v: ShapePaths | null): void {
    this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
  }

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private request(key: string, q: PathQuery): void {
    if (this.pending.has(key) || this.waiting.has(key)) return;
    this.pending.set(key, q);
    this.waiting.set(key, new Promise<void>((resolve) => this.resolvers.set(key, resolve)));
    this.schedule();
  }

  private resolvers = new Map<string, () => void>();

  private schedule(): void {
    if (this.scheduled || !this.fetcher) return;
    this.scheduled = true;
    queueMicrotask(() => void this.flush());
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    const fetcher = this.fetcher;
    if (!fetcher || !this.pending.size) return;
    const batch = [...this.pending];
    this.pending.clear();
    let result: ShapePaths[] | null = null;
    try {
      result = await fetcher(batch.map(([, q]) => q));
    } catch {
      result = null;
    }
    batch.forEach(([key], i) => {
      this.put(key, result?.[i] ?? null);
      this.waiting.delete(key);
      this.resolvers.get(key)?.();
      this.resolvers.delete(key);
    });
    this.bump();
  }
}

/** The process-wide cache. */
export const pathCache = new PathCache();

/** Re-renders the component when outlines arrive; returns the cache version. */
export function usePathVersion(cache: PathCache = pathCache): number {
  return useSyncExternalStore(cache.subscribe, cache.getVersion);
}
