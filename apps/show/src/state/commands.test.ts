import { describe, expect, it } from "vitest";
import type { ShowCommand } from "../generated/ShowCommand";
import { body, rect, textShape } from "../test/fixture";
import {
  bodyFromText, bulletCommand, compound, copyShape, duplicateCommand, gestureCommand, indentCommands, newShape,
  nudgeCommand, runPropsRange, runPropsWhole, textPos,
} from "./commands";

const WIDE = { width: 12192000, height: 6858000 };
const temps = () => {
  let n = 0;
  return () => --n;
};

describe("commands", () => {
  it("transformer end → one SetTransform for the changed shapes only", () => {
    const a = rect(1, 0, 0); // 192 × 144 px at (0,0) → centre (96, 72)
    const b = rect(2, 952500, 0);
    const cmd = gestureCommand([
      { shape: a, attrs: { x: 106, y: 72, rotation: 0, scaleX: 1, scaleY: 1 } },
      { shape: b, attrs: { x: 196, y: 72, rotation: 0, scaleX: 1, scaleY: 1 } },
    ]);
    expect(cmd).toEqual({ type: "setTransform", shapes: [[1, { ...a.transform, x: 95250 }]] });
    expect(gestureCommand([{ shape: b, attrs: { x: 196, y: 72, rotation: 0, scaleX: 1, scaleY: 1 } }])).toBeNull();
    const resized = gestureCommand([{ shape: a, attrs: { x: 96, y: 72, rotation: 45, scaleX: 1.5, scaleY: 0.5 } }]);
    expect(resized).toEqual({ type: "setTransform", shapes: [[1, { x: -457200, y: 342900, w: 2743200, h: 685800, rotationDeg: 45 }]] });
  });

  it("nudges by slide px", () => {
    const cmd = nudgeCommand([rect(1, 100, 200)], -10, 1) as Extract<ShowCommand, { type: "setTransform" }>;
    expect(cmd.shapes[0]![1]).toMatchObject({ x: 100 - 95250, y: 200 + 9525 });
    expect(nudgeCommand([], 1, 0)).toBeNull();
  });

  it("duplicates with fresh temporary ids (also for group children) as one compound", () => {
    const group = { ...rect(5, 0, 0), kind: { kind: "group" as const, value: { children: [rect(6, 0, 0), rect(7, 10, 10)] } } };
    const copy = copyShape(group, temps(), 100);
    expect(copy.id).toBe(-1);
    expect(copy.kind.kind === "group" && copy.kind.value.children.map((c) => c.id)).toEqual([-2, -3]);
    expect(copy.transform.x).toBe(100);
    const { command, ids } = duplicateCommand(9, [rect(1, 0, 0), rect(2, 0, 0)], temps());
    expect(ids).toEqual([-1, -2]);
    expect(command?.type).toBe("compound");
    const single = duplicateCommand(9, [rect(1, 0, 0)], temps());
    expect(single.command).toMatchObject({ type: "addShape", slide: 9, shape: { id: -1, name: "" } });
  });

  it("text overlay commit → SetTextBody paragraphs, keeping paragraph props and unchanged runs", () => {
    const old = body("Title", "Point");
    old.paragraphs[0]!.props = { alignment: "center" };
    old.paragraphs[1]!.props = { level: 1, bullet: { kind: "char", value: "–" } };
    old.paragraphs[1]!.runs = [{ text: "Po", props: { bold: true } }, { text: "int" }];
    const next = bodyFromText("Title\nPoint\nNew one\n", old);
    expect(next.props).toBe(old.props);
    expect(next.paragraphs).toHaveLength(4);
    expect(next.paragraphs[0]).toBe(old.paragraphs[0]);
    expect(next.paragraphs[1]).toBe(old.paragraphs[1]);
    expect(next.paragraphs[2]).toEqual({ props: old.paragraphs[1]!.props, runs: [{ text: "New one", props: { bold: true } }] });
    expect(next.paragraphs[3]!.runs).toEqual([]);
    const edited = bodyFromText("Titles", old);
    expect(edited.paragraphs).toEqual([{ props: { alignment: "center" }, runs: [{ text: "Titles" }] }]);
  });

  it("maps textarea selections to paragraph offsets in Unicode scalars", () => {
    expect(textPos("ab\ncd", 4)).toEqual({ paragraph: 1, offset: 1 });
    expect(textPos("😀x\ny", 3)).toEqual({ paragraph: 0, offset: 2 });
    const text = "Hello\nwide 😀 world\nend";
    const cmds = runPropsRange(7, text, 3, 6 + 7, { bold: true });
    expect(cmds).toEqual([
      { type: "setRunProps", shape: 7, paragraph: 0, from: 3, to: 5, patch: { bold: true } },
      { type: "setRunProps", shape: 7, paragraph: 1, from: 0, to: 6, patch: { bold: true } },
    ]);
    expect(runPropsRange(7, "ab\n\ncd", 1, 1, { italic: true }).map((c) => (c as { paragraph: number }).paragraph)).toEqual([0, 2]);
    expect(runPropsWhole(7, body("x", "", "yz"), { size: 2000 })).toHaveLength(2);
  });

  it("toggles bullets and changes levels", () => {
    const bullet = { kind: "char", value: "•" } as const;
    expect(bulletCommand(3, [0, 1], [bullet, bullet], bullet)).toEqual({ type: "setParagraphProps", shape: 3, paragraphs: [0, 1], patch: { bullet: { kind: "none" } } });
    expect(bulletCommand(3, [0], [null], bullet)).toMatchObject({ patch: { bullet } });
    expect(indentCommands(3, [0, 1, 2], [0, 1, 8], 1)).toEqual([
      { type: "setParagraphProps", shape: 3, paragraphs: [0], patch: { level: 1 } },
      { type: "setParagraphProps", shape: 3, paragraphs: [1], patch: { level: 2 } },
    ]);
  });

  it("builds inserted shapes centred on the slide", () => {
    const r = newShape("rect", WIDE, -4);
    expect(r).toMatchObject({ id: -4, name: "", transform: { x: 5181600, y: 2743200 }, kind: { kind: "auto", value: { geometry: "rect" } }, fill: { kind: "solid" } });
    const t = newShape("textBox", WIDE, -1);
    expect(t.fill).toEqual({ kind: "none" });
    expect(t.kind.kind === "auto" && t.kind.value.text?.paragraphs).toEqual([{ runs: [] }]);
    expect(newShape("line", WIDE, -2).transform.h).toBe(0);
    expect(compound([])).toBeNull();
  });

  it("keeps placeholders of copied shapes", () => {
    expect(copyShape(textShape(2, ["x"], { placeholder: "title" }), temps()).placeholder).toBe("title");
  });
});

describe("duplicating connectors (P8-16)", () => {
  it("keeps a connector glued to shapes copied with it, unglues it from the others", () => {
    const a = rect(1, 0, 0);
    const c = { ...rect(3, 0, 0), kind: { kind: "connector" as const, value: { kind: "straight" as const, start: { shape: 1, site: 3 }, end: { shape: 2, site: 1 } } } };
    let n = 0;
    const temp = () => --n;
    const both = duplicateCommand(9, [a, c], temp);
    const cmds = both.command?.type === "compound" ? both.command.commands : [];
    expect(cmds[1]).toMatchObject({ type: "addShape", shape: { kind: { value: { start: { shape: -1, site: 3 } } } } });
    expect(cmds[1]?.type === "addShape" && cmds[1].shape.kind.kind === "connector" && cmds[1].shape.kind.value.end).toBeUndefined();
    expect(c.kind.value.end).toEqual({ shape: 2, site: 1 }); // the original is untouched
  });
});
