// Touch UI switch of Calc (P10-M3): selection handles, the touch fill handle, pinch zoom and the tap rules apply once a
// touch pointer has been seen (a tablet with a finger, a phone), or right away on a compact layout of a device with a
// touch screen (`navigator.maxTouchPoints > 0`). A desktop with a mouse never gets them.

import { useSyncExternalStore } from "react";
import { COMPACT_QUERY, FORCE_COMPACT_EVENT, isCompact } from "@rusuite/ui-shared";

let touchSeen = false;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

/** Records a touch pointer (also called by the grid's own handlers, so unit tests need no window listener). */
export function noteTouch(): void {
  if (touchSeen) return;
  touchSeen = true;
  emit();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") noteTouch();
  }, true);
}

/** Whether the touch UI applies now. */
export function isTouchUi(): boolean {
  if (touchSeen) return true;
  const points = typeof navigator === "undefined" ? 0 : (navigator.maxTouchPoints ?? 0);
  return points > 0 && isCompact();
}

function subscribe(onChange: () => void): () => void {
  install();
  listeners.add(onChange);
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY) : null;
  mq?.addEventListener?.("change", onChange);
  if (typeof window !== "undefined") window.addEventListener(FORCE_COMPACT_EVENT, onChange);
  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener?.("change", onChange);
    if (typeof window !== "undefined") window.removeEventListener(FORCE_COMPACT_EVENT, onChange);
  };
}

/** The touch UI switch as a hook. */
export function useTouchUi(): boolean {
  return useSyncExternalStore(subscribe, isTouchUi, () => false);
}

/** Tests: forget the touch pointer seen. */
export function resetTouchUi(): void {
  touchSeen = false;
  emit();
}
