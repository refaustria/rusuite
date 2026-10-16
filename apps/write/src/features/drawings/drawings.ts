// Shapes and text boxes in the text (P8-34): the Insert › Shapes library,
// insertion (Rust-first `InsertDrawing`), the selected drawing, property
// changes as editor transactions (the mapper sends `SetDrawingProps`),
// Shape Styles presets and the CSS/SVG paint of a drawing.

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Color } from "../../../../../packages/ui-shared/src/generated/Color";
import type { Anchor } from "../../generated/Anchor";
import type { Drawing } from "../../generated/Drawing";
import type { DrawingKind } from "../../generated/DrawingKind";
import type { LineDash } from "../../generated/LineDash";
import type { ShapeFill } from "../../generated/ShapeFill";
import type { ShapeLine } from "../../generated/ShapeLine";
import type { WriteCommand } from "../../generated/WriteCommand";
import { cursorBlock } from "../../sync/editorCommands";
import { canonDrawing } from "../../sync/model";
import { colorCss } from "../../sync/schema";
import type { SyncController } from "../../sync/SyncPlugin";
import { innerEditors } from "./innerEditors";

/** EMU per CSS pixel and per centimetre. */
export const EMU_PER_PX = 9525;
export const EMU_PER_CM = 360000;
export const EMU_PER_PT = 12700;

/** The Insert › Shapes groups (Word's order) and their presets. */
export const SHAPE_GROUPS: { id: string; items: string[] }[] = [
  { id: "lines", items: ["line"] },
  { id: "rectangles", items: ["rect", "roundRect", "snip1Rect", "snip2SameRect", "round1Rect", "round2SameRect"] },
  {
    id: "basic",
    items: ["textBox", "ellipse", "triangle", "rtTriangle", "parallelogram", "trapezoid", "diamond", "pentagon", "hexagon", "octagon", "heart", "cloud"],
  },
  { id: "arrows", items: ["rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow", "homePlate", "chevron"] },
  {
    id: "flowchart",
    items: ["flowChartProcess", "flowChartDecision", "flowChartInputOutput", "flowChartTerminator", "flowChartDocument", "flowChartConnector"],
  },
  { id: "stars", items: ["star4", "star5", "star6", "star8"] },
  { id: "callouts", items: ["wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout"] },
];

/** Word's default sizes: shapes 2.5 × 2.5 cm (lines 4 cm wide), text boxes 5 × 2.5 cm. */
export function defaultSize(preset: string, kind: DrawingKind): { width: number; height: number } {
  if (kind === "textBox") return { width: 5 * EMU_PER_CM, height: 2.5 * EMU_PER_CM };
  if (preset === "line") return { width: 4 * EMU_PER_CM, height: 1 };
  if (/Arrow$|homePlate|chevron/.test(preset) && !/^(up|down|upDown)/.test(preset)) return { width: 3.5 * EMU_PER_CM, height: 1.8 * EMU_PER_CM };
  return { width: 2.5 * EMU_PER_CM, height: 2.5 * EMU_PER_CM };
}

/** `InsertDrawing` of a gallery item (`textBox` = Simple Text Box) at the caret, or null outside text. */
export function insertDrawingCommand(editor: Editor, id: string, opts: { anchor?: Anchor | null; text?: string } = {}): WriteCommand | null {
  const at = cursorBlock(editor);
  if (!at) return null;
  const kind: DrawingKind = id === "textBox" ? "textBox" : "shape";
  const preset = id === "textBox" ? "rect" : id;
  const cmd: WriteCommand = { type: "insertDrawing", block: at.id, offset: at.offset, kind, preset, ...defaultSize(preset, kind) };
  if (opts.anchor) cmd.anchor = opts.anchor;
  if (opts.text != null) cmd.text = opts.text;
  return cmd;
}

/** Inserts a shape or text box at the caret and selects it. */
export async function insertDrawing(editor: Editor, ctl: SyncController, id: string, opts: { anchor?: Anchor | null; text?: string } = {}): Promise<boolean> {
  await ctl.idle();
  const cmd = insertDrawingCommand(editor, id, opts);
  if (!cmd || cmd.type !== "insertDrawing") return false;
  await ctl.run(cmd);
  // Select the new drawing (at the old caret position).
  const pos = drawingPosAt(editor.state.doc, cmd.block, cmd.offset);
  if (pos != null) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  return true;
}

/** PM position of the drawing at char `offset` of paragraph `block`. */
export function drawingPosAt(doc: PMNode, block: number, offset: number): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.isTextblock && node.attrs.id === block) {
      let chars = 0;
      node.forEach((child, off) => {
        if (found != null) return;
        if (chars === offset && child.type.name === "drawing") found = pos + 1 + off;
        chars += child.isText ? [...child.text!].length : 1;
      });
      return false;
    }
    return true;
  });
  return found;
}

/**
 * The selected drawing node and its position — the drawing selected as an
 * object, or the one whose text has the caret (its nested editor) — or null.
 */
export function selectedDrawing(state: EditorState): { node: PMNode; pos: number; value: Drawing } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "drawing" && sel.node.attrs.value) {
    return { node: sel.node, pos: sel.from, value: sel.node.attrs.value as Drawing };
  }
  const inner = innerEditors.active();
  const pos = inner ? innerEditors.hostPos(inner) : undefined;
  const node = pos !== undefined && pos <= state.doc.content.size ? state.doc.nodeAt(pos) : null;
  if (pos !== undefined && node?.type.name === "drawing" && node.attrs.value) return { node, pos, value: node.attrs.value as Drawing };
  return null;
}

/** Replaces the drawing at `pos` by `value` (kept selected unless its text is being edited; the mapper sends `SetDrawingProps` / text commands). */
export function setDrawingValue(view: EditorView, pos: number, value: Drawing, keepSelection = true): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "drawing") return false;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing(value) });
  if (keepSelection && !innerEditors.active()) tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
  return true;
}

/** Changes the selected drawing with `f`. */
export function editSelectedDrawing(editor: Editor, f: (d: Drawing) => Drawing): boolean {
  const sel = selectedDrawing(editor.state);
  if (!sel) return false;
  return setDrawingValue(editor.view, sel.pos, f(structuredClone(sel.value)));
}

// ----- paint -------------------------------------------------------------------------

const theme = (slot: string, tint = 0): Color => ({ kind: "theme", value: { slot, tint } }) as unknown as Color;
const rgb = (hex: string): Color => ({ kind: "rgb", value: hex }) as unknown as Color;

/** Word's default outline of a new shape: accent 1, 50 % darker, 1 pt. */
export const DEFAULT_LINE: ShapeLine = { fill: { kind: "solid", value: theme("accent1", -0.5) }, width: EMU_PER_PT };

/** Shape Styles presets (Word's first row look: colored fill, subtle/outline variants). */
export interface ShapeStyle {
  id: string;
  fill: ShapeFill;
  line: ShapeLine;
  text: Color | null;
}

const ACCENTS = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

/** 3 rows × 6 accents: colored fill, light fill with colored outline, outline only. */
export const SHAPE_STYLES: ShapeStyle[] = [
  ...ACCENTS.map((a) => ({ id: `fill-${a}`, fill: { kind: "solid", value: theme(a) } as ShapeFill, line: { fill: { kind: "solid", value: theme(a, -0.5) }, width: EMU_PER_PT } as ShapeLine, text: theme("light1") })),
  ...ACCENTS.map((a) => ({ id: `light-${a}`, fill: { kind: "solid", value: theme(a, 0.8) } as ShapeFill, line: { fill: { kind: "solid", value: theme(a) }, width: EMU_PER_PT } as ShapeLine, text: theme("dark1") })),
  ...ACCENTS.map((a) => ({ id: `outline-${a}`, fill: { kind: "solid", value: rgb("FFFFFF") } as ShapeFill, line: { fill: { kind: "solid", value: theme(a) }, width: EMU_PER_PT } as ShapeLine, text: theme("dark1") })),
];

/** The drawing with Shape Style `s`. */
export function withShapeStyle(d: Drawing, s: ShapeStyle): Drawing {
  const out: Drawing = { ...d, fill: s.fill, line: s.line };
  if (s.text) out.textColor = s.text;
  else delete out.textColor;
  return out;
}

/** CSS colour of a fill, or `none`. */
export function fillCss(f: ShapeFill | null | undefined): string {
  return f && f.kind === "solid" ? (colorCss(f.value) ?? "none") : "none";
}

/** SVG stroke attributes of an outline (`none` without one). */
export function strokeAttrs(l: ShapeLine | null | undefined): { stroke: string; width: number; dash: string } {
  if (!l || l.fill.kind !== "solid") return { stroke: "none", width: 0, dash: "" };
  const w = Math.max(0.5, l.width / EMU_PER_PX);
  return { stroke: colorCss(l.fill.value) ?? "#000", width: w, dash: dashArray(l.dash ?? "solid", w) };
}

/** SVG `stroke-dasharray` of a dash style at width `w` px. */
export function dashArray(dash: LineDash, w: number): string {
  const u = Math.max(1, w);
  switch (dash) {
    case "dot":
      return `${u} ${u * 2}`;
    case "squareDot":
      return `${u} ${u}`;
    case "dash":
      return `${u * 4} ${u * 3}`;
    case "dashDot":
      return `${u * 4} ${u * 3} ${u} ${u * 3}`;
    case "longDash":
      return `${u * 8} ${u * 3}`;
    case "longDashDot":
      return `${u * 8} ${u * 3} ${u} ${u * 3}`;
    default:
      return "";
  }
}

/** Outline weights of Shape Outline › Weight (pt). */
export const LINE_WEIGHTS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
export const LINE_DASHES: LineDash[] = ["solid", "dot", "squareDot", "dash", "dashDot", "longDash", "longDashDot"];

/** The drawing rotated by `delta` degrees (normalized to 0..360). */
export function rotated(d: Drawing, delta: number): Drawing {
  const r = (((d.rotation ?? 0) + delta) % 360 + 360) % 360;
  const out: Drawing = { ...d, rotation: r };
  if (!r) delete out.rotation;
  return out;
}

/** The drawing flipped horizontally or vertically. */
export function flipped(d: Drawing, axis: "h" | "v"): Drawing {
  const out = { ...d };
  if (axis === "h") out.flipH = !d.flipH;
  else out.flipV = !d.flipV;
  if (!out.flipH) delete out.flipH;
  if (!out.flipV) delete out.flipV;
  return out;
}
