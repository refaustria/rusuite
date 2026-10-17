// Node view of a shape, text box or group (P8-34, P9-W4): the outline as
// SVG (from the core's preset geometry), its text in a nested editor, and
// Word's handles while selected — eight resize handles and a rotation
// handle in a frame that rotates with the shape, the yellow adjust handles
// of the preset. A drag previews on the DOM and ends in one transaction
// (the mapper sends `SetDrawingProps`); text edits in the nested editor
// become new `value.text.blocks` (the mapper sends the text commands for
// the paragraphs inside, addressed by their ids). Floating drawings are
// placed like floating pictures (CSS float / absolute).
//
// Groups draw their members (shapes, text boxes with editable text,
// pictures, nested groups) in the group's frame; resizing scales them, a
// click on a member of the selected group selects the member (the Shape
// Format tab then edits it), dragging a selected member moves it inside the
// group. Linked text boxes: the first box of a chain edits the story, the
// later ones show what overflows (`textChain.ts`).

import { resizeCursor, rotationAt, toLocal as boxToLocal } from "@rusuite/ui-shared";
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
import { colorCss, linkTitle, pictureFilterCss } from "../../sync/schema";
import { floatPlacement, lineTopAt, movedAnchor, placementStyle, renderedOffset, zoomOf } from "../floating";
import { HANDLES, pictureFrameCss, shapeClip, verticalPage, visibleFraction, type Handle } from "../imageView";
import { bevelCss } from "../pictures";
import { EMU_PER_PX, fillCss, selectedMemberOf, selectMember, strokeAttrs } from "./drawings";
import { bounds, memberAt, memberPath, rotatedResize, scaleGroup, snapMove, withMember } from "./geometry";
import { dragHandle, effectiveAdjust, handleFocusOf, handlePos, handlesOf, onHandleFocus, outlineFor, type HandleDef } from "./handles";
import { innerEditors } from "./innerEditors";
import { toggleObject } from "./objects";
import { pathQuery, rectOutline, shapePaths } from "./paths";
import { chains, clickInFollower, type ChainMember } from "./textChain";

export interface DrawingViewOptions {
  /** Page width / left margin / column width (CSS px) for floating positions. */
  page: (() => { width: number; marginLeft: number; columnWidth: number } | null) | null;
  /** Creates the nested editor of a drawing's text (null: the text is shown read-only). */
  inner: ((element: HTMLElement, blocks: Block[]) => Editor) | null;
  /** Object URL of a media item (pictures in groups). */
  resolve?: ((id: number) => Promise<string>) | null;
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

// The rotation of a pointer around the centre is shared with Show (ui-shared, P9-X1).
export { rotationAt } from "@rusuite/ui-shared";

/** Draws the outline of `d` into `svg` at `w` × `h` px. */
function paintShape(svg: SVGSVGElement, d: Drawing, w: number, h: number): void {
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
}

/** Lays out a text area (insets, vertical alignment, colour, flips) for `d`. */
function styleText(el: HTMLElement, d: Drawing): void {
  const t = d.text;
  el.hidden = !t;
  if (!t) return;
  const ins = t.insets ?? { top: 45720, bottom: 45720, left: 91440, right: 91440 };
  el.style.padding = `${ins.top / EMU_PER_PX}px ${ins.right / EMU_PER_PX}px ${ins.bottom / EMU_PER_PX}px ${ins.left / EMU_PER_PX}px`;
  el.style.justifyContent = t.verticalAlign === "center" ? "center" : t.verticalAlign === "bottom" ? "flex-end" : "flex-start";
  el.style.color = d.textColor ? (colorCss(d.textColor) ?? "") : "";
  el.dataset.autofit = t.autofit ?? "none";
  // Text keeps reading direction: a flipped shape's text is not mirrored (Word).
  el.style.transform = [d.flipH ? "scaleX(-1)" : "", d.flipV ? "scaleY(-1)" : ""].join(" ").trim();
}

/** Replaces the content of the nested editor `inner` with `blocks`, keeping the caret by paragraph id and offset. */
function replaceInner(inner: Editor, blocks: Block[]): void {
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
}

const plainText = (blocks: readonly Block[]) =>
  blocks.map((b) => (b.kind === "paragraph" ? (b.value.inlines ?? []).map((i) => (i.kind === "run" ? i.value.text : "")).join("") : "")).join("\n");

/** Groups and drawing canvases hold members. */
const isContainer = (d: Drawing) => d.kind === "group" || d.kind === "canvas";

const transformOf = (d: Drawing) =>
  [d.rotation ? `rotate(${d.rotation}deg)` : "", d.flipH ? "scaleX(-1)" : "", d.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ");

/** The view of one group member (kept across renders, so its nested editor keeps the caret). */
interface MemberView {
  el: HTMLElement;
  svg: SVGSVGElement | null;
  text: HTMLElement | null;
  img: HTMLImageElement | null;
  frame: HTMLElement | null;
  kids: HTMLElement | null;
  inner: Editor | null;
  key: string;
  media: number | null;
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
  const membersEl = document.createElement("span");
  membersEl.className = "drawing-members";
  box.append(membersEl);
  // Handles live in a frame that rotates with the shape (not flipped).
  const frame = document.createElement("span");
  frame.className = "drawing-frame";
  wrap.append(frame);
  const resize = HANDLES.map((h) => {
    const el = document.createElement("span");
    el.className = `image-handle image-handle-${h} drawing-handle`;
    el.dataset.handle = h;
    frame.append(el);
    return el;
  });
  const rotate = document.createElement("span");
  rotate.className = "drawing-rotate";
  rotate.dataset.rotate = "1";
  frame.append(rotate);
  let adjustEls: HTMLElement[] = [];
  let inner: Editor | null = null;
  let innerKey = "";
  let syncing = false;
  let chainHost: HTMLElement | null = null;
  let chainReg: string | null = null;
  const members = new Map<number, MemberView>();

  const size = (d: Drawing) => ({ w: Math.max(1, d.width / EMU_PER_PX), h: Math.max(1, d.height / EMU_PER_PX) });

  const drawShape = (d: Drawing, w = size(d).w, h = size(d).h) => {
    if (d.kind === "group") {
      svg.replaceChildren();
      return;
    }
    paintShape(svg, d, w, h);
  };

  const place = (d: Drawing) => {
    const anchor = d.anchor ?? null;
    wrap.classList.remove("floating", "float-left", "float-right", "both", "block", "behind", "front");
    const { w, h } = size(d);
    const css: string[] = [`width: ${w}px`, `height: ${h}px`];
    if (anchor) {
      const ind = indentAt(view, getPos());
      const page = opts.page?.() ?? null;
      const vpage = anchor.v.relativeTo === "page" || anchor.v.relativeTo === "margin" ? verticalPage(wrap) : null;
      const lineTop = anchor.v.relativeTo === "line" ? lineTopAt(view, getPos(), wrap) : 0;
      const p = floatPlacement(anchor, { width: w, height: h, indentLeft: ind.left, indentRight: ind.right, columnWidth: page?.columnWidth ?? null, page, vpage, lineTop });
      wrap.classList.add("floating", p.mode);
      wrap.dataset.wrap = anchor.wrap;
      css.push(placementStyle(p));
    } else delete wrap.dataset.wrap;
    // Hidden in the Selection Pane: not shown, not printed (Word).
    if (d.hidden) css.push("visibility: hidden");
    wrap.setAttribute("style", css.join("; "));
    box.style.transform = transformOf(d);
    frame.style.transform = d.rotation ? `rotate(${d.rotation}deg)` : "";
    // The resize arrows point along the rotated frame (the handles turn with it).
    resize.forEach((el, i) => (el.style.cursor = resizeCursor(HANDLES[i]!, d.rotation ?? 0)));
  };

  // ----- text (own, or a later box of a chain) -------------------------------------------------
  const follower = (d: Drawing) => d.kind === "textBox" && !!d.chain && d.chain.seq > 0;

  const dropInner = () => {
    if (!inner) return;
    innerEditors.unregister(inner);
    inner.destroy();
    inner = null;
    innerKey = "";
  };

  const syncChain = (d: Drawing) => {
    const reg = d.chain && d.kind === "textBox" ? `${d.chain.id}:${d.chain.seq}:${!!inner}:${!!chainHost}` : null;
    if (reg === chainReg) return;
    chains.unregister(d.id);
    chainReg = reg;
    if (!d.chain || d.kind !== "textBox") return;
    const m: ChainMember = { id: d.id, chain: d.chain, area: textEl, editor: d.chain.seq === 0 ? inner : null, host: chainHost };
    chains.register(m);
  };

  const layoutText = (d: Drawing) => {
    styleText(textEl, d);
    if (!d.text) return;
    if (follower(d)) {
      dropInner();
      if (!chainHost) {
        chainHost = document.createElement("div");
        chainHost.className = "chain-host";
        textEl.replaceChildren(chainHost);
      }
      wrap.dataset.chain = "follower";
      syncChain(d);
      chains.schedule();
      return;
    }
    if (chainHost) {
      chainHost.remove();
      chainHost = null;
    }
    if (d.chain) wrap.dataset.chain = "head";
    else delete wrap.dataset.chain;
    const blocks = d.text.blocks ?? [];
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
      innerKey = key;
      syncing = true;
      try {
        replaceInner(inner, blocks);
      } finally {
        syncing = false;
      }
    }
    if (!opts.inner && !inner) textEl.textContent = plainText(blocks);
    syncChain(d);
    if (d.chain) chains.schedule();
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

  // ----- group members ---------------------------------------------------------------------------
  /** A member's nested editor changed: the group value with the member's new text. */
  const pushMemberText = (id: number, mv: MemberView) => {
    const pos = getPos();
    const path = memberPath(value, id);
    const m = path ? memberAt(value, path) : null;
    if (!mv.inner || pos === undefined || !path || !m?.text) return;
    const blocks = innerBlocks(mv.inner.state.doc);
    const key = blocksKey(blocks);
    if (key === mv.key) return;
    mv.key = key;
    const next = canonDrawing(withMember(value, path, { ...m, text: { ...m.text, blocks } }));
    syncing = true;
    try {
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: next }));
    } finally {
      syncing = false;
    }
  };

  const renderMembers = (container: HTMLElement, d: Drawing, seen: Set<number>) => {
    const els: HTMLElement[] = [];
    for (const m of d.children ?? []) {
      seen.add(m.id);
      let mv = members.get(m.id);
      if (!mv) {
        const el = document.createElement("span");
        el.className = "drawing-member";
        mv = { el, svg: null, text: null, img: null, frame: null, kids: null, inner: null, key: "", media: null };
        members.set(m.id, mv);
      }
      const { el } = mv;
      el.dataset.memberId = String(m.id);
      el.dataset.kind = m.kind ?? "shape";
      el.dataset.preset = m.preset;
      el.title = m.alt ?? "";
      const w = Math.max(1, m.width / EMU_PER_PX);
      const h = Math.max(1, m.height / EMU_PER_PX);
      el.style.left = `${(m.x ?? 0) / EMU_PER_PX}px`;
      el.style.top = `${(m.y ?? 0) / EMU_PER_PX}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transform = transformOf(m);
      el.classList.toggle("member-selected", selectedMemberOf(value.id) === m.id);
      if (m.kind === "group") {
        if (!mv.kids) {
          mv.kids = document.createElement("span");
          mv.kids.className = "drawing-members";
          el.replaceChildren(mv.kids);
        }
        renderMembers(mv.kids, m, seen);
      } else if (m.kind === "picture") {
        if (!mv.img) {
          mv.frame = document.createElement("span");
          mv.frame.className = "picture-frame";
          mv.img = document.createElement("img");
          mv.img.className = "inline-image";
          mv.img.draggable = false;
          mv.frame.append(mv.img);
          el.replaceChildren(mv.frame);
        }
        const f = m.picture?.format ?? null;
        const vis = visibleFraction(f?.crop);
        const c = f?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
        mv.img.width = Math.max(1, Math.round(w / vis.w));
        mv.img.height = Math.max(1, Math.round(h / vis.h));
        mv.img.style.marginLeft = c.left ? `${((-c.left / 100000) * (w / vis.w)).toFixed(1)}px` : "";
        mv.img.style.marginTop = c.top ? `${((-c.top / 100000) * (h / vis.h)).toFixed(1)}px` : "";
        const filter = pictureFilterCss(f);
        mv.img.style.filter = filter ? filter.replace(/^filter: /, "") : "";
        const css = pictureFrameCss(f, w, h);
        const clip = shapeClip(el, f?.geometry, m.width, m.height);
        if (clip) css["clip-path"] = clip;
        mv.frame!.setAttribute("style", [`width: ${w}px`, `height: ${h}px`, ...Object.entries(css).map(([k, v]) => `${k}: ${v}`)].join("; "));
        let bevel = mv.frame!.querySelector<HTMLElement>(".picture-bevel");
        const b = bevelCss(f?.bevel);
        if (b && !bevel) {
          bevel = document.createElement("span");
          bevel.className = "picture-bevel";
          mv.frame!.append(bevel);
        }
        if (bevel) bevel.style.boxShadow = b;
        const media = m.picture?.media ?? null;
        if (media != null && mv.media !== media && opts.resolve) {
          mv.media = media;
          const img = mv.img;
          opts.resolve(media).then(
            (url) => {
              img.src = url;
            },
            () => img.classList.add("missing"),
          );
        }
      } else {
        if (!mv.svg) {
          mv.svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
          mv.svg.setAttribute("class", "drawing-shape");
          mv.svg.setAttribute("aria-hidden", "true");
          mv.svg.setAttribute("preserveAspectRatio", "none");
          mv.text = document.createElement("div");
          mv.text.className = "drawing-text";
          el.replaceChildren(mv.svg, mv.text);
        }
        paintShape(mv.svg, m, w, h);
        styleText(mv.text!, m);
        const blocks = m.text?.blocks ?? [];
        const key = blocksKey(blocks);
        if (m.text && !mv.inner && opts.inner) {
          const host = document.createElement("div");
          mv.text!.replaceChildren(host);
          const ed = opts.inner(host, blocks);
          mv.inner = ed;
          mv.key = key;
          const id = m.id;
          const ref = mv;
          innerEditors.register(ed, () => getPos(), id);
          ed.on("update", ({ transaction }) => {
            if (syncing || !transaction.docChanged) return;
            pushMemberText(id, ref);
          });
          ed.on("focus", () => wrap.classList.add("editing"));
          ed.on("blur", () => wrap.classList.remove("editing"));
        } else if (mv.inner && key !== mv.key && !syncing) {
          mv.key = key;
          syncing = true;
          try {
            replaceInner(mv.inner, blocks);
          } finally {
            syncing = false;
          }
        } else if (!opts.inner && m.text) mv.text!.textContent = plainText(blocks);
      }
      els.push(el);
    }
    container.replaceChildren(...els);
  };

  const drawMembers = (d: Drawing) => {
    membersEl.hidden = !isContainer(d);
    if (!isContainer(d)) return;
    const seen = new Set<number>();
    renderMembers(membersEl, d, seen);
    for (const [id, mv] of members) {
      if (seen.has(id)) continue;
      if (mv.inner) {
        innerEditors.unregister(mv.inner);
        mv.inner.destroy();
      }
      members.delete(id);
    }
  };

  const drawAdjust = (d: Drawing, w: number, h: number) => {
    adjustEls.forEach((e) => e.remove());
    adjustEls = [];
    if (isContainer(d)) return;
    // The handles come with the outline, in the query's (pixel-rounded) box.
    const q = pathQuery(d.preset, d.width, d.height, d.adjust ?? null);
    const outline = outlineFor(d.id, shapePaths.get(q));
    const defs = handlesOf(outline, q.w, q.h);
    if (!defs.length) return;
    const adj = effectiveAdjust(outline?.defaults ?? {}, d.adjust ?? undefined);
    const focused = handleFocusOf(d.id);
    defs.forEach((def, i) => {
      const p = handlePos(def, adj);
      const el = document.createElement("span");
      el.className = "drawing-adjust";
      el.dataset.adjust = String(i);
      if (focused === i) {
        el.dataset.focused = "true";
        el.style.outline = "2px solid #2563eb";
        el.style.outlineOffset = "1px";
      }
      // In the box, which turns and flips with the shape: the handle does too.
      el.style.left = `${(p.x / q.w) * w - 5}px`;
      el.style.top = `${(p.y / q.h) * h - 5}px`;
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
    wrap.title = d.link ? linkTitle(d.link) : (d.alt ?? "");
    wrap.classList.toggle("linked", !!d.link);
    place(d);
    const { w, h } = size(d);
    drawShape(d, w, h);
    layoutText(d);
    drawMembers(d);
    drawAdjust(d, w, h);
  };

  render(value);
  // Page / margin positions follow the print layout's pages (like floating pictures).
  const onLayout = () => {
    const a = value.anchor;
    if (a && (a.v.relativeTo === "page" || a.v.relativeTo === "margin")) place(value);
    if (value.chain) chains.schedule();
  };
  view.dom.addEventListener("rusuite-layout", onLayout);
  const offFocus = onHandleFocus(() => drawAdjust(value, size(value).w, size(value).h));
  const offPaths = shapePaths.subscribe(() => {
    drawShape(value);
    if (isContainer(value)) drawMembers(value);
    drawAdjust(value, size(value).w, size(value).h);
  });

  const commit = (d: Drawing) => {
    const pos = getPos();
    if (pos === undefined) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing(d) });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
  };

  /** Rendered offsets of the wrapper (column / paragraph), as `movedAnchor` takes them. */
  const offsets = () => renderedOffset(wrap, indentAt(view, getPos()).left);

  // ----- resize ------------------------------------------------------------------
  let dragging = false;
  const onResize = (e: PointerEvent) => {
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const z = zoomOf(wrap);
    const { w: w0, h: h0 } = size(value);
    const o = value.anchor ? offsets() : null;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const deg = value.rotation ?? 0;
    let next = { w: Math.round(w0), h: Math.round(h0), dx: 0, dy: 0 };
    dragging = true;
    wrap.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      // Corners keep the proportions only with Shift (shapes, like Word).
      next = rotatedResize(handle, w0, h0, (ev.clientX - x0) / z, (ev.clientY - y0) / z, deg, ev.shiftKey && handle.length === 2);
      wrap.style.width = `${next.w}px`;
      wrap.style.height = `${next.h}px`;
      if (o) wrap.style.translate = `${next.dx}px ${next.dy}px`;
      if (value.kind === "group") drawMembers(scaleGroup(value, Math.round(next.w * EMU_PER_PX), Math.round(next.h * EMU_PER_PX)));
      else paintShape(svg, value, next.w, next.h);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      wrap.classList.remove("resizing");
      wrap.style.translate = "";
      if (next.w === Math.round(w0) && next.h === Math.round(h0)) {
        render(value);
        return;
      }
      const width = Math.round(next.w * EMU_PER_PX);
      const height = Math.round(next.h * EMU_PER_PX);
      let d: Drawing = value.kind === "group" ? scaleGroup(value, width, height) : { ...value, width, height };
      if (o && value.anchor && (next.dx || next.dy)) d = { ...d, anchor: movedAnchor(value.anchor, o.x, o.y, next.dx, next.dy) };
      commit(d);
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
      box.style.transform = transformOf({ ...value, rotation: deg });
      frame.style.transform = `rotate(${deg}deg)`;
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
    const z = zoomOf(wrap);
    // The unrotated layout box: the pointer goes into the shape's own (rotated, flipped) frame.
    const r = wrap.getBoundingClientRect();
    const { w, h } = size(value);
    const frameBox = { x: 0, y: 0, w, h, rotationDeg: value.rotation ?? 0, flipH: !!value.flipH, flipV: !!value.flipV };
    let adj = { ...(value.adjust ?? {}) };
    dragging = true;
    const move = (ev: PointerEvent) => {
      const local = boxToLocal(frameBox, (ev.clientX - r.left) / z, (ev.clientY - r.top) / z);
      adj = { ...(value.adjust ?? {}), ...dragHandle(def, { x: (local.x / w) * def.w, y: (local.y / h) * def.h }) };
      drawShape({ ...value, adjust: adj });
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

  // ----- move (floating), members ----------------------------------------------------------
  /** Guides a move snaps to: the column's left edge, centre and right edge, the paragraph top. */
  const guides = () => {
    const col = opts.page?.()?.columnWidth ?? null;
    return { x: col != null ? [0, col / 2, col] : [0], y: [0] };
  };

  /** The group with its frame fitted to its members (top-level members only), its anchor following the frame's move. */
  const refit = (g: Drawing): Drawing => {
    const kids = g.children ?? [];
    if (!kids.length) return g;
    const b = bounds(kids.map((c) => ({ x: c.x ?? 0, y: c.y ?? 0, w: c.width, h: c.height })));
    if (!b.x && !b.y && b.w === g.width && b.h === g.height) return g;
    const children = kids.map((c) => {
      const out: Drawing = { ...c, x: (c.x ?? 0) - b.x, y: (c.y ?? 0) - b.y };
      if (!out.x) delete out.x;
      if (!out.y) delete out.y;
      return out;
    });
    const out: Drawing = { ...g, children, width: Math.max(1, Math.round(b.w)), height: Math.max(1, Math.round(b.h)) };
    if (g.anchor && (b.x || b.y)) {
      const o = offsets();
      out.anchor = movedAnchor(g.anchor, o.x, o.y, b.x / EMU_PER_PX, b.y / EMU_PER_PX);
    }
    return out;
  };

  const onMemberMove = (e: PointerEvent, id: number) => {
    const path = memberPath(value, id);
    const m = path ? memberAt(value, path) : null;
    const mv = members.get(id);
    if (!path || !m || !mv) return;
    e.preventDefault();
    e.stopPropagation();
    const z = zoomOf(wrap);
    const sx = e.clientX;
    const sy = e.clientY;
    let d = { x: 0, y: 0 };
    dragging = true;
    const move = (ev: PointerEvent) => {
      d = { x: (ev.clientX - sx) / z, y: (ev.clientY - sy) / z };
      mv.el.style.translate = `${d.x}px ${d.y}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      mv.el.style.translate = "";
      if (Math.hypot(d.x, d.y) < 3) return;
      // The member moves inside its parent; a group's frame follows its members (Word), a canvas keeps its own.
      const moved = { ...m, x: Math.round((m.x ?? 0) + d.x * EMU_PER_PX), y: Math.round((m.y ?? 0) + d.y * EMU_PER_PX) };
      const next = withMember(value, path, moved);
      commit(value.kind === "group" ? refit(next) : next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onMove = (e: PointerEvent) => {
    const anchor = value.anchor as Anchor | undefined;
    const target = e.target as HTMLElement;
    if (!wrap.classList.contains("selected") || e.button !== 0 || target.dataset.handle || target.dataset.rotate || target.dataset.adjust) return;
    // A click in the text puts the caret there (the nested editor); the rest of the box drags it.
    if (target.closest(".drawing-text .ProseMirror") || (target.closest(".drawing-text") && wrap.classList.contains("editing"))) return;
    // Groups: a click on a member selects it, a drag of the selected member moves it.
    const memberEl = target.closest<HTMLElement>(".drawing-member");
    if (isContainer(value)) {
      const id = memberEl ? Number(memberEl.dataset.memberId) : null;
      if (id != null && selectedMemberOf(value.id) === id) {
        onMemberMove(e, id);
        return;
      }
      if (id != null) {
        e.preventDefault();
        e.stopPropagation();
        selectMember(view, value.id, id);
        drawMembers(value);
        return;
      }
      if (selectedMemberOf(value.id) != null) {
        selectMember(view, value.id, null);
        drawMembers(value);
      }
    }
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const o = offsets();
    const z = o.zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    const { w, h } = size(value);
    let d = { x: 0, y: 0 };
    dragging = true;
    wrap.classList.add("moving");
    const move = (ev: PointerEvent) => {
      // Alt: fine positioning without snapping (Word).
      const s = snapMove({ x: o.x, y: o.y, w, h }, (ev.clientX - sx) / z, (ev.clientY - sy) / z, guides(), ev.altKey);
      d = { x: s.dx, y: s.dy };
      wrap.style.translate = `${d.x}px ${d.y}px`;
      wrap.dataset.snapped = s.snapped.x != null || s.snapped.y != null ? "1" : "";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragging = false;
      wrap.classList.remove("moving");
      wrap.style.translate = "";
      delete wrap.dataset.snapped;
      if (Math.hypot(d.x, d.y) < 3) return;
      commit({ ...value, anchor: movedAnchor(anchor, o.x, o.y, d.x, d.y) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  wrap.addEventListener("pointerdown", onMove);

  // Shift/Ctrl+click adds the drawing to the selected floating objects (before its text takes the click).
  const onModifierDown = (e: MouseEvent) => {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) || e.button !== 0) return;
    const pos = getPos();
    if (pos === undefined || !toggleObject(view, pos)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  wrap.addEventListener("mousedown", onModifierDown, true);
  const swallow = (e: PointerEvent) => {
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && e.button === 0 && !wrap.classList.contains("selected") && view.state.selection instanceof NodeSelection) e.stopPropagation();
  };
  wrap.addEventListener("pointerdown", swallow, true);

  // A click in a later box of a chain puts the caret into the story there.
  const onFollowerClick = (e: MouseEvent) => {
    if (!follower(value) || !value.chain || !chainHost) return;
    e.preventDefault();
    e.stopPropagation();
    clickInFollower({ id: value.id, chain: value.chain, area: textEl, editor: null, host: chainHost }, e.clientX, e.clientY);
  };
  textEl.addEventListener("click", onFollowerClick);

  // A double click on a shape puts the caret into its text (Word's Edit Text).
  const onDblClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".drawing-text .ProseMirror")) return;
    const memberEl = t.closest<HTMLElement>(".drawing-member");
    const mv = memberEl ? members.get(Number(memberEl.dataset.memberId)) : null;
    const ed = mv?.inner ?? inner;
    if (!ed) return;
    e.preventDefault();
    ed.commands.focus("end");
  };
  wrap.addEventListener("dblclick", onDblClick);

  return {
    dom: wrap,
    update(n) {
      if (n.type !== current.type) return false;
      current = n;
      if (n.attrs.value !== value) render(n.attrs.value as Drawing);
      else if (isContainer(value)) drawMembers(value);
      return true;
    },
    selectNode() {
      wrap.classList.add("selected");
    },
    deselectNode() {
      wrap.classList.remove("selected");
      if (selectedMemberOf(value.id) != null) {
        selectMember(null, value.id, null);
        drawMembers(value);
      }
    },
    stopEvent(e) {
      const t = e.target as HTMLElement | null;
      // The nested editor handles its own keys, input and pointer.
      if (t?.closest?.(".drawing-text")) return true;
      if (t?.dataset?.handle || t?.dataset?.rotate || t?.dataset?.adjust || dragging) return true;
      const own = /^(pointer|mouse|click|dblclick|dragstart)/.test(e.type) && wrap.classList.contains("selected");
      return own && (!!value.anchor || isContainer(value));
    },
    ignoreMutation: () => true,
    destroy() {
      offPaths();
      offFocus();
      view.dom.removeEventListener("rusuite-layout", onLayout);
      resize.forEach((h) => h.removeEventListener("pointerdown", onResize));
      rotate.removeEventListener("pointerdown", onRotate);
      wrap.removeEventListener("pointerdown", onMove);
      wrap.removeEventListener("dblclick", onDblClick);
      wrap.removeEventListener("mousedown", onModifierDown, true);
      wrap.removeEventListener("pointerdown", swallow, true);
      textEl.removeEventListener("click", onFollowerClick);
      chains.unregister(value.id);
      dropInner();
      for (const mv of members.values()) {
        if (!mv.inner) continue;
        innerEditors.unregister(mv.inner);
        mv.inner.destroy();
      }
      members.clear();
    },
  };
}
