// Node view of an inline image: the picture plus Word's selection handles.
// Dragging a corner handle resizes proportionally (live preview on the
// <img>, one transaction at the end → `SetImageSize`); dragging a side
// handle changes only that dimension. The view takes the editor's zoom into
// account (CSS `zoom` on an ancestor).

import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";
import type { Anchor } from "../generated/Anchor";
import type { Crop } from "../generated/Crop";
import type { Indent } from "../generated/Indent";
import type { PictureFormat } from "../generated/PictureFormat";
import type { Hyperlink } from "../generated/Hyperlink";
import { colorCss, linkTitle, pictureFilterCss } from "../sync/schema";
import { pathQuery, rectOutline, shapePaths } from "./drawings/paths";
import { floatPlacement, lineTopAt, movedAnchor, placementStyle, type VerticalPage } from "./floating";
import { bevelCss, cropMaskRects, imageRect, softEdgeCss } from "./pictures";

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
/** The page of the paragraph holding `wrap` in print layout (from the layout the pagination stores on the editor element). */
export function verticalPage(wrap: HTMLElement): VerticalPage | null {
  const editor = wrap.closest(".ProseMirror") as (HTMLElement & { rusuiteLayout?: { sheets: { top: number; height: number; bodyTop: number; bodyBottom: number }[] } }) | null;
  const sheets = editor?.rusuiteLayout?.sheets;
  const frame = wrap.closest(".write-page") as HTMLElement | null;
  const para = wrap.parentElement?.closest("p, h1, h2, h3, h4, h5, h6, li") as HTMLElement | null;
  if (!sheets?.length || !frame || !para) return null;
  const fr = frame.getBoundingClientRect();
  const z = frame.offsetWidth > 0 ? fr.width / frame.offsetWidth || 1 : 1;
  const y = (para.getBoundingClientRect().top - fr.top) / z;
  const s = [...sheets].reverse().find((x) => x.top <= y + 0.5) ?? sheets[0]!;
  return { paraTop: y - s.top, height: s.height, bodyTop: s.bodyTop - s.top, bodyBottom: s.bodyBottom - s.top };
}

/** Crop handle positions (Word's black bars on the sides and corners). */
export const CROP_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type CropHandle = (typeof CROP_HANDLES)[number];

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
const MIN_VISIBLE = 1000; // 1 % of the picture stays

/**
 * The crop after dragging crop handle `h` by (`dx`, `dy`) px on a picture
 * whose whole image is `iw` × `ih` px (values in 1/1000 %, as `a:srcRect`;
 * at least 1 % stays visible).
 */
export function cropBy(crop: Crop, h: CropHandle, iw: number, ih: number, dx: number, dy: number): Crop {
  const out = { ...crop };
  const fx = Math.round((dx / Math.max(1, iw)) * 100000);
  const fy = Math.round((dy / Math.max(1, ih)) * 100000);
  if (h.includes("w")) out.left = Math.min(100000 - MIN_VISIBLE - out.right, crop.left + fx);
  if (h.includes("e")) out.right = Math.min(100000 - MIN_VISIBLE - out.left, crop.right - fx);
  if (h.includes("n")) out.top = Math.min(100000 - MIN_VISIBLE - out.bottom, crop.top + fy);
  if (h.includes("s")) out.bottom = Math.min(100000 - MIN_VISIBLE - out.top, crop.bottom - fy);
  return out;
}

/** The visible fraction of the image width / height under `crop`. */
export function visibleFraction(crop: Crop | null | undefined): { w: number; h: number } {
  const c = crop ?? NO_CROP;
  return { w: Math.max(0.01, 1 - (c.left + c.right) / 100000), h: Math.max(0.01, 1 - (c.top + c.bottom) / 100000) };
}

/** The displayed size (EMU) after a crop change: the image keeps its scale, the box follows the visible part (Word). */
export function croppedSize(width: number, height: number, from: Crop | null | undefined, to: Crop): { width: number; height: number } {
  const a = visibleFraction(from);
  const b = visibleFraction(to);
  return { width: Math.max(1, Math.round((width / a.w) * b.w)), height: Math.max(1, Math.round((height / a.h) * b.h)) };
}

/** CSS of a picture's frame: border (Picture Border), shadow, outline shape (rounded corners / oval). */
export function pictureFrameCss(f: PictureFormat | null | undefined, w: number, h: number): Record<string, string> {
  const css: Record<string, string> = {};
  if (!f) return css;
  const b = f.border;
  if (b && b.fill.kind === "solid") {
    const px = Math.max(1, b.width / 9525);
    const style = b.dash === "dot" || b.dash === "squareDot" ? "dotted" : b.dash && b.dash !== "solid" ? "dashed" : "solid";
    css.outline = `${px.toFixed(1)}px ${style} ${colorCss(b.fill.value) ?? "#000"}`;
    css["outline-offset"] = `${(-px / 2).toFixed(1)}px`;
  }
  if (f.shadow) css["box-shadow"] = "2.8px 2.8px 5px rgba(0, 0, 0, 0.4)";
  Object.assign(css, softEdgeCss(f, w, h));
  if (f.geometry === "ellipse") css["border-radius"] = "50%";
  else if (f.geometry === "roundRect") css["border-radius"] = `${(Math.min(w, h) * 0.16667).toFixed(1)}px`;
  else if (f.geometry === "snip1Rect" || f.geometry === "round1Rect") css["border-top-right-radius"] = `${(Math.min(w, h) * 0.16667).toFixed(1)}px`;
  return css;
}

/** Outline shapes drawn with CSS (`border-radius`); the others are clipped with their preset outline. */
export const CSS_SHAPES = new Set(["rect", "ellipse", "roundRect", "snip1Rect", "round1Rect"]);

let clipIds = 0;

/**
 * Crop to Shape with any preset: an SVG `clipPath` (the core's preset
 * outline, scaled to the frame with `objectBoundingBox` units) in `holder`;
 * returns the CSS `clip-path` value, or "" for CSS-drawn shapes.
 */
export function shapeClip(holder: HTMLElement, preset: string | null | undefined, wEmu: number, hEmu: number): string {
  let svg = holder.querySelector<SVGSVGElement>(":scope > svg.picture-clip");
  if (!preset || CSS_SHAPES.has(preset)) {
    svg?.remove();
    return "";
  }
  const NS = "http://www.w3.org/2000/svg";
  if (!svg) {
    svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("class", "picture-clip");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    const cp = document.createElementNS(NS, "clipPath");
    cp.id = `rs-picture-clip-${++clipIds}`;
    cp.setAttribute("clipPathUnits", "objectBoundingBox");
    svg.append(cp);
    holder.append(svg);
  }
  const cp = svg.firstElementChild as SVGClipPathElement;
  const q = pathQuery(preset, wEmu, hEmu);
  const outline = shapePaths.get(q) ?? rectOutline(q);
  cp.replaceChildren(
    ...outline.paths
      .filter((p) => p.fill)
      .map((p) => {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", p.d);
        path.setAttribute("transform", `scale(${1 / q.w} ${1 / q.h})`);
        return path;
      }),
  );
  return `url(#${cp.id})`;
}

/** Asks the picture at `pos` to enter (or leave) crop mode (Picture Format › Crop). */
export function toggleCropMode(view: EditorView, pos: number, on?: boolean): boolean {
  const dom = view.nodeDOM(pos) as HTMLElement | null;
  if (!dom?.classList?.contains("inline-image-wrap")) return false;
  dom.dispatchEvent(new CustomEvent("rusuite-crop", { detail: { on } }));
  return true;
}

export function imageNodeView(node: PMNode, view: EditorView, getPos: () => number | undefined, opts: ImageViewOptions): NodeView {
  let current = node;
  const wrap = document.createElement("span");
  wrap.className = "inline-image-wrap";
  const frame = document.createElement("span");
  frame.className = "picture-frame";
  const img = document.createElement("img");
  img.className = "inline-image";
  img.draggable = false;
  frame.append(img);
  wrap.append(frame);
  const bevel = document.createElement("span");
  bevel.className = "picture-bevel";
  frame.append(bevel);
  const cropWindow = document.createElement("span");
  cropWindow.className = "crop-window";
  wrap.append(cropWindow);
  // Crop mode: the image outside the crop window is dimmed (Word).
  const masks = [0, 1, 2, 3].map(() => {
    const el = document.createElement("span");
    el.className = "crop-mask";
    wrap.append(el);
    return el;
  });
  const cropHandles = CROP_HANDLES.map((h) => {
    const el = document.createElement("span");
    el.className = `crop-handle crop-handle-${h}`;
    el.dataset.crop = h;
    wrap.append(el);
    return el;
  });
  let cropping: Crop | null = null;
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
    wrap.classList.remove("floating", "float-left", "float-right", "both", "block", "behind", "front");
    if (!anchor) {
      wrap.removeAttribute("style");
      delete wrap.dataset.wrap;
      return;
    }
    const ind = indentAt(view, getPos());
    const page = opts.page?.() ?? null;
    const vpage = anchor.v.relativeTo === "page" || anchor.v.relativeTo === "margin" ? verticalPage(wrap) : null;
    const p = floatPlacement(anchor, {
      width: n.attrs.width / opts.emuPerPx,
      height: n.attrs.height / opts.emuPerPx,
      indentLeft: ind.left,
      indentRight: ind.right,
      columnWidth: page?.columnWidth ?? null,
      page,
      vpage,
      lineTop: anchor.v.relativeTo === "line" ? lineTopAt(view, getPos(), wrap) : 0,
    });
    wrap.classList.add("floating", p.mode);
    wrap.dataset.wrap = anchor.wrap;
    wrap.setAttribute("style", placementStyle(p));
  };

  /** Lays out frame and image for a displayed size of `w` × `h` px (the crop window) and `crop`. */
  const size = (w: number, h: number, crop: Crop | null) => {
    const f = current.attrs.format as PictureFormat | null;
    const vis = visibleFraction(crop);
    const iw = w / vis.w;
    const ih = h / vis.h;
    img.width = Math.max(1, Math.round(iw));
    img.height = Math.max(1, Math.round(ih));
    const c = crop ?? NO_CROP;
    img.style.marginLeft = c.left ? `${((-c.left / 100000) * iw).toFixed(1)}px` : "";
    img.style.marginTop = c.top ? `${((-c.top / 100000) * ih).toFixed(1)}px` : "";
    const css = cropping ? {} : pictureFrameCss(f, w, h);
    const clip = cropping ? "" : shapeClip(wrap, f?.geometry, Math.round(w * opts.emuPerPx), Math.round(h * opts.emuPerPx));
    if (clip) css["clip-path"] = clip;
    frame.setAttribute("style", [`width: ${Math.round(w)}px`, `height: ${Math.round(h)}px`, ...Object.entries(css).map(([k, v]) => `${k}: ${v}`)].join("; "));
    const b = cropping ? "" : bevelCss(f?.bevel);
    bevel.style.boxShadow = b;
    bevel.hidden = !b;
    if (css["border-radius"]) bevel.style.borderRadius = css["border-radius"];
    else bevel.style.removeProperty("border-radius");
    // The dimmed mask around the crop window.
    const rects = cropping ? cropMaskRects(imageRect(w, h, crop), w, h) : [];
    masks.forEach((m, i) => {
      const r = rects[i];
      m.hidden = !r;
      if (!r) return;
      m.style.left = `${r.x.toFixed(1)}px`;
      m.style.top = `${r.y.toFixed(1)}px`;
      m.style.width = `${r.w.toFixed(1)}px`;
      m.style.height = `${r.h.toFixed(1)}px`;
    });
    const filter = pictureFilterCss(f);
    img.style.filter = filter ? filter.replace(/^filter: /, "") : "";
    cropWindow.style.left = "0px";
    cropWindow.style.top = "0px";
    cropWindow.style.width = `${w}px`;
    cropWindow.style.height = `${h}px`;
    // Crop handles on the window's edges.
    const at: Record<CropHandle, [number, number]> = {
      nw: [0, 0], n: [w / 2 - 8, 0], ne: [w - 10, 0], e: [w - 4, h / 2 - 8], se: [w - 10, h - 10], s: [w / 2 - 8, h - 4], sw: [0, h - 10], w: [0, h / 2 - 8],
    };
    cropHandles.forEach((el) => {
      const [x, y] = at[el.dataset.crop as CropHandle];
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    });
  };

  const render = (n: PMNode) => {
    place(n);
    img.dataset.mediaId = String(n.attrs.mediaId);
    img.alt = n.attrs.decorative ? "" : (n.attrs.alt ?? "");
    // A linked picture shows its ScreenTip (Word); otherwise its description.
    img.title = n.attrs.link ? linkTitle(n.attrs.link as Hyperlink) : (n.attrs.alt ?? "");
    wrap.classList.toggle("linked", !!n.attrs.link);
    const f = n.attrs.format as PictureFormat | null;
    size(Math.max(1, Math.round(n.attrs.width / opts.emuPerPx)), Math.max(1, Math.round(n.attrs.height / opts.emuPerPx)), cropping ?? f?.crop ?? null);
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
  // Page / margin positions follow the print layout's pages.
  const onLayout = () => {
    const a = current.attrs.anchor as Anchor | null;
    if (a && (a.v.relativeTo === "page" || a.v.relativeTo === "margin")) place(current);
  };
  view.dom.addEventListener("rusuite-layout", onLayout);

  // Drag a selected floating picture to move it (new offsets from the column and the paragraph).
  let moving = false;
  const onMoveStart = (e: PointerEvent) => {
    const anchor = current.attrs.anchor as Anchor | null;
    if (!anchor || !wrap.classList.contains("selected") || e.button !== 0 || (e.target as HTMLElement).dataset.handle) return;
    e.preventDefault();
    e.stopPropagation();
    const para = wrap.closest("p, h1, h2, h3, h4, h5, h6") as HTMLElement | null;
    const zoom = frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth || 1 : 1;
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
      frame.style.transform = `translate(${d.x}px, ${d.y}px)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      moving = false;
      wrap.classList.remove("moving");
      frame.style.transform = "";
      const pos = getPos();
      if (pos === undefined || Math.hypot(d.x, d.y) < 3) return;
      const next = movedAnchor(current.attrs.anchor as Anchor, x, y, d.x, d.y);
      // The picture stays selected after the move (W-12).
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, anchor: next });
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
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
    const zoom = frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth || 1 : 1;
    const w0 = Math.max(1, Math.round(current.attrs.width / opts.emuPerPx));
    const h0 = Math.max(1, Math.round(current.attrs.height / opts.emuPerPx));
    const crop0 = (current.attrs.format as PictureFormat | null)?.crop ?? null;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let next = { w: w0, h: h0 };
    wrap.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      next = resizeBy(handle, w0, h0, (ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom);
      size(next.w, next.h, crop0);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      wrap.classList.remove("resizing");
      const pos = getPos();
      if (pos === undefined || (next.w === w0 && next.h === h0)) {
        render(current);
        return;
      }
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...current.attrs,
        width: Math.round(next.w * opts.emuPerPx),
        height: Math.round(next.h * opts.emuPerPx),
      });
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  handles.forEach((h) => h.addEventListener("pointerdown", onDown));

  // ----- crop mode (Picture Format › Crop) --------------------------------------------
  const finishCrop = () => {
    const c = cropping;
    if (!c) return;
    cropping = null;
    wrap.classList.remove("cropping");
    const f = (current.attrs.format as PictureFormat | null) ?? {};
    const from = f.crop ?? null;
    const same = JSON.stringify(from ?? NO_CROP) === JSON.stringify(c);
    const pos = getPos();
    if (same || pos === undefined) {
      render(current);
      return;
    }
    const sz = croppedSize(current.attrs.width, current.attrs.height, from, c);
    const format: PictureFormat = { ...f };
    if (c.left || c.top || c.right || c.bottom) format.crop = c;
    else delete format.crop;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...sz, format: Object.keys(format).length ? format : null });
    // Still selected (Enter / Escape): it stays so; a click elsewhere keeps its caret.
    const sel = view.state.selection;
    if (sel instanceof NodeSelection && sel.from === pos) tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
  };
  const onCropEvent = (e: Event) => {
    const on = (e as CustomEvent<{ on?: boolean }>).detail?.on ?? !cropping;
    if (!on) {
      finishCrop();
      return;
    }
    cropping = { ...NO_CROP, ...(((current.attrs.format as PictureFormat | null)?.crop) ?? {}) };
    wrap.classList.add("cropping");
    render(current);
  };
  wrap.addEventListener("rusuite-crop", onCropEvent);
  const onCropDrag = (e: PointerEvent) => {
    const h = (e.target as HTMLElement).dataset.crop as CropHandle | undefined;
    if (!h || !cropping || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const zoom = frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth || 1 : 1;
    const start = { ...cropping };
    const w0 = current.attrs.width / opts.emuPerPx;
    const h0 = current.attrs.height / opts.emuPerPx;
    const vis = visibleFraction((current.attrs.format as PictureFormat | null)?.crop);
    const iw = w0 / vis.w;
    const ih = h0 / vis.h;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      cropping = cropBy(start, h, iw, ih, (ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom);
      const v = visibleFraction(cropping);
      size(iw * v.w, ih * v.h, cropping);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  cropHandles.forEach((h) => h.addEventListener("pointerdown", onCropDrag));
  const onCropKey = (e: KeyboardEvent) => {
    if (cropping && (e.key === "Enter" || e.key === "Escape")) {
      // Before the editor's own keys (Enter must not replace the selected picture).
      e.preventDefault();
      e.stopPropagation();
      finishCrop();
    }
  };
  view.dom.addEventListener("keydown", onCropKey, true);

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
      // Clicking elsewhere ends crop mode (Word).
      finishCrop();
    },
    stopEvent(e) {
      // A selected floating picture handles its own pointer (moving); the editor must not re-place the caret.
      const own = /^(pointer|mouse|click|dblclick|dragstart)/.test(e.type) && !!current.attrs.anchor && wrap.classList.contains("selected");
      const t = e.target as HTMLElement;
      return !!t.dataset?.handle || !!t.dataset?.crop || !!cropping || moving || own;
    },
    ignoreMutation: () => true,
    destroy() {
      view.dom.removeEventListener("rusuite-layout", onLayout);
      view.dom.removeEventListener("keydown", onCropKey, true);
      wrap.removeEventListener("rusuite-crop", onCropEvent);
      cropHandles.forEach((h) => h.removeEventListener("pointerdown", onCropDrag));
      handles.forEach((h) => h.removeEventListener("pointerdown", onDown));
      img.removeEventListener("pointerdown", onMoveStart);
    },
  };
}
