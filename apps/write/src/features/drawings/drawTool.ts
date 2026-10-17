// Drawing shapes and text boxes by dragging (P9-W4, Word's Insert › Shapes):
// picking a shape arms the tool (crosshair); a click on the page inserts it
// at Word's default size, a drag at the drawn size, Shift keeps it square
// (lines at 45° steps); Enter inserts it at the caret, Escape cancels. The
// new drawing floats in front of the text (text boxes: square wrapping),
// anchored to the paragraph under the pointer at the drawn place.

import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Anchor } from "../../generated/Anchor";
import type { DrawingKind } from "../../generated/DrawingKind";
import type { Indent } from "../../generated/Indent";
import type { WriteCommand } from "../../generated/WriteCommand";
import { charOffsetOf, type SyncController } from "../../sync/SyncPlugin";
import { newAnchor, zoomOf } from "../floating";
import { defaultSize, drawingPosAt, EMU_PER_PX, insertDrawing } from "./drawings";

/** The drawn rectangle (px) from a press at `a` and the pointer at `b`; `constrain` (Shift) makes it square. */
export function drawnRect(a: { x: number; y: number }, b: { x: number; y: number }, constrain: boolean, line = false): { x: number; y: number; w: number; h: number } {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (constrain) {
    if (line) {
      // Lines: horizontal, vertical or 45°.
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      dx = Math.round(Math.cos(ang) * len);
      dy = Math.round(Math.sin(ang) * len);
    } else {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
    }
  }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** The InsertDrawing of a drawn shape: `rect` in px from the column's left edge and the paragraph's top; a click (tiny rect) gets the default size. */
export function drawnCommand(id: string, block: number, offset: number, rect: { x: number; y: number; w: number; h: number }): WriteCommand {
  const kind: DrawingKind = id === "textBox" ? "textBox" : "shape";
  const preset = id === "textBox" ? "rect" : id;
  const click = rect.w < 4 && rect.h < 4;
  const def = defaultSize(preset, kind);
  const width = click ? def.width : Math.max(EMU_PER_PX, Math.round(rect.w * EMU_PER_PX));
  const height = click ? def.height : Math.max(preset === "line" ? 1 : EMU_PER_PX, Math.round(rect.h * EMU_PER_PX));
  const base = newAnchor(kind === "textBox" ? "square" : "inFront");
  const anchor: Anchor = {
    ...base,
    h: { relativeTo: "column", place: { kind: "offset", value: Math.round(rect.x * EMU_PER_PX) } },
    v: { relativeTo: "paragraph", place: { kind: "offset", value: Math.round(rect.y * EMU_PER_PX) } },
  };
  return { type: "insertDrawing", block, offset, kind, preset, width, height, anchor, ...(kind === "textBox" ? { text: "" } : {}) };
}

let armed: { id: string; editor: Editor; ctl: SyncController; off: () => void } | null = null;

/** The armed tool (a gallery item id), or null. */
export const drawToolArmed = (): string | null => armed?.id ?? null;

/** Disarms the tool. */
export function cancelDrawTool(): void {
  armed?.off();
  armed = null;
}

/** Arms the drawing tool with gallery item `id` (a preset or `textBox`). */
export function armDrawTool(editor: Editor, ctl: SyncController, id: string): void {
  cancelDrawTool();
  const dom = editor.view.dom as HTMLElement;
  const page = (dom.closest(".write-page") as HTMLElement | null) ?? dom;
  page.classList.add("drawing-tool");
  dom.classList.add("drawing-tool");
  dom.dataset.drawTool = id;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const band = document.createElement("div");
    band.className = "draw-band";
    document.body.append(band);
    let end = start;
    let shift = e.shiftKey;
    const show = () => {
      const r = drawnRect(start, end, shift, id === "line");
      band.style.left = `${r.x}px`;
      band.style.top = `${r.y}px`;
      band.style.width = `${r.w}px`;
      band.style.height = `${r.h}px`;
    };
    show();
    const move = (ev: PointerEvent) => {
      end = { x: ev.clientX, y: ev.clientY };
      shift = ev.shiftKey;
      show();
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      band.remove();
      const r = drawnRect(start, end, shift, id === "line");
      const tool = armed;
      cancelDrawTool();
      if (tool) void place(tool.editor, tool.ctl, id, r).catch((err) => tool.ctl.pushError(err));
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelDrawTool();
    } else if (e.key === "Enter") {
      // Keyboard: the default size at the caret (inline, like Word's keyboard insertion).
      e.preventDefault();
      e.stopPropagation();
      cancelDrawTool();
      void insertDrawing(editor, ctl, id).catch((err) => ctl.pushError(err));
    }
  };
  page.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  armed = {
    id,
    editor,
    ctl,
    off: () => {
      page.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      page.classList.remove("drawing-tool");
      dom.classList.remove("drawing-tool");
      delete dom.dataset.drawTool;
    },
  };
}

/** The top-level paragraph a drawing at client `y` is anchored to: the last one starting above it (else the first). */
function anchorParagraph(editor: Editor, y: number): { pos: number; node: import("@tiptap/pm/model").Node; el: HTMLElement } | null {
  const view = editor.view;
  let best: { pos: number; node: import("@tiptap/pm/model").Node; el: HTMLElement } | null = null;
  view.state.doc.forEach((node, offset) => {
    if (!node.isTextblock || node.attrs.id == null) return;
    const el = view.nodeDOM(offset) as HTMLElement | null;
    if (!el?.getBoundingClientRect) return;
    const top = el.getBoundingClientRect().top;
    if (!best || top <= y) best = { pos: offset, node, el };
  });
  return best;
}

/** Inserts the drawn shape (`r`: client px) anchored to the paragraph at its top edge. */
async function place(editor: Editor, ctl: SyncController, id: string, r: { x: number; y: number; w: number; h: number }): Promise<boolean> {
  const view = editor.view;
  const dom = view.dom as HTMLElement;
  const z = zoomOf(dom);
  const at = anchorParagraph(editor, r.y);
  if (!at) return false;
  const para = at.node;
  const pr = at.el.getBoundingClientRect();
  const indent = ((para.attrs.indent as Indent | null)?.left ?? 0) / 15;
  // Offsets from the column's left edge (the paragraph's left edge minus its indent) and the paragraph's top.
  const rect = { x: (r.x - pr.left) / z + indent, y: (r.y - pr.top) / z, w: r.w / z, h: r.h / z };
  // At the start of the paragraph's line under the pointer (Word anchors to the paragraph; the position is a detail).
  let offset = 0;
  try {
    const hit = view.posAtCoords({ left: Math.max(pr.left + 1, Math.min(r.x, pr.right - 1)), top: Math.max(pr.top + 1, Math.min(r.y, pr.bottom - 1)) });
    if (hit && hit.pos > at.pos && hit.pos < at.pos + para.nodeSize) offset = charOffsetOf(para, hit.pos - at.pos - 1);
  } catch {
    offset = 0;
  }
  await ctl.idle();
  const cmd = drawnCommand(id, para.attrs.id as number, offset, rect);
  await ctl.run(cmd);
  if (cmd.type !== "insertDrawing") return false;
  const pos = drawingPosAt(editor.state.doc, cmd.block, cmd.offset);
  if (pos == null) return false;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  return true;
}
