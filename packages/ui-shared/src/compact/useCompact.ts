// The compact (phone) layout switch (P10-M2): below 900 px the apps replace the ribbon with a top bar and a bottom
// command bar, and dialogs, menus and popovers become bottom sheets. At 900 px and wider nothing changes (desktop,
// tablets in landscape).
//
// Test hook: `window.__RUSUITE_FORCE_COMPACT__ = true | false` (set with `addInitScript`, like `__RUSUITE_PLATFORM__`)
// overrides the media query; dispatch `FORCE_COMPACT_EVENT` on `window` after changing it at run time.

import { createContext, useContext, useSyncExternalStore } from "react";

/** The widest viewport (CSS px) that still gets the compact layout. */
export const COMPACT_MAX_WIDTH = 899;
/** The media query of the compact layout. */
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;
/** Window event that re-reads `__RUSUITE_FORCE_COMPACT__`. */
export const FORCE_COMPACT_EVENT = "rusuite:force-compact";

/** The forced layout of the test hook, if any. */
export function forcedCompact(): boolean | undefined {
  const v = (globalThis as { __RUSUITE_FORCE_COMPACT__?: unknown }).__RUSUITE_FORCE_COMPACT__;
  return typeof v === "boolean" ? v : undefined;
}

function query(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(COMPACT_QUERY);
}

/** Whether the compact layout applies now (the test hook, else the media query; no `matchMedia`: desktop). */
export function isCompact(): boolean {
  return forcedCompact() ?? query()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const mq = query();
  // Safari < 14 only has the deprecated addListener.
  if (mq?.addEventListener) mq.addEventListener("change", onChange);
  else mq?.addListener?.(onChange);
  window.addEventListener(FORCE_COMPACT_EVENT, onChange);
  return () => {
    if (mq?.removeEventListener) mq.removeEventListener("change", onChange);
    else mq?.removeListener?.(onChange);
    window.removeEventListener(FORCE_COMPACT_EVENT, onChange);
  };
}

/** The compact layout switch as a hook (re-renders when the viewport crosses `COMPACT_MAX_WIDTH`). */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, isCompact, () => false);
}

/** True inside the compact command bar: ribbon controls render as 44 px touch buttons with a label under the icon. */
export const CompactBarContext = createContext(false);

/** Whether the component renders inside the compact command bar. */
export function useInCompactBar(): boolean {
  return useContext(CompactBarContext);
}
