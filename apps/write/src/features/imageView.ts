// Node view of an inline image: the picture plus Word's selection handles.
// Dragging a corner handle resizes proportionally (live preview on the
// <img>, one transaction at the end → `SetImageSize`); dragging a side
// handle changes only that dimension. The view takes the editor's zoom into
// account (CSS `zoom` on an ancestor).

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";

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

  const render = (n: PMNode) => {
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

  const onDown = (e: MouseEvent) => {
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
    const move = (ev: MouseEvent) => {
      size = resizeBy(handle, w0, h0, (ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom);
      img.width = size.w;
      img.height = size.h;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
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
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  handles.forEach((h) => h.addEventListener("mousedown", onDown));

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
      return !!(e.target as HTMLElement).dataset?.handle;
    },
    ignoreMutation: () => true,
    destroy() {
      handles.forEach((h) => h.removeEventListener("mousedown", onDown));
    },
  };
}
