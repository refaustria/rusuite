import { describe, expect, it } from "vitest";
import type { Slide } from "../generated/Slide";
import { rect } from "../test/fixture";
import { allCommand, hideCommand, moveToZ, paneRows, renameCommand, zOfRow } from "./selection";

const slide = (): Slide => {
  const g = rect(20, 0, 0);
  g.kind = { kind: "group", value: { children: [rect(21, 0, 0), rect(22, 0, 0)] } };
  const hidden = rect(3, 0, 0);
  hidden.hidden = true;
  return { id: 1, layout: "blank", shapes: [rect(2, 0, 0), hidden, g] };
};

describe("Selection pane", () => {
  it("rows are top to bottom, group children under their group", () => {
    const rows = paneRows(slide());
    expect(rows.map((r) => [r.id, r.depth, r.top])).toEqual([[20, 0, 20], [22, 1, 20], [21, 1, 20], [3, 0, 3], [2, 0, 2]]);
    expect(rows.find((r) => r.id === 3)!.hidden).toBe(true);
  });

  it("hide / show and Show All / Hide All change only what differs", () => {
    expect(hideCommand([2], true)).toEqual({ type: "setShapesHidden", shapes: [2], hidden: true });
    expect(hideCommand([], true)).toBeNull();
    expect(allCommand(slide(), false)).toEqual({ type: "setShapesHidden", shapes: [3], hidden: false });
    expect(allCommand(slide(), true)).toEqual({ type: "setShapesHidden", shapes: [2, 20], hidden: true });
  });

  it("rename trims and skips unchanged names", () => {
    const s = rect(2, 0, 0);
    expect(renameCommand(s, "  Logo ")).toEqual({ type: "setName", shape: 2, name: "Logo" });
    expect(renameCommand(s, s.name)).toBeNull();
    expect(renameCommand(s, "  ")).toBeNull();
  });

  it("reorder to a row: Bring Forward / Send Backward steps in one undo step", () => {
    const sl = slide();
    expect(moveToZ(sl, 2, 2)).toEqual({ type: "compound", commands: [{ type: "zOrder", shapes: [2], op: "bringForward" }, { type: "zOrder", shapes: [2], op: "bringForward" }] });
    expect(moveToZ(sl, 20, 1)).toEqual({ type: "zOrder", shapes: [20], op: "sendBackward" });
    expect(moveToZ(sl, 2, 0)).toBeNull();
    expect(moveToZ(sl, 99, 0)).toBeNull();
    expect(zOfRow(sl, 0)).toBe(2);
    expect(zOfRow(sl, 2)).toBe(0);
  });
});
