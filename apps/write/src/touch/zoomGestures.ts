// Touch zoom of the Write page (P10-M4): fit-width on phones, pinch and double-tap.
//
// The zoom is the app's existing zoom (CSS `zoom` on `.write-zoom`, which keeps ProseMirror's hit testing and the
// caret right). While two fingers pinch, the page is only previewed with a transform (no re-layout per frame); the
// new zoom is committed when a finger lifts, and the point between the fingers stays where it was.

/** Room (CSS px) left beside the page at fit-width: 8 px on each side. */
export const FIT_MARGIN_PX = 16;
/** The largest zoom a pinch reaches. */
export const MAX_TOUCH_ZOOM = 2;
/** The smallest zoom a pinch reaches without fit-width (tablets: the ribbon's smallest level). */
export const MIN_TOUCH_ZOOM = 0.5;
/** The band between pages on compact (CSS px on the screen, at any zoom). */
export const COMPACT_GAP_PX = 8;
/** Two taps closer than this (ms, px) are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 30;
/** A tap moves less than this (px). */
const TAP_SLOP = 10;

/** The zoom at which a page `pageWidth` px wide fills `available` px less the fit margin (never above 1). */
export function fitWidthZoom(available: number, pageWidth: number): number {
  if (!(available > 0) || !(pageWidth > 0)) return 1;
  return Math.min(1, Math.max(0.1, Math.floor(((available - FIT_MARGIN_PX) / pageWidth) * 1000) / 1000));
}

export function clampZoom(z: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, z));
}

/** The page-gap height in layout px that shows as `screenPx` on the screen at `zoom`. */
export function gapForZoom(screenPx: number, zoom: number): number {
  return Math.max(2, Math.round(screenPx / (zoom > 0 ? zoom : 1)));
}

/** A viewport point to keep in place across a zoom change: where it is and where it was in the zoomed content. */
export interface ZoomAnchor {
  clientX: number;
  clientY: number;
  /** The point in the zoomed element's own (unzoomed) coordinates. */
  localX: number;
  localY: number;
}

/** The anchor for the viewport point (x, y) over `zoomEl` at `zoom`. */
export function anchorAt(zoomEl: HTMLElement, zoom: number, x: number, y: number): ZoomAnchor {
  const r = zoomEl.getBoundingClientRect();
  return { clientX: x, clientY: y, localX: (x - r.left) / zoom, localY: (y - r.top) / zoom };
}

/** After the zoom changed to `zoom`: scrolls `scrollEl` so the anchor's point is back under its viewport point. */
export function restoreAnchor(scrollEl: HTMLElement, zoomEl: HTMLElement, zoom: number, a: ZoomAnchor): void {
  const r = zoomEl.getBoundingClientRect();
  scrollEl.scrollLeft += r.left + a.localX * zoom - a.clientX;
  scrollEl.scrollTop += r.top + a.localY * zoom - a.clientY;
}

export interface ZoomGestureOptions {
  /** The zoom now. */
  zoom: () => number;
  /** The pinch range now. */
  range: () => { min: number; max: number };
  /** The element the preview transform goes on (`.write-zoom`). */
  zoomEl: () => HTMLElement | null;
  /** The new zoom after a pinch, with the point to keep in place. */
  onPinch: (zoom: number, anchor: ZoomAnchor) => void;
  /** A double tap (with a finger) at the point on `target`; return true when handled. */
  onDoubleTap?: (x: number, y: number, target: Element) => boolean;
}

const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/** Installs pinch and double tap on `scrollEl` (touch events); returns the uninstall function. */
export function installZoomGestures(scrollEl: HTMLElement, o: ZoomGestureOptions): () => void {
  let pinch: { d0: number; z0: number; anchor: ZoomAnchor; scale: number; el: HTMLElement } | null = null;
  let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
  let lastTap: { x: number; y: number; t: number } | null = null;

  const endPreview = () => {
    if (!pinch) return;
    pinch.el.style.transform = "";
    pinch.el.style.transformOrigin = "";
    pinch.el.style.willChange = "";
  };
  const start = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const el = o.zoomEl();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      tap = null;
      lastTap = null;
      if (!el) return;
      const z0 = o.zoom();
      const anchor = anchorAt(el, z0, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch = { d0: Math.max(1, dist(a, b)), z0, anchor, scale: 1, el };
      el.style.transformOrigin = `${anchor.localX}px ${anchor.localY}px`;
      el.style.willChange = "transform";
      return;
    }
    if (e.touches.length === 1) {
      const p = e.touches[0]!;
      tap = { x: p.clientX, y: p.clientY, t: Date.now(), moved: false };
    } else tap = null;
  };
  const move = (e: TouchEvent) => {
    if (pinch && e.touches.length >= 2) {
      if (e.cancelable) e.preventDefault();
      const { min, max } = o.range();
      const z = clampZoom((pinch.z0 * dist(e.touches[0]!, e.touches[1]!)) / pinch.d0, min, max);
      pinch.scale = z / pinch.z0;
      pinch.el.style.transform = `scale(${pinch.scale})`;
      return;
    }
    const p = e.touches[0];
    if (tap && p && Math.hypot(p.clientX - tap.x, p.clientY - tap.y) > TAP_SLOP) tap.moved = true;
  };
  const end = (e: TouchEvent) => {
    if (pinch) {
      if (e.touches.length >= 2) return;
      const p = pinch;
      endPreview();
      pinch = null;
      const z = p.z0 * p.scale;
      if (Math.abs(z - p.z0) > 0.005) o.onPinch(z, p.anchor);
      return;
    }
    const t = tap;
    tap = null;
    if (!t || t.moved || e.touches.length > 0 || Date.now() - t.t > DOUBLE_TAP_MS) {
      lastTap = null;
      return;
    }
    const now = Date.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < DOUBLE_TAP_SLOP) {
      lastTap = null;
      const target = e.target instanceof Element ? e.target : scrollEl;
      if (o.onDoubleTap?.(t.x, t.y, target) && e.cancelable) e.preventDefault();
      return;
    }
    lastTap = { x: t.x, y: t.y, t: now };
  };
  const cancel = () => {
    endPreview();
    pinch = null;
    tap = null;
  };
  scrollEl.addEventListener("touchstart", start, { passive: true });
  scrollEl.addEventListener("touchmove", move, { passive: false });
  scrollEl.addEventListener("touchend", end, { passive: false });
  scrollEl.addEventListener("touchcancel", cancel);
  return () => {
    cancel();
    scrollEl.removeEventListener("touchstart", start);
    scrollEl.removeEventListener("touchmove", move);
    scrollEl.removeEventListener("touchend", end);
    scrollEl.removeEventListener("touchcancel", cancel);
  };
}
