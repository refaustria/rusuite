// Node view of an inline image: the picture plus Word's selection handles.
// Dragging a corner handle resizes proportionally (live preview on the
// <img>, one transaction at the end → `SetImageSize`); dragging a side
// handle changes only that dimension. The view takes the editor's zoom into
// account (CSS `zoom` on an ancestor).

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import type { Anchor } from "../generated/Anchor";
import type { Indent } from "../generated/Indent";
import { floatPlacement, movedAnchor, placementStyle } from "./floating";

/** Handle positions: corners keep the aspect ratio. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

const MIN_PX = 8;

/**
 * New size (px) after dragging `handle` by (`dx`, `dy`) px from `w`×`h`.
 * Corners keep the aspect ratio (the larger relative change wins), sides
 * change one dimension.
 */
export function resizeBy(handle: Handle, w: number, h: number, dx: number, dy: number): { w: number; h: number } {
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  let nw = w + sx * dx;
  let nh = h + sy * dy;
  if (sx !== 0 && sy !== 0) {
    const ratio = h / w;
    const fx = nw / w;
    const fy = nh / h;
    const f = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
    nw = w * f;
    nh = nw * ratio;
    if (nw < MIN_PX || nh < MIN_PX) {
      const g = Math.max(MIN_PX / w, MIN_PX / h);
      nw = w * g;
      nh = h * g;
    }
    return { w: Math.round(nw), h: Math.round(nh) };
  }
  return { w: Math.round(Math.max(MIN_PX, nw)), h: Math.round(Math.max(MIN_PX, nh)) };
}

export interface ImageViewOptions {
  emuPerPx: number;
  resolve: ((id: number) => Promise<string>) | null;
  /** Page width and left margin in CSS px (page-relative floating positions). */
  page?: (() => { width: number; marginLeft: number; columnWidth: number } | null) | null;
}

const TWIPS_PER_PX = 15;

/** The left/right indent (px) of the paragraph holding the image at `pos`. */
function indentAt(view: EditorView, pos: number | undefined): { left: number; right: number } {
  if (pos === undefined) return { left: 0, right: 0 };
  try {
    const ind = view.state.doc.resolve(pos).parent.attrs.indent as Indent | null;
    return { left: (ind?.left ?? 0) / TWIPS_PER_PX, right: (ind?.right ?? 0) / TWIPS_PER_PX };
  } catch {
    return { left: 0, right: 0 };
  }
}

/** The image node view (handles shown while the node is selected). */
export function imageNodeView(node: PMNode, view: EditorView, getPos: () => number | undefined, opts: ImageViewOptions): NodeView {
  let current = node;
  const wrap = document.createElement("span");
  wrap.className = "inline-image-wrap";
  const img = document.createElement("img");
  img.className = "inline-image";
  img.draggable = false;
  wrap.append(img);
  const handles = HANDLES.map((h) => {
    const el = document.createElement("span");
    el.className = `image-handle image-handle-${h}`;
    el.dataset.handle = h;
    wrap.append(el);
    return el;
  });
  let media: number | null = null;

  const place = (n: PMNode) => {
    const anchor = n.attrs.anchor as Anchor | null;
    wrap.classList.remove("floating", "float-left", "float-right", "block", "behind", "front");
    if (!anchor) {
      wrap.removeAttribute("style");
      delete wrap.dataset.wrap;
      return;
    }
    const ind = indentAt(view, getPos());
    const page = opts.page?.() ?? null;
    const p = floatPlacement(anchor, {
      width: n.attrs.width / opts.emuPerPx,
      height: n.attrs.height / opts.emuPerPx,
      indentLeft: ind.left,
      indentRight: ind.right,
      columnWidth: page?.columnWidth ?? null,
      page,
    });
    wrap.classList.add("floating", p.mode);
    wrap.dataset.wrap = anchor.wrap;
    wrap.setAttribute("style", placementStyle(p));
  };

  const render = (n: PMNode) => {
    place(n);
    img.dataset.mediaId = String(n.attrs.mediaId);
    img.alt = n.attrs.alt ?? "";
    img.title = n.attrs.alt ?? "";
    img.width = Math.max(1, Math.round(n.attrs.width / opts.emuPerPx));
    img.height = Math.max(1, Math.round(n.attrs.height / opts.emuPerPx));
    if (media !== n.attrs.mediaId) {
      media = n.attrs.mediaId;
      img.classList.remove("missing");
      if (opts.resolve && media != null) {
        const id = media;
        opts.resolve(id).then(
          (url) => {
            if (media === id) img.src = url;
          },
          () => img.classList.add("missing"),
        );
      }
    }
  };
  render(node);

  // Drag a selected floating picture to move it (new offsets from the column and the paragraph).
  let moving = false;
  const onMoveStart = (e: PointerEvent) => {
    const anchor = current.attrs.anchor as Anchor | null;
    if (!anchor || !wrap.classList.contains("selected") || e.button !== 0 || (e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    const para = wrap.closest("p, h1, h2, h3, h4, h5, h6") as HTMLElement | null;
    const zoom = img.offsetWidth ? img.getBoundingClientRect().width / img.offsetWidth || 1 : 1;
    const ind = indentAt(view, getPos());
    const r0 = wrap.getBoundingClientRect();
    const p0 = para?.getBoundingClientRect() ?? r0;
    const x = (r0.left - p0.left) / zoom + ind.left;
    const y = (r0.top - p0.top) / zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    let d = { x: 0, y: 0 };
    moving = true;
    wrap.classList.add("moving");
    const move = (ev: PointerEvent) => {
      d = { x: (ev.clientX - sx) / zoom, y: (ev.clientY - sy) / zoom };
      img.style.transform = `translate(${d.x}px, ${d.y}px)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      moving = false;
      wrap.classList.remove("moving");
      img.style.transform = "";
      const pos = getPos();
      if (pos === undefined || Math.hypot(d.x, d.y) < 3) return;
      const next = movedAnchor(current.attrs.anchor as Anchor, x, y, d.x, d.y);
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, anchor: next }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  img.addEventListener("pointerdown", onMoveStart);

  const onDown = (e: PointerEvent) => {
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const zoom = img.offsetWidth ? img.getBoundingClientRect().width / img.offsetWidth || 1 : 1;
    const w0 = img.width;
    const h0 = img.height;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let size = { w: w0, h: h0 };
    wrap.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      size = resizeBy(handle, w0, h0, (ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom);
      img.width = size.w;
      img.height = size.h;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      wrap.classList.remove("resizing");
      const pos = getPos();
      if (pos === undefined || (size.w === w0 && size.h === h0)) {
        render(current);
        return;
      }
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...current.attrs,
        width: Math.round(size.w * opts.emuPerPx),
        height: Math.round(size.h * opts.emuPerPx),
      });
      view.dispatch(tr);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  handles.forEach((h) => h.addEventListener("pointerdown", onDown));

  return {
    dom: wrap,
    update(n) {
      if (n.type !== current.type) return false;
      current = n;
      render(n);
      return true;
    },
    selectNode() {
      wrap.classList.add("selected");
    },
    deselectNode() {
      wrap.classList.remove("selected");
    },
    stopEvent(e) {
      // A selected floating picture handles its own pointer (moving); the editor must not re-place the caret.
      const own = /^(pointer|mouse|click|dblclick|dragstart)/.test(e.type) && !!current.attrs.anchor && wrap.classList.contains("selected");
      return !!(e.target as HTMLElement).dataset?.handle || moving || own;
    },
    ignoreMutation: () => true,
    destroy() {
      handles.forEach((h) => h.removeEventListener("pointerdown", onDown));
      img.removeEventListener("pointerdown", onMoveStart);
    },
  };
}
