// The Draw tab's state, shared by the ribbon and the canvas view: the active tool, pen and highlighter settings
// (kept for the session and in localStorage), and the canvas selection (boxes, images, strokes) of the open page.

import { useSyncExternalStore } from "react";

export type Tool = "select" | "pen" | "highlighter" | "eraser" | "lasso";

/** Pen widths (1/10 pt): fine, medium, thick. */
export const PEN_WIDTHS = [10, 20, 40] as const;
/** Highlighter width (1/10 pt). */
export const HIGHLIGHTER_WIDTHS = [80, 120, 180] as const;

/** Pen colours: black, the suite's app colours (Notes, Write, Calc, Show), and a few basics. */
export const PEN_COLORS = ["#000000", "#7719AA", "#2B579A", "#217346", "#C2410C", "#E81123", "#0078D4", "#808080"] as const;
export const HIGHLIGHTER_COLORS = ["#FFEB3B", "#76FF03", "#18FFFF", "#FF4081", "#FFAB40"] as const;

export interface ToolState {
  tool: Tool;
  penColor: string;
  penWidth: number;
  hlColor: string;
  hlWidth: number;
  /** Selected canvas items (boxes, images) and strokes. */
  items: ReadonlySet<string>;
  strokes: ReadonlySet<string>;
}

const KEY = "rusuite.notes.ink";
const EMPTY: ReadonlySet<string> = new Set();

function load(): Pick<ToolState, "penColor" | "penWidth" | "hlColor" | "hlWidth"> {
  const d = { penColor: PEN_COLORS[0] as string, penWidth: PEN_WIDTHS[1] as number, hlColor: HIGHLIGHTER_COLORS[0] as string, hlWidth: HIGHLIGHTER_WIDTHS[1] as number };
  try {
    const s = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") as Partial<typeof d> | null;
    if (s && typeof s === "object") {
      for (const k of Object.keys(d) as (keyof typeof d)[]) if (typeof s[k] === typeof d[k]) (d as Record<string, unknown>)[k] = s[k];
    }
  } catch {
    /* defaults */
  }
  return d;
}

let state: ToolState = { tool: "select", items: EMPTY, strokes: EMPTY, ...load() };
const listeners = new Set<() => void>();

export function getTools(): ToolState {
  return state;
}

export function setTools(patch: Partial<ToolState>): void {
  state = { ...state, ...patch };
  if ("penColor" in patch || "penWidth" in patch || "hlColor" in patch || "hlWidth" in patch) {
    try {
      const { penColor, penWidth, hlColor, hlWidth } = state;
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ penColor, penWidth, hlColor, hlWidth }));
    } catch {
      /* private mode */
    }
  }
  for (const l of listeners) l();
}

export function setSelection(items: Iterable<string>, strokes: Iterable<string>): void {
  const i = new Set(items);
  const s = new Set(strokes);
  if (i.size === 0 && s.size === 0 && state.items.size === 0 && state.strokes.size === 0) return;
  setTools({ items: i.size ? i : EMPTY, strokes: s.size ? s : EMPTY });
}

export const clearSelection = (): void => setSelection([], []);

export function subscribeTools(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTools<T>(select: (s: ToolState) => T): T {
  return useSyncExternalStore(subscribeTools, () => select(state));
}
