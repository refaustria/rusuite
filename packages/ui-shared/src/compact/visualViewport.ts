// The visible part of the layout viewport (P10-M2): when the on-screen keyboard opens, the visual viewport shrinks
// while the layout viewport may not. The compact layout keeps the app (formula bar, editor, slide) inside the visual
// viewport and pins the command bar to its bottom, through CSS variables on <html>:
//   --rs-vv-top     the visual viewport's offset from the layout viewport's top
//   --rs-vv-height  its height
//   --rs-kb-inset   the layout viewport's height under it (the keyboard), used as `bottom` of fixed bars and sheets
//
// Test hook: `window.__RUSUITE_VISUAL_VIEWPORT__ = { height, offsetTop }` overrides the browser's values; dispatch
// `VISUAL_VIEWPORT_EVENT` on `window` after setting it.

/** Window event that re-reads the visual viewport (the test hook). */
export const VISUAL_VIEWPORT_EVENT = "rusuite:visualviewport";

export interface ViewportBox {
  /** Offset of the visible area from the top of the layout viewport (px). */
  top: number;
  /** Height of the visible area (px). */
  height: number;
  /** Height of the layout viewport (`innerHeight`). */
  layoutHeight: number;
}

type Override = { height?: number; offsetTop?: number } | undefined;

/** The visible area now. A pinch-zoomed page (scale ≠ 1) counts as the whole layout viewport. */
export function readViewport(): ViewportBox {
  const layoutHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const o = (globalThis as { __RUSUITE_VISUAL_VIEWPORT__?: Override }).__RUSUITE_VISUAL_VIEWPORT__;
  if (o && (o.height !== undefined || o.offsetTop !== undefined)) {
    return { top: o.offsetTop ?? 0, height: o.height ?? layoutHeight, layoutHeight };
  }
  const vv = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!vv || Math.abs((vv.scale ?? 1) - 1) > 0.01) return { top: 0, height: layoutHeight, layoutHeight };
  return { top: vv.offsetTop, height: vv.height, layoutHeight };
}

/** The part of the layout viewport under the visible area (the on-screen keyboard), ≥ 0. */
export function keyboardInset(b: ViewportBox): number {
  return Math.max(0, Math.round(b.layoutHeight - b.top - b.height));
}

/** Calls `onChange` now and on every change of the visual viewport; returns the unsubscribe function. */
export function trackVisualViewport(onChange: (box: ViewportBox) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const update = () => onChange(readViewport());
  const vv = window.visualViewport;
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  window.addEventListener(VISUAL_VIEWPORT_EVENT, update);
  update();
  return () => {
    vv?.removeEventListener("resize", update);
    vv?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    window.removeEventListener(VISUAL_VIEWPORT_EVENT, update);
  };
}

const VARS = ["--rs-vv-top", "--rs-vv-height", "--rs-kb-inset"] as const;

/** Keeps the CSS variables (and `data-keyboard` while the keyboard covers > 80 px) on `root` up to date. */
export function installViewportVars(root: HTMLElement = document.documentElement): () => void {
  const stop = trackVisualViewport((b) => {
    const inset = keyboardInset(b);
    root.style.setProperty("--rs-vv-top", `${Math.round(b.top)}px`);
    root.style.setProperty("--rs-vv-height", `${Math.round(b.height)}px`);
    root.style.setProperty("--rs-kb-inset", `${inset}px`);
    if (inset > 80) root.setAttribute("data-keyboard", "");
    else root.removeAttribute("data-keyboard");
  });
  return () => {
    stop();
    for (const v of VARS) root.style.removeProperty(v);
    root.removeAttribute("data-keyboard");
  };
}
