import { describe, expect, it } from "vitest";
import type { Presentation } from "../generated/Presentation";
import { moveCommands, moveSlidesCommand, nudgeDrop, orderAfterDrop, sorterSelect, sorterThumbWidth } from "./sorter";

const deck = (ids: number[], sections?: { name: string; slideIds: number[] }[]): Pick<Presentation, "slides" | "sections"> => ({
  slides: ids.map((id) => ({ id, layout: "blank", shapes: [] })),
  ...(sections ? { sections } : {}),
});

describe("slide sorter", () => {
  it("click, Ctrl+click and Shift+click selection", () => {
    const order = [1, 2, 3, 4];
    expect(sorterSelect(order, [1], 3, "replace", 1)).toEqual([3]);
    expect(sorterSelect(order, [1], 3, "toggle", 1)).toEqual([1, 3]);
    expect(sorterSelect(order, [1, 3], 3, "toggle", 1)).toEqual([1]);
    expect(sorterSelect(order, [3], 3, "toggle", 3)).toEqual([3]); // never empty
    expect(sorterSelect(order, [2], 4, "range", 2)).toEqual([2, 3, 4]);
    expect(sorterSelect(order, [3], 1, "range", 3)).toEqual([1, 2, 3]);
  });

  it("MoveSlide steps from one order to another", () => {
    expect(moveCommands([1, 2, 3, 4], [3, 1, 2, 4])).toEqual([{ type: "moveSlide", id: 3, toIndex: 0 }]);
    expect(moveCommands([1, 2, 3, 4], [2, 4, 1, 3])).toEqual([
      { type: "moveSlide", id: 2, toIndex: 0 },
      { type: "moveSlide", id: 4, toIndex: 1 },
    ]);
    expect(moveCommands([1, 2], [1, 2])).toEqual([]);
  });

  it("drops a multi-selection before a slide or at the end", () => {
    const d = deck([1, 2, 3, 4, 5]);
    expect(orderAfterDrop(d, [4, 2], { before: 1 }).order).toEqual([2, 4, 1, 3, 5]);
    expect(orderAfterDrop(d, [1], { before: null }).order).toEqual([2, 3, 4, 5, 1]);
    // before one of the dragged slides: before the next one that stays
    expect(orderAfterDrop(d, [2, 3], { before: 3 }).order).toEqual([1, 2, 3, 4, 5]);
    expect(moveSlidesCommand(d, [2, 3], { before: 3 })).toBeNull();
    expect(moveSlidesCommand(d, [5], { before: 2 })).toEqual({ type: "moveSlide", id: 5, toIndex: 1 });
  });

  it("drops into another section: MoveSlide plus RestoreSections in one step", () => {
    const d = deck([1, 2, 3, 4], [{ name: "A", slideIds: [1, 2] }, { name: "B", slideIds: [3, 4] }]);
    const r = orderAfterDrop(d, [1], { before: 4 });
    expect(r.order).toEqual([2, 3, 1, 4]);
    expect(r.sections).toEqual([{ name: "A", slideIds: [2] }, { name: "B", slideIds: [3, 1, 4] }]);
    expect(moveSlidesCommand(d, [1], { before: 4 })).toEqual({
      type: "compound",
      commands: [{ type: "moveSlide", id: 1, toIndex: 2 }, { type: "restoreSections", sections: r.sections }],
    });
    // onto a section header: the start of that section
    expect(orderAfterDrop(d, [4], { before: 1, section: 0 }).sections).toEqual([{ name: "A", slideIds: [4, 1, 2] }, { name: "B", slideIds: [3] }]);
    // the end of the first section: the order is the same, only the membership changes
    const end = moveSlidesCommand(d, [3], { before: null, section: 0 });
    expect(end).toEqual({ type: "restoreSections", sections: [{ name: "A", slideIds: [1, 2, 3] }, { name: "B", slideIds: [4] }] });
  });

  it("zoom slider → thumbnail width", () => {
    expect(sorterThumbWidth(100)).toBe(200);
    expect(sorterThumbWidth(5)).toBe(40);
    expect(sorterThumbWidth(500)).toBe(400);
  });
});

describe("Ctrl+↑ / Ctrl+↓ (P9-S3)", () => {
  it("moves the selection one place, at the ends nowhere", () => {
    const d = deck([1, 2, 3, 4]);
    expect(nudgeDrop(d, [2], -1)).toEqual({ before: 1 });
    expect(nudgeDrop(d, [2, 3], 1)).toEqual({ before: null });
    expect(nudgeDrop(d, [1], -1)).toBeNull();
    expect(nudgeDrop(d, [4], 1)).toBeNull();
    expect(orderAfterDrop(d, [2], nudgeDrop(d, [2], 1)!).order).toEqual([1, 3, 2, 4]);
  });

  it("crosses a section border into the neighbouring section", () => {
    const d = deck([1, 2, 3, 4], [{ name: "A", slideIds: [1, 2] }, { name: "B", slideIds: [3, 4] }]);
    // the first slide of B moves up: the end of A
    const up = nudgeDrop(d, [3], -1)!;
    expect(up).toEqual({ before: null, section: 0 });
    expect(orderAfterDrop(d, [3], up).sections?.map((s) => s.slideIds)).toEqual([[1, 2, 3], [4]]);
    // the last slide of A moves down: the start of B
    const down = nudgeDrop(d, [2], 1)!;
    expect(orderAfterDrop(d, [2], down).sections?.map((s) => s.slideIds)).toEqual([[1], [2, 3, 4]]);
    // inside a section: one place
    expect(orderAfterDrop(d, [1], nudgeDrop(d, [1], 1)!).sections?.map((s) => s.slideIds)).toEqual([[2, 1], [3, 4]]);
  });
});
