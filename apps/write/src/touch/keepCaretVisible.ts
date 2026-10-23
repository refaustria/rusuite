// The caret above the keyboard (P10-M4): on phones the caret line stays visible when the on-screen keyboard opens
// (the visual viewport shrinks), when a sheet (Paragraph, Font, a menu) or the find bar opens, and after every
// selection change: at least `CARET_CLEARANCE_PX` above the command bar and clear of the sheet or find bar over it.

import type { EditorView } from "@tiptap/pm/view";
import { VISUAL_VIEWPORT_EVENT } from "@rusuite/ui-shared";

/** Room (px) between the caret and the command bar. */
export const CARET_CLEARANCE_PX = 60;
/** Room (px) between the caret and a sheet or the find bar. */
export const OBSTACLE_CLEARANCE_PX = 12;

/** The lowest y the caret's bottom may have now (viewport px), or null without a command bar (not compact). */
export function caretLimit(doc: Document = document): number | null {
  const bar = doc.querySelector<HTMLElement>('[data-testid="command-bar"]');
  if (!bar) return null;
  let limit = bar.getBoundingClientRect().top - CARET_CLEARANCE_PX;
  // The panel of every open bottom sheet (its last child; the sheet itself spans the screen) and the find bar.
  const panels = Array.from(doc.querySelectorAll<HTMLElement>("[data-bottom-sheet]")).map((s) => s.lastElementChild as HTMLElement | null);
  const find = doc.querySelector<HTMLElement>('[data-testid="find-bar"]');
  for (const p of [...panels, find]) {
    const r = p?.getBoundingClientRect();
    if (r && r.height > 0) limit = Math.min(limit, r.top - OBSTACLE_CLEARANCE_PX);
  }
  return limit;
}

/** How far (px) `scrollEl` must scroll down (positive) or up (negative) to bring the caret rectangle into the band. */
export function caretScrollDelta(caret: { top: number; bottom: number }, bandTop: number, limit: number): number {
  if (caret.bottom > limit) {
    const down = caret.bottom - limit;
    // Never above the band's top (a sheet covering almost everything).
    return Math.min(down, Math.max(0, caret.top - bandTop));
  }
  if (caret.top < bandTop) return caret.top - bandTop;
  return 0;
}

/** Scrolls the editor's scroll area so the caret (the selection's head) is inside the visible band. */
export function keepCaretVisible(view: EditorView): void {
  const limit = caretLimit();
  const scroll = (view.dom as HTMLElement).closest<HTMLElement>(".write-scroll");
  if (limit === null || !scroll) return;
  // Room under the last line to scroll it clear of what covers the bottom of the scroll area.
  const sr = scroll.getBoundingClientRect();
  const covered = Math.max(0, Math.ceil(sr.bottom - limit));
  scroll.style.setProperty("--write-touch-pad", `${covered}px`);
  // The caret counts while the editor has the focus, or a sheet / the find bar took it for a moment.
  const away = !view.hasFocus() && !view.dom.contains(document.activeElement);
  if (away && !document.querySelector('[data-bottom-sheet], [data-testid="find-bar"]')) return;
  let caret: { top: number; bottom: number };
  try {
    caret = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const top = sr.top + 8;
  const d = caretScrollDelta(caret, top, limit);
  // Whole pixels, rounded away from the band (scrollTop snaps to device pixels).
  if (Math.abs(d) >= 0.5) scroll.scrollTop += d > 0 ? Math.ceil(d) + 1 : Math.floor(d);
}

/** Keeps the caret visible on viewport changes, sheets opening and selection changes; returns the uninstall function. */
export function installCaretKeeper(view: EditorView, onSelection: (fn: () => void) => () => void): () => void {
  let frame = 0;
  const later = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!(view as unknown as { isDestroyed?: boolean }).isDestroyed) keepCaretVisible(view);
    });
  };
  const vv = window.visualViewport;
  vv?.addEventListener("resize", later);
  window.addEventListener("resize", later);
  window.addEventListener(VISUAL_VIEWPORT_EVENT, later);
  const mo = new MutationObserver(later);
  mo.observe(document.body, { childList: true });
  const root = (view.dom as HTMLElement).closest("[data-rs-app]");
  if (root) mo.observe(root, { childList: true });
  const off = onSelection(later);
  return () => {
    cancelAnimationFrame(frame);
    vv?.removeEventListener("resize", later);
    window.removeEventListener("resize", later);
    window.removeEventListener(VISUAL_VIEWPORT_EVENT, later);
    mo.disconnect();
    off();
  };
}
