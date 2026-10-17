// P9-S2: the store's freeform insertion and Edit Points commands.
import { describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { ShowStore } from "./store";
import type { PathCmd } from "../generated/PathCmd";
import { fakePaths } from "../test/fakeBackend";
import { pathCache, pathKey, pathQueryOf } from "../shapes/paths";

async function ready(backend = new FakeBackend()) {
  const store = new ShowStore(new ShowApi(backend));
  await store.init();
  return { store, backend };
}

const last = (b: FakeBackend) => b.commands[b.commands.length - 1];

describe("freeform and Edit Points (store)", () => {
  it("a finished freeform is added as a custom geometry, selected, the tool used", async () => {
    const { store, backend } = await ready();
    store.setDrawMode("freeform");
    const path = { w: 1000, h: 800, fill: true, stroke: true, commands: [{ kind: "moveTo", x: 0, y: 0 }, { kind: "lineTo", x: 1000, y: 800 }, { kind: "close" }] as PathCmd[] };
    await store.insertFreeform("freeform", { x: 10, y: 20, w: 1000, h: 800, rotationDeg: 0 }, path);
    const cmd = last(backend) as { type: string; shape: { kind: unknown; fill: unknown } };
    expect(cmd.type).toBe("addShape");
    expect(cmd.shape.kind).toEqual({ kind: "auto", value: { geometry: { custom: { paths: [path] } } } });
    expect(cmd.shape.fill).toMatchObject({ kind: "solid" });
    expect(store.getState().drawMode).toBeNull();
    expect(store.getState().recentShapes[0]).toBe("freeform");
    expect(store.getState().selection).toHaveLength(1);
  });

  it("Edit Points: on for one auto shape; an edit sets the geometry and the refitted box; selecting another ends it", async () => {
    const { store, backend } = await ready();
    const slide = store.currentSlide()!;
    const shape = slide.shapes.find((s) => s.kind.kind === "auto")!;
    store.select([shape.id]);
    // without its outline (not yet from the core) a shape cannot be edited point by point
    pathCache.clear();
    store.setEditPoints(true);
    expect(store.getState().editPoints).toBeNull();
    const q = pathQueryOf(shape)!;
    pathCache.load([[pathKey(q), fakePaths(q)]]);
    store.setEditPoints(true);
    expect(store.getState().editPoints).toBe(shape.id);
    const cmds: PathCmd[] = [{ kind: "moveTo", x: 0, y: 0 }, { kind: "lineTo", x: 2 * shape.transform.w, y: 0 }, { kind: "lineTo", x: 0, y: shape.transform.h }, { kind: "close" }];
    await store.applyEditPoints(shape.id, cmds, true);
    const c = last(backend) as unknown as { type: string; commands: { type: string; geometry?: unknown; shapes: unknown }[] };
    expect(c.type).toBe("compound");
    expect(c.commands.map((x) => x.type)).toEqual(["setGeometry", "setTransform"]);
    expect(c.commands[0]!.geometry).toMatchObject({ custom: { paths: [{ w: 2 * shape.transform.w, h: shape.transform.h, fill: true }] } });
    store.select([]);
    expect(store.getState().editPoints).toBeNull();
  });
});
