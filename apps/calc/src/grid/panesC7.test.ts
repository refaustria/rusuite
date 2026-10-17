// P9-C7: frozen panes at a scroll position (topLeftCell) and split panes.
import { describe, expect, it } from "vitest";
import { axisScrollTo, axisSegments, axisToScreen, axisToSheet, isSplit, panes, splitPaneAt, splitterAt, toSheet, type PaneLayout } from "./panes";

const layout = (p: Partial<PaneLayout> = {}): PaneLayout => ({ frozenW: 0, frozenH: 0, scrollX: 0, scrollY: 0, width: 640, height: 400, ...p });

describe("frozen at a scroll position", () => {
  // Frozen rows 20–24 (sheet px 380..480), scrolled 100 px further.
  const x = { origin: 380 };
  it("the frozen band shows the sheet from its origin, the rest continues after it", () => {
    expect(axisSegments(100, 100, 400, x)).toEqual([{ at: 0, size: 100, scroll: 380 }, { at: 100, size: 300, scroll: 580 }]);
    expect(axisToSheet(100, 100, 50, x)).toBe(430);
    expect(axisToSheet(100, 100, 150, x)).toBe(630);
  });
  it("lines above the frozen area are unreachable; scrolled-under ones hidden", () => {
    expect(axisToScreen(100, 100, 400, x)).toBe(20);
    expect(axisToScreen(100, 100, 200, x)).toBeNull();
    expect(axisToScreen(100, 100, 500, x)).toBeNull();
    expect(axisToScreen(100, 100, 600, x)).toBe(120);
    expect(axisScrollTo(100, 100, 400, 200, 220, x)).toBeNull();
    expect(axisScrollTo(100, 100, 400, 400, 420, x)).toBeNull();
    expect(axisScrollTo(100, 100, 400, 500, 520, x)).toBe(20);
  });
  it("quadrants carry the origin", () => {
    const q = panes(layout({ frozenH: 100, originY: 380, scrollY: 0 }));
    expect(q.map((p) => [p.y, p.vp.scrollY, p.vp.height])).toEqual([[100, 480, 300], [0, 380, 100]]);
  });
});

describe("split panes (View › Split)", () => {
  const l = layout({ splitX: 200, splitY: 150, scrollX0: 64, scrollY0: 40, scrollX: 640, scrollY: 1000 });
  it("four quadrants: the first ones scroll on their own, the others with the scroll bars", () => {
    expect(isSplit(l)).toBe(true);
    expect(panes(l).map((p) => [p.x, p.y, p.vp.scrollX, p.vp.scrollY, p.vp.width, p.vp.height])).toEqual([
      [200, 150, 640, 1000, 440, 250],
      [0, 150, 64, 1000, 200, 250],
      [200, 0, 640, 40, 440, 150],
      [0, 0, 64, 40, 200, 150],
    ]);
    expect(toSheet(l, 10, 10)).toEqual({ x: 74, y: 50 });
    expect(toSheet(l, 210, 160)).toEqual({ x: 650, y: 1010 });
  });
  it("maps offsets to the screen (the scrolling pane first) and scrolls only that pane", () => {
    const y = { split: 150, scroll0: 40 };
    expect(axisToScreen(0, 1000, 1010, y)).toBe(160);
    expect(axisToScreen(0, 1000, 60, y)).toBe(20);
    expect(axisToScreen(0, 1000, 600, y)).toBeNull();
    expect(axisScrollTo(0, 1000, 400, 60, 80, y)).toBeNull();
    expect(axisScrollTo(0, 1000, 400, 600, 620, y)).toBe(600);
    expect(axisScrollTo(0, 1000, 400, 1300, 1320, y)).toBe(1070);
  });
  it("hit testing: panes and splitters; frozen panes have no splitters", () => {
    expect(splitPaneAt(l, 10, 300)).toEqual({ col: 0, row: 1 });
    expect(splitterAt(l, 201, 300)).toBe("x");
    expect(splitterAt(l, 400, 148)).toBe("y");
    expect(splitterAt(l, 199, 152)).toBe("both");
    expect(splitterAt(l, 300, 300)).toBeNull();
    expect(splitterAt({ ...l, frozenH: 20 }, 201, 300)).toBeNull();
  });
});
