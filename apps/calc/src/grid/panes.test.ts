// P8-3: frozen-pane quadrant geometry.
import { describe, expect, it } from "vitest";
import { axisScrollTo, axisSegments, axisToScreen, axisToSheet, mainPane, panes, toSheet, type PaneLayout } from "./panes";

const layout = (p: Partial<PaneLayout> = {}): PaneLayout => ({ frozenW: 0, frozenH: 0, scrollX: 0, scrollY: 0, width: 640, height: 400, ...p });

describe("frozen panes geometry", () => {
  it("without frozen panes there is one quadrant scrolled as a whole", () => {
    expect(panes(layout({ scrollX: 30, scrollY: 50 }))).toEqual([{ x: 0, y: 0, vp: { scrollX: 30, scrollY: 50, width: 640, height: 400 } }]);
    expect(axisSegments(0, 12, 100)).toEqual([{ at: 0, size: 100, scroll: 12 }]);
  });

  it("a frozen top row splits into a fixed band and the scrolled rest", () => {
    const q = panes(layout({ frozenH: 20, scrollY: 100 }));
    expect(q).toEqual([
      { x: 0, y: 20, vp: { scrollX: 0, scrollY: 120, width: 640, height: 380 } },
      { x: 0, y: 0, vp: { scrollX: 0, scrollY: 0, width: 640, height: 20 } },
    ]);
  });

  it("rows and columns frozen: four quadrants, the scrolling one first", () => {
    const q = panes(layout({ frozenW: 64, frozenH: 40, scrollX: 128, scrollY: 200 }));
    expect(q.map((p) => [p.x, p.y, p.vp.scrollX, p.vp.scrollY, p.vp.width, p.vp.height])).toEqual([
      [64, 40, 192, 240, 576, 360],
      [0, 40, 0, 240, 64, 360],
      [64, 0, 192, 0, 576, 40],
      [0, 0, 0, 0, 64, 40],
    ]);
    expect(mainPane(layout({ frozenW: 64, frozenH: 40 })).vp).toEqual({ scrollX: 64, scrollY: 40, width: 576, height: 360 });
  });

  it("a frozen part wider than the window takes all of it", () => {
    expect(axisSegments(900, 50, 640)).toEqual([{ at: 0, size: 640, scroll: 0 }]);
    expect(panes(layout({ frozenW: 900 }))).toHaveLength(1);
  });

  it("maps screen positions to the sheet per quadrant", () => {
    const l = layout({ frozenW: 64, frozenH: 40, scrollX: 100, scrollY: 300 });
    expect(toSheet(l, 10, 10)).toEqual({ x: 10, y: 10 });
    expect(toSheet(l, 70, 10)).toEqual({ x: 170, y: 10 });
    expect(toSheet(l, 10, 50)).toEqual({ x: 10, y: 350 });
    expect(axisToSheet(0, 25, 10)).toBe(35);
  });

  it("maps sheet offsets back to the screen; scrolled-under ones are hidden", () => {
    expect(axisToScreen(64, 100, 30)).toBe(30);
    expect(axisToScreen(64, 100, 64)).toBe(64);
    expect(axisToScreen(64, 100, 200)).toBe(100);
    expect(axisToScreen(64, 100, 128)).toBeNull();
    expect(axisToScreen(0, 100, 50)).toBeNull();
    expect(axisToScreen(0, 100, 150)).toBe(50);
  });

  it("scrolls a cell into the scrolling part, never for frozen cells", () => {
    // Frozen 40 px, 400 px tall, not scrolled: offsets 40..400 visible.
    expect(axisScrollTo(40, 0, 400, 0, 20)).toBeNull();
    expect(axisScrollTo(40, 0, 400, 100, 120)).toBeNull();
    expect(axisScrollTo(40, 0, 400, 400, 420)).toBe(20);
    // Scrolled by 200 (first scrolling offset shown: 240): going up to 60 scrolls back to 20.
    expect(axisScrollTo(40, 200, 400, 60, 80)).toBe(20);
    expect(axisScrollTo(0, 0, 400, 500, 520)).toBe(120);
    // Taller than the scrolling part: its top edge is shown.
    expect(axisScrollTo(40, 0, 400, 500, 1500)).toBe(460);
  });
});
