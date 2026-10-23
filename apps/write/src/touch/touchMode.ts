// Touch mode (P10-M4): whether the last pointer that touched the app was a finger (or a pen). It decides the touch
// affordances of Write – the selection handles and the floating selection bar, 44 px picture handles and column
// border strips, the table gutters – on phones (compact) and on touch tablets with the ribbon alike. A mouse click
// switches back. Starts from `(any-pointer: coarse)` without a mouse (`(pointer: fine)`), so a phone is in touch
// mode before the first tap.
//
// The state is mirrored as `data-touch` on Write's root element (`[data-rs-app]`), where the CSS reads it.

type Listener = () => void;

let touch = initial();
let lastTouchAt = 0;
const listeners = new Set<Listener>();

function initial(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(any-pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
}

/** Whether Write is in touch mode now. */
export function isTouchMode(): boolean {
  return touch;
}

/** When (ms, `Date.now()`) the last touch pointer went down (0: never). */
export function lastTouchDown(): number {
  return lastTouchAt;
}

/** Sets the mode (tests; the pointer tracking calls it too). */
export function setTouchMode(on: boolean): void {
  if (on === touch) return;
  touch = on;
  for (const fn of listeners) fn();
}

/** Subscribes to mode changes (`useSyncExternalStore`). */
export function subscribeTouchMode(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tracks the pointer type on `win` and mirrors the mode on `root`; returns the uninstall function. */
export function installTouchMode(root: HTMLElement, win: Window = window): () => void {
  const sync = () => root.toggleAttribute("data-touch", touch);
  const down = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      lastTouchAt = Date.now();
      setTouchMode(true);
    } else if (e.pointerType === "mouse") setTouchMode(false);
  };
  // Touch events come first on some engines (and always with the DevTools touch emulation).
  const touchStart = () => {
    lastTouchAt = Date.now();
    setTouchMode(true);
  };
  win.addEventListener("pointerdown", down, true);
  win.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  const off = subscribeTouchMode(sync);
  sync();
  return () => {
    win.removeEventListener("pointerdown", down, true);
    win.removeEventListener("touchstart", touchStart, true);
    off();
    root.removeAttribute("data-touch");
  };
}
