// Shape outlines from the core (`shapePaths`, the preset geometry Show
// uses): one cache keyed by preset, box size (px) and adjust values.
// Missing outlines are fetched in batches; drawing views subscribe and
// draw a rectangle meanwhile (or for unknown presets).

import type { ShapeOutline } from "../../generated/ShapeOutline";
import type { ShapePathQuery } from "../../generated/ShapePathQuery";

export type PathFetcher = (queries: ShapePathQuery[]) => Promise<ShapeOutline[]>;

/** EMU per CSS pixel (96 dpi). */
const EMU_PER_PX = 9525;

/** The query of a preset in a `w` × `h` EMU box, sizes rounded to whole pixels (the cache granularity). */
export function pathQuery(preset: string, w: number, h: number, adjust?: Record<string, number> | null): ShapePathQuery {
  const q: ShapePathQuery = {
    preset,
    w: Math.max(1, Math.round(w / EMU_PER_PX)) * EMU_PER_PX,
    h: Math.max(1, Math.round(h / EMU_PER_PX)) * EMU_PER_PX,
  };
  if (adjust && Object.keys(adjust).length) q.adjust = adjust;
  return q;
}

/** The cache key of a query (adjust keys sorted). */
export function pathKey(q: ShapePathQuery): string {
  const adj = q.adjust ? Object.keys(q.adjust).sort().map((k) => `${k}=${q.adjust![k]}`).join(",") : "";
  return `${q.preset}|${Math.round(q.w)}x${Math.round(q.h)}|${adj}`;
}

/** A rectangle outline of the query's box (fallback while loading). */
export function rectOutline(q: ShapePathQuery): ShapeOutline {
  return { paths: [{ d: `M0 0 L${q.w} 0 L${q.w} ${q.h} L0 ${q.h} Z`, fill: true, stroke: true }], defaults: {} };
}

class PathCache {
  private entries = new Map<string, ShapeOutline>();
  private pending = new Map<string, ShapePathQuery>();
  private inflight = new Set<string>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  fetcher: PathFetcher | null = null;

  /** The outline of `q`, or null (then fetched; subscribers hear when it arrives). */
  get(q: ShapePathQuery): ShapeOutline | null {
    const key = pathKey(q);
    const hit = this.entries.get(key);
    if (hit) return hit;
    if (this.fetcher && !this.inflight.has(key)) {
      this.pending.set(key, q);
      this.timer ??= setTimeout(() => void this.flush(), 0);
    }
    return null;
  }

  /** The outline of `q`, fetched if needed. */
  async load(q: ShapePathQuery): Promise<ShapeOutline> {
    const hit = this.get(q);
    if (hit) return hit;
    await this.flush();
    return this.entries.get(pathKey(q)) ?? rectOutline(q);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const batch = [...this.pending.entries()];
    this.pending.clear();
    if (!batch.length || !this.fetcher) return;
    for (const [k] of batch) this.inflight.add(k);
    try {
      const out = await this.fetcher(batch.map(([, q]) => q));
      batch.forEach(([k], i) => {
        const o = out[i];
        if (o) this.entries.set(k, o);
      });
    } catch {
      // keep the fallback; a later request may retry
    } finally {
      for (const [k] of batch) this.inflight.delete(k);
    }
    for (const fn of this.listeners) fn();
  }

  /** Forgets everything (tests). */
  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.inflight.clear();
  }
}

/** The process-wide outline cache. */
export const shapePaths = new PathCache();
