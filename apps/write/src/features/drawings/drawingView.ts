// Node view of a shape or text box (P8-34): the outline as SVG (from the
// core's preset geometry), its text in a nested editor, and Word's handles
// while selected — eight resize handles, a rotation handle, the yellow
// adjust handles of the preset. A drag previews on the DOM and ends in one
// transaction (the mapper sends `SetDrawingProps`); text edits in the
// nested editor become new `value.text.blocks` (the mapper sends the text
// commands for the paragraphs inside, addressed by their ids). Floating
// drawings are placed like floating pictures (CSS float / absolute).

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import type { Anchor } from "../../generated/Anchor";
import type { Block } from "../../generated/Block";
import type { Drawing } from "../../generated/Drawing";
import type { Indent } from "../../generated/Indent";
import { nodesToBlocks } from "../../sync/fromPM";
import { blockKey, canonDrawing } from "../../sync/model";
import { blocksToPM } from "../../sync/toPM";
import { colorCss } from "../../sync/schema";
import { floatPlacement, movedAnchor, placementStyle } from "../floating";
import { HANDLES, resizeBy, verticalPage, type Handle } from "../imageView";
import { EMU_PER_PX, fillCss, strokeAttrs } from "./drawings";
import { dragHandle, effectiveAdjust, handlePos, handlesOf, type HandleDef } from "./handles";
import { innerEditors } from "./innerEditors";
import { pathQuery, rectOutline, shapePaths } from "./paths";

export interface DrawingViewOptions {
  /** Page width / left margin / column width (CSS px) for floating positions. */
  page: (() => { width: number; marginLeft: number; columnWidth: number } | null) | null;
  /** Creates the nested editor of a drawing's text (null: the text is shown read-only). */
  inner: ((element: HTMLElement, blocks: Block[]) => Editor) | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const TWIPS_PER_PX = 15;

/** The left/right indent (px) of the paragraph holding the node at `pos`. */
function indentAt(view: EditorView, pos: number | undefined): { left: number; right: number } {
  if (pos === undefined) return { left: 0, right: 0 };
  try {
    const ind = view.state.doc.resolve(pos).parent.attrs.indent as Indent | null;
    return { left: (ind?.left ?? 0) / TWIPS_PER_PX, right: (ind?.right ?? 0) / TWIPS_PER_PX };
  } catch {
    return { left: 0, right: 0 };
  }
}

/** The text blocks of an editor document (its id-carrying blocks as the model has them). */
export function innerBlocks(doc: PMNode): Block[] {
  return nodesToBlocks(doc);
}

const blocksKey = (blocks: readonly Block[]) => blocks.map(blockKey).join("\u0001");

/** The rotation (deg) of a pointer at `(x, y)` around `(cx, cy)`, 0 = straight up; snapped to 15° with Shift. */
export function rotationAt(cx: number, cy: number, x: number, y: number, snap = false): number {
  let deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  if (snap) deg = (Math.round(deg / 15) * 15) % 360;
  return Math.round(deg * 10) / 10;
}

export function drawingNodeView(node: PMNode, view: EditorView, getPos: () => number | undefined, opts: DrawingViewOptions): NodeView {
  let current = node;
  let value = node.attrs.value as Drawing;
  const wrap = document.createElement("span");
  wrap.className = "drawing-wrap";
  wrap.contentEditable = "false";
  const box = document.createElement("span");
  box.className = "drawing-box";
  wrap.append(box);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "drawing-shape");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("preserveAspectRatio", "none");
  box.append(svg);
  const textEl = document.createElement("div");
  textEl.className = "drawing-text";
  box.append(textEl);
  const resize = HANDLES.map((h) => {
    const el = document.createElement("span");
    el.className = `image-handle image-handle-${h} drawing-handle`;
    el.dataset.handle = h;
    wrap.append(el);
    return el;
  });
  const rotate = document.createElement("span");
  rotate.className = "drawing-rotate";
  rotate.dataset.rotate = "1";
  wrap.append(rotate);
  let adjustEls: HTMLElement[] = [];
  let inner: Editor | null = null;
  let innerKey = "";
  let syncing = false;

  const size = (d: Drawing) => ({ w: Math.max(1, d.width / EMU_PER_PX), h: Math.max(1, d.height / EMU_PER_PX) });

  const drawShape = (d: Drawing, w = size(d).w, h = size(d).h) => {
    const q = pathQuery(d.preset, d.width, d.height, d.adjust ?? null);
    const outline = shapePaths.get(q) ?? rectOutline(q);
    svg.setAttribute("viewBox", `0 0 ${q.w} ${q.h}`);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    const stroke = strokeAttrs(d.line);
    // The stroke width is in px: scale it into the EMU viewBox.
    const k = q.w / Math.max(1, w);
    svg.replaceChildren(
      ...outline.paths.map((p) => {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", p.d);
        path.setAttribute("fill", p.fill ? fillCss(d.fill) : "none");
        path.setAttribute("stroke", p.stroke ? stroke.stroke : "none");
        path.setAttribute("stroke-width", String(stroke.width * k));
        if (stroke.dash) path.setAttribute("stroke-dasharray", stroke.dash.split(" ").map((v) => String(Number(v) * k)).join(" "));
        if (p.darken) path.setAttribute("fill-opacity", String(1 - Math.abs(p.darken) / 2));
        return path;
      }),
    );
  };

  const place = (d: Drawing) => {
    const anchor = d.anchor ?? null;
    wrap.classList.remove("floating", "float-left", "float-right", "block", "behind", "front");
    const { w, h } = size(d);
    const css: string[] = [`width: ${w}px`, `height: ${h}px`];
    if (anchor) {
      const ind = indentAt(view, getPos());
      const page = opts.page?.() ?? null;
      const vpage = anchor.v.relativeTo === "page" || anchor.v.relativeTo === "margin" ? verticalPage(wrap) : null;
      const p = floatPlacement(anchor, { width: w, height: h, indentLeft: ind.left, indentRight: ind.right, columnWidth: page?.columnWidth ?? null, page, vpage });
      wrap.classList.add("floating", p.mode);
      wrap.dataset.wrap = anchor.wrap;
      css.push(placementStyle(p));
    } else delete wrap.dataset.wrap;
    wrap.setAttribute("style", css.join("; "));
    const tf: string[] = [];
    if (d.rotation) tf.push(`rotate(${d.rotation}deg)`);
    if (d.flipH) tf.push("scaleX(-1)");
    if (d.flipV) tf.push("scaleY(-1)");
    box.style.transform = tf.join(" ");
  };

  const layoutText = (d: Drawing) => {
    const t = d.text;
    textEl.hidden = !t;
    if (!t) return;
    const ins = t.insets ?? { top: 45720, bottom: 45720, left: 91440, right: 91440 };
    textEl.style.padding = `${ins.top / EMU_PER_PX}px ${ins.right / EMU_PER_PX}px ${ins.bottom / EMU_PER_PX}px ${ins.left / EMU_PER_PX}px`;
    textEl.style.justifyContent = t.verticalAlign === "center" ? "center" : t.verticalAlign === "bottom" ? "flex-end" : "flex-start";
    textEl.style.color = d.textColor ? (colorCss(d.textColor) ?? "") : "";
    textEl.dataset.autofit = t.autofit ?? "none";
    // Text keeps reading direction: a flipped shape's text is not mirrored (Word).
    textEl.style.transform = [d.flipH ? "scaleX(-1)" : "", d.flipV ? "scaleY(-1)" : ""].join(" ").trim();
    const blocks = t.blocks ?? [];
    const key = blocksKey(blocks);
    if (!inner && opts.inner) {
      const el = document.createElement("div");
      textEl.replaceChildren(el);
      inner = opts.inner(el, blocks);
      innerKey = key;
      innerEditors.register(inner, () => getPos());
      inner.on("update", ({ transaction }) => {
        if (syncing || !transaction.docChanged) return;
        pushText();
      });
      inner.on("focus", () => wrap.classList.add("editing"));
      inner.on("blur", () => wrap.classList.remove("editing"));
    } else if (inner && key !== innerKey && !syncing) {
      // A remote change (patch, undo): put the new text in, keeping the caret by paragraph id and offset.
      setInnerBlocks(blocks);
    }
    if (!opts.inner && !inner) {
      textEl.textContent = blocks
        .map((b) => (b.kind === "paragraph" ? (b.value.inlines ?? []).map((i) => (i.kind === "run" ? i.value.text : "")).join("") : ""))
        .join("\n");
    }
  };

  /** Replaces the nested editor's content with `blocks`. */
  const setInnerBlocks = (blocks: Block[]) => {
    if (!inner) return;
    innerKey = blocksKey(blocks);
    syncing = true;
    try {
      const sel = inner.state.selection;
      const $from = sel.$from;
      const id = $from.parent.attrs.id as number | null;
      const off = $from.parentOffset;
      const nodes = blocksToPM({ schema: inner.schema, numbering: { defs: [] } }, blocks);
      if (!nodes.length) nodes.push(inner.schema.nodes.paragraph!.create());
      let tr = inner.state.tr.replaceWith(0, inner.state.doc.content.size, nodes);
      let pos = -1;
      tr.doc.descendants((n, p) => {
        if (pos >= 0) return false;
        if (n.isTextblock && n.attrs.id === id) pos = p + 1 + Math.min(off, n.content.size);
        return !n.isTextblock;
      });
      if (pos >= 0) tr = tr.setSelection(TextSelection.create(tr.doc, pos));
      tr.setMeta("rusuiteSync", "remote");
      inner.view.dispatch(tr);
    } finally {
      syncing = false;
    }
  };

  /** The nested editor's text → the node's value (one outer transaction). */
  const pushText = () => {
    const pos = getPos();
    if (!inner || pos === undefined || !value.text) return;
    const blocks = innerBlocks(inner.state.doc);
    const key = blocksKey(blocks);
    if (key === innerKey) return;
    innerKey = key;
    const next = canonDrawing({ ...value, text: { ...value.text, blocks } });
    syncing = true;
    try {
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: next }));
    } finally {
      syncing = false;
    }
  };

  const drawAdjust = (d: Drawing, w: number, h: number) => {
    adjustEls.forEach((e) => e.remove());
    adjustEls = [];
    const defs = handlesOf(d.preset, d.width, d.height);
    if (!defs.length) return;
    const outline = shapePaths.get(pathQuery(d.preset, d.width, d.height, d.adjust ?? null));
    const adj = effectiveAdjust(outline?.defaults ?? {}, d.adjust ?? undefined);
    defs.forEach((def, i) => {
      const p = handlePos(def, adj);
      const el = document.createElement("span");
      el.className = "drawing-adjust";
      el.dataset.adjust = String(i);
      el.style.left = `${(p.x / d.width) * w - 5}px`;
      el.style.top = `${(p.y / d.height) * h - 5}px`;
      el.addEventListener("pointerdown", (e) => onAdjust(e, def));
      box.append(el);
      adjustEls.push(el);
    });
  };

  const render = (d: Drawing) => {
    value = d;
    wrap.dataset.drawingId = String(d.id);
    wrap.dataset.kind = d.kind ?? "shape";
    wrap.dataset.preset = d.preset;
    wrap.title = d.alt ?? "";
    place(d);
    const { w, h } = size(d);
    drawShape(d, w, h);
    layoutText(d);
    drawAdjust(d, w, h);
  };

  render(value);
  // Page / margin positions follow the print layout's pages (like floating pictures).
  const onLayout = () => {
    const a = value.anchor;
    if (a && (a.v.relativeTo === "page" || a.v.relativeTo === "margin")) place(value);
  };
  view.dom.addEventListener("rusuite-layout", onLayout);
  const offPaths = shapePaths.subscribe(() => {
    drawShape(value);
    drawAdjust(value, size(value).w, size(value).h);
  });

  const zoomOf = () => (wrap.offsetWidth ? wrap.getBoundingClientRect().width / wrap.offsetWidth || 1 : 1);
  const commit = (d: Drawing) => {
    const pos = getPos();
    if (pos === undefined) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing(d) });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
  };

  // ----- resize ------------------------------------------------------------------
  let dragging = false;
  const onResize = (e: PointerEvent) => {
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const z = zoomOf();
    const { w: w0, h: h0 } = size(value);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let next = { w: w0, h: h0 };
    dragging = true;
    wrap.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      // Corners keep the proportions only with Shift (shapes, like Word).
      const free = !ev.shiftKey && handle.length === 2;
      next = free
        ? {
            w: Math.max(8, Math.round(w0 + (handle.includes("w") ? -1 : 1) * ((ev.clientX - x0) / z))),
            h: Math.max(8, Math.round(h0 + (handle.includes("n") ? -1 : 1) * ((ev.clientY - y0) / z))),
          }
        : resizeBy(handle, w0, h0, (ev.clientX - x0) / z, (ev.clientY - y0) / z);
      wrap.style.width = `${next.w}px`;
      wrap.style.height = `${next.h}px`;
      svg.setAttribute("width", String(next.w));
      svg.setAttribute("height", String(next.h));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      wrap.classList.remove("resizing");
      if (next.w === w0 && next.h === h0) {
        render(value);
        return;
      }
      commit({ ...value, width: Math.round(next.w * EMU_PER_PX), height: Math.round(next.h * EMU_PER_PX) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  resize.forEach((h) => h.addEventListener("pointerdown", onResize));

  // ----- rotate ------------------------------------------------------------------
  const onRotate = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let deg = value.rotation ?? 0;
    dragging = true;
    const move = (ev: PointerEvent) => {
      deg = rotationAt(cx, cy, ev.clientX, ev.clientY, ev.shiftKey);
      box.style.transform = `rotate(${deg}deg)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      if (deg === (value.rotation ?? 0)) {
        render(value);
        return;
      }
      commit({ ...value, rotation: deg });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  rotate.addEventListener("pointerdown", onRotate);

  // ----- adjust ------------------------------------------------------------------
  const onAdjust = (e: PointerEvent, def: HandleDef) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const z = zoomOf();
    const r = box.getBoundingClientRect();
    const { w, h } = size(value);
    let adj = { ...(value.adjust ?? {}) };
    dragging = true;
    const move = (ev: PointerEvent) => {
      const px = ((ev.clientX - r.left) / z / w) * value.width;
      const py = ((ev.clientY - r.top) / z / h) * value.height;
      adj = { ...(value.adjust ?? {}), ...dragHandle(def, { x: px, y: py }) };
      const preview = { ...value, adjust: adj };
      drawShape(preview);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      if (JSON.stringify(adj) === JSON.stringify(value.adjust ?? {})) {
        render(value);
        return;
      }
      commit({ ...value, adjust: adj });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ----- move (floating) -----------------------------------------------------------
  const onMove = (e: PointerEvent) => {
    const anchor = value.anchor as Anchor | undefined;
    const target = e.target as HTMLElement;
    if (!anchor || !wrap.classList.contains("selected") || e.button !== 0 || target.dataset.handle || target.dataset.rotate || target.dataset.adjust) return;
    // A click in the text puts the caret there (the nested editor); the rest of the box drags it.
    if (target.closest(".drawing-text .ProseMirror") || (target.closest(".drawing-text") && wrap.classList.contains("editing"))) return;
    e.preventDefault();
    e.stopPropagation();
    const para = wrap.closest("p, h1, h2, h3, h4, h5, h6") as HTMLElement | null;
    const z = zoomOf();
    const ind = indentAt(view, getPos());
    const r0 = wrap.getBoundingClientRect();
    const p0 = para?.getBoundingClientRect() ?? r0;
    const x = (r0.left - p0.left) / z + ind.left;
    const y = (r0.top - p0.top) / z;
    const sx = e.clientX;
    const sy = e.clientY;
    let d = { x: 0, y: 0 };
    dragging = true;
    wrap.classList.add("moving");
    const move = (ev: PointerEvent) => {
      d = { x: (ev.clientX - sx) / z, y: (ev.clientY - sy) / z };
      wrap.style.translate = `${d.x}px ${d.y}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      wrap.classList.remove("moving");
      wrap.style.translate = "";
      if (Math.hypot(d.x, d.y) < 3) return;
      commit({ ...value, anchor: movedAnchor(anchor, x, y, d.x, d.y) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  wrap.addEventListener("pointerdown", onMove);

  // A double click on a shape puts the caret into its text (Word's Edit Text).
  const onDblClick = (e: MouseEvent) => {
    if (!inner || (e.target as HTMLElement).closest(".drawing-text .ProseMirror")) return;
    e.preventDefault();
    inner.commands.focus("end");
  };
  wrap.addEventListener("dblclick", onDblClick);

  return {
    dom: wrap,
    update(n) {
      if (n.type !== current.type) return false;
      current = n;
      if (n.attrs.value !== value) render(n.attrs.value as Drawing);
      return true;
    },
    selectNode() {
      wrap.classList.add("selected");
    },
    deselectNode() {
      wrap.classList.remove("selected");
    },
    stopEvent(e) {
      const t = e.target as HTMLElement | null;
      // The nested editor handles its own keys, input and pointer.
      if (t?.closest?.(".drawing-text")) return true;
      if (t?.dataset?.handle || t?.dataset?.rotate || t?.dataset?.adjust || dragging) return true;
      return /^(pointer|mouse|click|dblclick|dragstart)/.test(e.type) && !!value.anchor && wrap.classList.contains("selected");
    },
    ignoreMutation: () => true,
    destroy() {
      offPaths();
      view.dom.removeEventListener("rusuite-layout", onLayout);
      resize.forEach((h) => h.removeEventListener("pointerdown", onResize));
      rotate.removeEventListener("pointerdown", onRotate);
      wrap.removeEventListener("pointerdown", onMove);
      wrap.removeEventListener("dblclick", onDblClick);
      if (inner) {
        innerEditors.unregister(inner);
        inner.destroy();
        inner = null;
      }
    },
  };
}
