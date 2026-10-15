import { describe, expect, it, vi } from "vitest";
import type { PathQuery } from "../generated/PathQuery";
import type { Shape } from "../generated/Shape";
import { fakePaths } from "../test/fakeBackend";
import { rect } from "../test/fixture";
import { PathCache, pathKey, pathPoints, pathQueryOf, siteQueryOf, slideQueries, svgPath } from "./paths";

const q = (value: string, w = 100, h = 50, adjust?: Record<string, number>): PathQuery =>
  ({ kind: { kind: "preset", value }, w, h, ...(adjust ? { adjust } : {}) }) as PathQuery;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("path cache keys and queries", () => {
  it("keys by geometry, size and adjust values (order-independent)", () => {
    expect(pathKey(q("star5", 10, 20, { b: 2, a: 1 }))).toBe(pathKey(q("star5", 10, 20, { a: 1, b: 2 })));
    expect(pathKey(q("star5", 10, 20))).not.toBe(pathKey(q("star5", 10, 21)));
    expect(pathKey(q("star5", 10, 20))).not.toBe(pathKey(q("star6", 10, 20)));
    expect(pathKey(q("star5", 10, 20, { adj: 1 }))).not.toBe(pathKey(q("star5", 10, 20)));
  });

  it("queries auto shapes and connectors, not pictures; sites of pictures are a rectangle's", () => {
    const s = rect(1, 0, 0, "ellipse");
    expect(pathQueryOf(s)).toEqual({ kind: { kind: "preset", value: "ellipse" }, w: 1828800, h: 1371600 });
    const c: Shape = { ...s, kind: { kind: "connector", value: { kind: "elbow", bends: 2, adjust: { adj1: 30000 } } } };
    expect(pathQueryOf(c)).toEqual({ kind: { kind: "connector", value: { kind: "elbow", bends: 2 } }, w: 1828800, h: 1371600, adjust: { adj1: 30000 } });
    const p: Shape = { ...s, kind: { kind: "picture", value: { media: 1 } } };
    expect(pathQueryOf(p)).toBeNull();
    expect(siteQueryOf(p)).toEqual({ kind: { kind: "preset", value: "rect" }, w: 1828800, h: 1371600 });
  });

  it("collects the queries of every slide shape, also inside groups", () => {
    const g: Shape = { ...rect(9, 0, 0), kind: { kind: "group", value: { children: [rect(10, 0, 0, "ellipse")] } } };
    const qs = slideQueries([{ id: 1, layout: "blank", shapes: [rect(2, 0, 0), g] }]);
    expect(qs.map((x) => (x.kind.kind === "preset" ? x.kind.value : "?"))).toEqual(["rect", "ellipse"]);
  });

  it("writes SVG path data in slide px and lists the points with control points", () => {
    const cmds = [
      { kind: "moveTo" as const, x: 0, y: 0 },
      { kind: "lineTo" as const, x: 9525, y: 19050 },
      { kind: "cubicTo" as const, x1: 9525, y1: 0, x2: 19050, y2: 0, x: 28575, y: 9525 },
      { kind: "quadTo" as const, x1: 0, y1: 9525, x: 0, y: 0 },
      { kind: "close" as const },
    ];
    expect(svgPath(cmds)).toBe("M0 0L1 2C1 0 2 0 3 1Q0 1 0 0Z");
    expect(svgPath(cmds, 1905)).toBe("M0 0L5 10C5 0 10 0 15 5Q0 5 0 0Z");
    expect(pathPoints(cmds)).toHaveLength(7);
  });
});

describe("PathCache", () => {
  it("fetches missing outlines in one batch and notifies", async () => {
    const cache = new PathCache();
    const fetcher = vi.fn(async (qs: PathQuery[]) => qs.map(fakePaths));
    cache.setFetcher(fetcher);
    const seen = vi.fn();
    cache.subscribe(seen);
    expect(cache.get(q("rect"))).toBeUndefined();
    expect(cache.get(q("ellipse"))).toBeUndefined();
    expect(cache.get(q("rect"))).toBeUndefined();
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toHaveLength(2);
    expect(seen).toHaveBeenCalled();
    expect(cache.get(q("rect"))?.paths[0]?.fill).toBe(true);
  });

  it("ensure resolves once everything is cached; failures are cached as null", async () => {
    const cache = new PathCache();
    cache.setFetcher(async () => {
      throw new Error("core down");
    });
    await cache.ensure([q("rect"), q("star5")]);
    expect(cache.peek(q("rect"))).toBeNull();
    expect(cache.get(q("star5"))).toBeNull();
  });

  it("does not wait without a core; requests made before the core is there are fetched later", async () => {
    const cache = new PathCache();
    await cache.ensure([q("rect")]);
    expect(cache.get(q("rect"))).toBeUndefined();
    cache.setFetcher(async (qs) => qs.map(fakePaths));
    await tick();
    expect(cache.peek(q("rect"))).toBeTruthy();
  });

  it("keeps at most `limit` entries (oldest dropped)", async () => {
    const cache = new PathCache(2);
    cache.setFetcher(async (qs) => qs.map(fakePaths));
    await cache.ensure([q("rect", 1), q("rect", 2), q("rect", 3)]);
    expect(cache.size).toBe(2);
    expect(cache.peek(q("rect", 1))).toBeUndefined();
    expect(cache.peek(q("rect", 3))).toBeTruthy();
  });

  it("exports entries of given queries and loads them elsewhere (audience window)", async () => {
    const a = new PathCache();
    a.setFetcher(async (qs) => qs.map(fakePaths));
    await a.ensure([q("rect"), q("ellipse")]);
    const b = new PathCache();
    b.load(a.entries([q("ellipse")]));
    expect(b.size).toBe(1);
    expect(b.peek(q("ellipse"))).toEqual(fakePaths(q("ellipse")));
  });
});
