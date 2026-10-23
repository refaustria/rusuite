// Long-press = right-click for touch (P10-M2). Android's Chrome fires `contextmenu` after a long press itself;
// iOS (Safari, WKWebView) does not. A touch pointer held still for `LONG_PRESS_MS` dispatches a synthetic
// `contextmenu` at the touch point on the element under it, so every app context menu (grid, slide, editor, lists)
// opens through its existing `onContextMenu`; a native one that follows the same press is swallowed (no second menu).

/** How long (ms) a touch must be held. */
export const LONG_PRESS_MS = 500;
/** How long (ms) after the lift of an answered press its compatibility mouse events are still swallowed. */
export const QUIET_MS = 250;
/** How far (px) the finger may move during the hold. */
export const LONG_PRESS_SLOP = 10;

/** Installs the long-press handling on `target` (default `window`); returns the uninstall function. */
export function installLongPress(target: Window = window): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number; id: number; el: Element } | null = null;
  /** Until then a native contextmenu belongs to a press we already answered. */
  let swallowUntil = 0;
  let nativeSeen = false;
  /** The answered press is still down (or just ended): its compatibility mouse events must not reach the new menu. */
  let answered = false;
  let quietUntil = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    origin = null;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary) return cancel();
    cancel();
    nativeSeen = false;
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    origin = { x: e.clientX, y: e.clientY, id: e.pointerId, el };
    timer = setTimeout(() => {
      const o = origin;
      cancel();
      if (!o || nativeSeen || !o.el.isConnected) return;
      swallowUntil = Date.now() + 1500;
      answered = true;
      o.el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, clientX: o.x, clientY: o.y, button: 2, buttons: 0 }));
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent) => {
    if (!origin || e.pointerId !== origin.id) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP) cancel();
  };
  const up = (e: PointerEvent) => {
    if (origin && e.pointerId === origin.id) cancel();
    if (answered && e.pointerType === "touch") {
      answered = false;
      quietUntil = Date.now() + QUIET_MS;
    }
  };
  const mouse = (e: MouseEvent) => {
    if (!e.isTrusted || !(answered || Date.now() < quietUntil)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const context = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    if (Date.now() < swallowUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowUntil = 0;
      return;
    }
    // The browser answered the press itself (Android): no synthetic one.
    if (origin) nativeSeen = true;
  };
  target.addEventListener("pointerdown", down, true);
  target.addEventListener("pointermove", move, true);
  target.addEventListener("pointerup", up, true);
  target.addEventListener("pointercancel", up, true);
  target.addEventListener("contextmenu", context, true);
  for (const type of ["mousedown", "mouseup", "click"] as const) target.addEventListener(type, mouse, true);
  return () => {
    for (const type of ["mousedown", "mouseup", "click"] as const) target.removeEventListener(type, mouse, true);
    cancel();
    target.removeEventListener("pointerdown", down, true);
    target.removeEventListener("pointermove", move, true);
    target.removeEventListener("pointerup", up, true);
    target.removeEventListener("pointercancel", up, true);
    target.removeEventListener("contextmenu", context, true);
  };
}
