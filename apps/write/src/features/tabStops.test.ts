// P8-17: tab stops in effect (styles, clear entries) and the layout of tab characters.

import { describe, expect, it } from "vitest";
import type { StyleSheet } from "../generated/StyleSheet";
import type { TabStop } from "../generated/TabStop";
import { writeSchema } from "../sync/schema";
import { DEFAULT_TAB_TWIPS, layoutTabs, leaderClass, resolveTabs, styleIdOf } from "./tabStops";

const sheet: StyleSheet = {
  defaults: { paragraph: { tabs: [{ pos: 360, kind: "left" }] } },
  styles: [
    { id: "Normal", name: "Normal", kind: "paragraph", isDefault: true, paragraph: { tabs: [{ pos: 1440, kind: "left" }] } },
    { id: "Toc", name: "toc", kind: "paragraph", basedOn: "Normal", paragraph: { tabs: [{ pos: 9000, kind: "right", leader: "dot" }, { pos: 360, kind: "clear" }] } },
  ],
};
const px = (tw: number) => tw / 15;

describe("tab stops", () => {
  it("resolveTabs: defaults, the style chain, direct stops; clear entries remove inherited stops", () => {
    expect(resolveTabs(sheet, "Normal", null).map((t) => t.pos)).toEqual([360, 1440]);
    expect(resolveTabs(sheet, "Toc", null)).toEqual([{ pos: 1440, kind: "left" }, { pos: 9000, kind: "right", leader: "dot" }]);
    expect(resolveTabs(sheet, "Toc", [{ pos: 1440, kind: "clear" }, { pos: 2000, kind: "center" }]).map((t) => t.pos)).toEqual([2000, 9000]);
    expect(resolveTabs(null, null, [{ pos: 720, kind: "left" }])).toHaveLength(1);
  });

  it("styleIdOf: headings, title, the style attribute", () => {
    const s = writeSchema();
    expect(styleIdOf(s.nodes.heading!.create({ level: 2 }))).toBe("Heading2");
    expect(styleIdOf(s.nodes.title!.create())).toBe("Title");
    expect(styleIdOf(s.nodes.paragraph!.create({ style: "Quote" }))).toBe("Quote");
    expect(styleIdOf(s.nodes.paragraph!.create())).toBe("Normal");
  });

  it("left, centre, right and decimal stops (doc 57's line)", () => {
    const stops: TabStop[] = [
      { pos: 1701, kind: "left" }, { pos: 4535, kind: "center" }, { pos: 6803, kind: "decimal" }, { pos: 9071, kind: "right", leader: "dot" },
    ];
    // "Item" 30 px, "Centered" 60, "12.5" 30 (16 before the point), "Page 1" 40.
    const boxes = layoutTabs(stops, 0, 30, [
      { width: 60, beforeDecimal: 60 },
      { width: 30, beforeDecimal: 16 },
      { width: 40, beforeDecimal: 40 },
    ]);
    expect(boxes[0]!.width).toBeCloseTo(px(1701) - 30);
    expect(boxes[0]!.stop?.kind).toBe("left");
    // Centre: the text's middle on the stop.
    expect(boxes[1]!.width).toBeCloseTo(px(4535) - (px(1701) + 60) - 15);
    // Decimal stop: no point in "Page 1" → right-aligned on the stop.
    expect(boxes[2]!.width).toBeCloseTo(px(6803) - (px(4535) + 15) - 40);
    expect(boxes[2]!.stop?.kind).toBe("decimal");
  });

  it("a decimal stop aligns the point; a right stop the end", () => {
    const [d] = layoutTabs([{ pos: 3000, kind: "decimal" }], 0, 0, [{ width: 50, beforeDecimal: 20 }]);
    expect(d!.width).toBeCloseTo(px(3000) - 20);
    const [r] = layoutTabs([{ pos: 3000, kind: "right" }], 10, 0, [{ width: 50, beforeDecimal: 50 }]);
    expect(r!.width).toBeCloseTo(px(3000) - 10 - 50);
  });

  it("past the last stop the default stops (1.27 cm) take over; bar stops are not stops", () => {
    const boxes = layoutTabs([{ pos: 600, kind: "bar" }], 0, 10, [{ width: 0, beforeDecimal: 0 }, { width: 0, beforeDecimal: 0 }]);
    expect(boxes[0]!.stop).toBeNull();
    expect(boxes[0]!.width).toBeCloseTo(px(DEFAULT_TAB_TWIPS) - 10);
    expect(boxes[1]!.width).toBeCloseTo(px(DEFAULT_TAB_TWIPS));
  });

  it("text wider than the room leaves a zero-width tab; leaders map to classes", () => {
    const [b] = layoutTabs([{ pos: 300, kind: "right" }], 0, 0, [{ width: 500, beforeDecimal: 500 }]);
    expect(b!.width).toBe(0);
    expect(leaderClass({ pos: 1, kind: "right", leader: "dot" })).toBe(" tab-leader-dot");
    expect(leaderClass({ pos: 1, kind: "right", leader: "none" })).toBe("");
    expect(leaderClass(null)).toBe("");
  });
});
