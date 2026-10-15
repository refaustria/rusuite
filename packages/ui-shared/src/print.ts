// Shared print helpers: CSS `@page` generation and the print-then-restore flow.

import { useEffect } from "react";
import type { Backend } from "./backend";

export type PaperName = "A4" | "Letter";
export type PageOrientation = "portrait" | "landscape";

/** Paper sizes in inches (portrait). */
export const PAPER_IN: Record<PaperName, { w: number; h: number }> = {
  A4: { w: 210 / 25.4, h: 297 / 25.4 },
  Letter: { w: 8.5, h: 11 },
};

const fmt = (n: number) => `${Number(n.toFixed(3))}`;

/**
 * An `@page` rule. `size` is a named paper (`A4`, `Letter`, optionally with
 * ` landscape`) or explicit `<w>in <h>in`; `margin` is a CSS length list.
 */
export function pageRule(size: string, margin: string): string {
  return `@page { size: ${size}; margin: ${margin}; }`;
}

/** `A4`/`Letter` (+ ` landscape`) for a page of `widthIn × heightIn` (either orientation), else explicit inches. */
export function pageSizeCss(widthIn: number, heightIn: number, tolerance = 0.03): string {
  const landscape = widthIn > heightIn;
  const [short, long] = landscape ? [heightIn, widthIn] : [widthIn, heightIn];
  for (const name of Object.keys(PAPER_IN) as PaperName[]) {
    const p = PAPER_IN[name];
    if (Math.abs(p.w - short) <= tolerance && Math.abs(p.h - long) <= tolerance) {
      return landscape ? `${name} landscape` : name;
    }
  }
  return `${fmt(widthIn)}in ${fmt(heightIn)}in`;
}

/**
 * Prints and resolves once printing is over: on `afterprint`, or shortly
 * after `backend.print()` returned if the webview never fires it.
 */
export async function printAndWait(backend: Pick<Backend, "print">, graceMs = 1500): Promise<void> {
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  window.addEventListener("afterprint", done, { once: true });
  try {
    await backend.print();
    const timer = setTimeout(done, graceMs);
    await finished;
    clearTimeout(timer);
  } finally {
    window.removeEventListener("afterprint", done);
  }
}

/** Calls `onPrint` on Ctrl/Cmd+P (and suppresses the browser's own print). */
export function usePrintShortcut(onPrint: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onPrint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrint, enabled]);
}
