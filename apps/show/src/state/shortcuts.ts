// Keyboard shortcuts of the editor → abstract actions (the store turns
// them into commands).

import type { ZOp } from "../generated/ZOp";

export type ShortcutAction =
  | { kind: "delete" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "duplicate" }
  | { kind: "group" }
  | { kind: "ungroup" }
  | { kind: "zOrder"; op: ZOp }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "selectAll" }
  | { kind: "deselect" }
  | { kind: "editText" }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "open" }
  | { kind: "save" };

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** The action of a key press on the slide editor, or `null`. */
export function shortcutFor(e: KeyLike): ShortcutAction | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  if (e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    // Brackets by code: with Shift the key is `{`/`}` on US layouts.
    const bracket = e.code === "BracketRight" || k === "]" || k === "}" ? "]" : e.code === "BracketLeft" || k === "[" || k === "{" ? "[" : null;
    if (bracket === "]") return { kind: "zOrder", op: e.shiftKey ? "bringToFront" : "bringForward" };
    if (bracket === "[") return { kind: "zOrder", op: e.shiftKey ? "sendToBack" : "sendBackward" };
    switch (k) {
      case "z": return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
      case "y": return { kind: "redo" };
      case "d": return { kind: "duplicate" };
      case "c": return e.shiftKey ? null : { kind: "copy" };
      case "x": return e.shiftKey ? null : { kind: "cut" };
      case "v": return e.shiftKey ? null : { kind: "paste" };
      case "g": return e.shiftKey ? { kind: "ungroup" } : { kind: "group" };
      case "a": return { kind: "selectAll" };
      case "o": return { kind: "open" };
      case "s": return { kind: "save" };
      default: return null;
    }
  }
  const step = e.shiftKey ? 10 : 1;
  switch (k) {
    case "Delete":
    case "Backspace": return { kind: "delete" };
    case "ArrowLeft": return { kind: "nudge", dx: -step, dy: 0 };
    case "ArrowRight": return { kind: "nudge", dx: step, dy: 0 };
    case "ArrowUp": return { kind: "nudge", dx: 0, dy: -step };
    case "ArrowDown": return { kind: "nudge", dx: 0, dy: step };
    case "Escape": return { kind: "deselect" };
    case "Enter":
    case "F2": return { kind: "editText" };
    default: return null;
  }
}
