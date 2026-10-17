// P8-28 store behaviour: views, guides and grid, Set Up Slide Show and
// rehearsed timings, the sorter's multi-selection, the Selection pane,
// text options with the shrink scale, outline edits, grid nudging.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShowApi } from "../api";
import { FakeBackend } from "../test/fakeBackend";
import { fixture, rect, textShape } from "../test/fixture";
import { approxMeasure, setMeasure } from "../text/layout";
import { ShowStore } from "./store";

async function ready(backend = new FakeBackend()) {
  const store = new ShowStore(new ShowApi(backend));
  await store.init();
  return { store, backend };
}

beforeEach(() => setMeasure(approxMeasure));
afterEach(() => setMeasure(null));

describe("views and guides", () => {
  it("switches views; a file opens in its last view", async () => {
    const { store } = await ready();
    store.setView("sorter");
    expect(store.getState().view).toBe("sorter");
    const p = fixture();
    p.view = { guides: [], gridSpacing: 76200, snapToGrid: false, snapToShapes: true, showGrid: false, showGuides: false, showRuler: false, lastView: "outline", sorterZoom: 90, restoredLeft: 15620, restoredTop: 100000 };
    const other = await ready(new FakeBackend(p));
    expect(other.store.getState().view).toBe("outline");
  });

  it("Guides on: the two centre guides; drag, Ctrl+drag, off the slide; colour", async () => {
    const { store, backend } = await ready();
    await store.toggleGuides();
    const v = store.viewProps();
    expect(v.showGuides).toBe(true);
    expect(v.guides).toEqual([{ orient: "vertical", pos: 6096000 }, { orient: "horizontal", pos: 3429000 }]);
    await store.dropGuide(0, 1000000, true);
    expect(store.viewProps().guides).toHaveLength(3);
    await store.dropGuide(2, -10, false);
    expect(store.viewProps().guides).toHaveLength(2);
    await store.setGuideColor(1, "#e3242b");
    expect(store.viewProps().guides[1]!.color).toBe("E3242B");
    expect(backend.commands.every((c) => c.type === "setViewProps")).toBe(true);
    await store.toggleGrid();
    await store.toggleRuler();
    expect(store.viewProps()).toMatchObject({ showGrid: true, showRuler: true });
  });

  it("arrow keys move onto the grid when snapping is on; Ctrl+arrows by 1 px", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    store.select([8]); // at x = 96 px
    await store.updateView({ snapToGrid: true, gridSpacing: 9525 * 10 });
    await store.nudge(1, 0);
    const c = backend.commands.at(-1)!;
    expect(c.type === "setTransform" && c.shapes[0]![1].x).toBe(9525 * 100); // 96 → 100
    await store.nudge(1, 0, { fine: true });
    const d = backend.commands.at(-1)!;
    expect(d.type === "setTransform" && d.shapes[0]![1].x).toBe(9525 * 101);
  });
});

describe("Set Up Slide Show and Rehearse Timings", () => {
  it("stores the settings and the rehearsed times as After timings", async () => {
    const { store, backend } = await ready();
    await store.setShowSettings({ loop: true, withoutNarration: false, withoutAnimation: false, useTimings: false, showScrollbar: true, showMediaControls: true, range: { start: 1, end: 2 } });
    expect(store.getState().pres?.showSettings?.loop).toBe(true);
    await store.applyTimings(new Map([[1, 4400], [4, 12600]]));
    const c = backend.commands.at(-1)!;
    expect(c.type).toBe("compound");
    if (c.type !== "compound") return;
    expect(c.commands.map((x) => (x.type === "setTransition" ? [x.slides[0], x.transition?.advanceAfterMs] : x.type))).toEqual([[1, 4000], [4, 13000], "setShowSettings"]);
  });
});

describe("slide sorter", () => {
  it("multi-selection moves as one command", async () => {
    const { store, backend } = await ready();
    store.clickSlide(1, "replace");
    store.clickSlide(4, "toggle");
    expect(store.selectedSlides()).toEqual([1, 4]);
    await store.moveSlidesTo({ before: null });
    expect(store.getState().pres?.slides.map((s) => s.id)).toEqual([7, 1, 4]);
    expect(backend.commands).toHaveLength(1);
    store.clickSlide(7, "replace");
    store.clickSlide(4, "range");
    expect(store.getState().slideSel).toEqual([7, 1, 4]);
  });
});

describe("Selection pane and arrange", () => {
  it("hiding drops the shape from the selection; rename; reorder", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    store.select([8, 9]);
    await store.setShapesHidden([8], true);
    expect(store.getState().selection).toEqual([9]);
    expect(store.currentSlide()?.shapes[0]?.hidden).toBe(true);
    await store.setAllHidden(false);
    expect(store.currentSlide()?.shapes[0]?.hidden).toBeUndefined();
    await store.renameShape(9, "Sun");
    await store.moveShapeToZ(8, 1);
    expect(backend.commands.slice(-2).map((c) => c.type)).toEqual(["setName", "zOrder"]);
  });

  it("Align to slide vs selected objects; Regroup after Ungroup", async () => {
    const { store, backend } = await ready();
    store.selectSlide(7);
    store.select([8, 9]);
    await store.align("left");
    expect(backend.commands.at(-1)).toMatchObject({ type: "align", to: "selection" });
    store.setAlignTo("slide");
    await store.align("left");
    expect(backend.commands.at(-1)).toMatchObject({ type: "align", to: "slide" });
    expect(store.canRegroup()).toBe(false);
  });
});

describe("text options", () => {
  it("Shrink text on overflow stores the computed fontScale; other choices drop it", async () => {
    const p = fixture();
    const big = textShape(10, Array.from({ length: 14 }, (_, i) => `Line ${i}`));
    big.transform = { x: 0, y: 0, w: 3000000, h: 700000 };
    p.slides[2]!.shapes.push(big);
    const { store, backend } = await ready(new FakeBackend(p));
    store.selectSlide(7);
    store.select([10]);
    await store.setBodyProps({ autofit: "shrink" });
    const c = backend.commands.at(-1)!;
    expect(c.type).toBe("setBodyProps");
    if (c.type !== "setBodyProps") return;
    expect(c.props.autofit).toBe("shrink");
    expect(c.props.fontScale).toBeLessThan(100000);
    expect(c.props.lineReduction).toBe(20000);
    await store.setBodyProps({ autofit: "none" });
    const d = backend.commands.at(-1)!;
    expect(d.type === "setBodyProps" && d.props.fontScale).toBeUndefined();
    await store.setBodyProps({ vert: "rotate270", columns: 2 });
    expect(backend.commands.at(-1)).toMatchObject({ type: "setBodyProps", props: { vert: "rotate270", columns: 2 } });
    // a shape without text gets a body
    store.select([8]);
    await store.setBodyProps({ anchor: "bottom" });
    expect(backend.commands.at(-1)).toMatchObject({ type: "setBodyProps", shapes: [8], props: { anchor: "bottom" } });
  });

  it("resizing a shrinking shape sends the new scale with the transform", async () => {
    const p = fixture();
    const big = textShape(10, Array.from({ length: 14 }, (_, i) => `Line ${i}`));
    big.transform = { x: 0, y: 0, w: 3000000, h: 4000000 };
    if (big.kind.kind === "auto") big.kind.value.text!.props.autofit = "shrink";
    p.slides[2]!.shapes.push(big, rect(11, 0, 0));
    const { store } = await ready(new FakeBackend(p));
    store.selectSlide(7);
    const cmd = store.withAutofit({ type: "setTransform", shapes: [[10, { ...big.transform, h: 600000 }]] });
    expect(cmd?.type).toBe("compound");
    if (cmd?.type !== "compound") return;
    expect(cmd.commands[1]).toMatchObject({ type: "setBodyProps", shapes: [10] });
    // a move alone changes nothing
    expect(store.withAutofit({ type: "setTransform", shapes: [[10, { ...big.transform, x: 5 }]] })?.type).toBe("setTransform");
  });
});

describe("outline view", () => {
  it("edits the placeholders and promotes a line to a new slide", async () => {
    const { store, backend } = await ready();
    await store.commitOutline(4, "Slide two\n\tFirst point\nNew slide");
    const types = backend.commands.map((c) => c.type);
    expect(types[0]).toBe("setTextBody");
    expect(types).toContain("addSlide");
    expect(store.getState().pres?.slides).toHaveLength(4);
  });
});
