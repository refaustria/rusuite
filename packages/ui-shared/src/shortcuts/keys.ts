// Key-combo normalisation. A combo is written `Mod+Shift+S`: `Mod` is Ctrl
// (or Cmd on macOS), then `Alt`, `Shift`, and one key (`S`, `F5`, `Plus`,
// `Minus`, `Space`, `ArrowLeft`, `]`, `1`, ...). Matching is case-insensitive
// and independent of modifier order.

import type { Locale } from "../i18n/core";
import { getLocale } from "../i18n/locale";

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

const ALIASES: Record<string, string> = {
  "+": "plus",
  "=": "plus",
  "-": "minus",
  _: "minus",
  " ": "space",
  spacebar: "space",
  esc: "escape",
  del: "delete",
  "}": "]",
  "{": "[",
  "?": "/",
};

/** Keys that need Shift on common layouts: Shift is not part of the combo. */
const SHIFT_AGNOSTIC = new Set(["plus", "/"]);

function keyName(e: KeyLike): string {
  const code = e.code ?? "";
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1]!;
  if (code === "BracketRight") return "]";
  if (code === "BracketLeft") return "[";
  if (code === "NumpadAdd") return "plus";
  if (code === "NumpadSubtract") return "minus";
  if (code === "Slash") return "/";
  // With Alt the produced character differs by layout (macOS Option): use the physical key.
  const letter = /^Key([A-Z])$/.exec(code);
  if (e.altKey && letter) return letter[1]!.toLowerCase();
  const k = e.key.toLowerCase();
  return ALIASES[k] ?? k;
}

function build(mod: boolean, alt: boolean, shift: boolean, key: string): string {
  return `${mod ? "mod+" : ""}${alt ? "alt+" : ""}${shift && !SHIFT_AGNOSTIC.has(key) ? "shift+" : ""}${key}`;
}

/** Canonical combo of a keyboard event. */
export function eventCombo(e: KeyLike): string {
  return build(!!(e.ctrlKey || e.metaKey), !!e.altKey, !!e.shiftKey, keyName(e));
}

/** Canonical form of a combo spec such as `Mod+Shift+S`. */
export function canonicalCombo(spec: string): string {
  let mod = false;
  let alt = false;
  let shift = false;
  let key = "";
  for (const part of spec.split("+")) {
    const p = part.toLowerCase();
    if (p === "mod" || p === "ctrl" || p === "cmd" || p === "meta") mod = true;
    else if (p === "alt" || p === "option") alt = true;
    else if (p === "shift") shift = true;
    else key = ALIASES[p] ?? p;
  }
  return build(mod, alt, shift, key);
}

const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

/**
 * Human-readable combo for the help dialog and tooltips (`Mod+Shift+S` ->
 * `Ctrl+Shift+S`; German UI: `Strg+Shift+S`, as German Office). A spec
 * may also name `Ctrl` directly (context menus).
 */
export function formatCombo(spec: string, mac: boolean = isMac(), locale: Locale = getLocale()): string {
  const ctrl = locale === "de" ? "Strg" : "Ctrl";
  return spec
    .split("+")
    .map((p) => {
      const l = p.toLowerCase();
      if (l === "mod") return mac ? "⌘" : ctrl;
      if (l === "ctrl") return ctrl;
      if ((l === "delete" || l === "del") && locale === "de") return "Entf";
      if (l === "alt") return mac ? "⌥" : "Alt";
      if (l === "plus") return "+";
      if (l === "minus") return "-";
      if (l === "arrowleft") return "←";
      if (l === "arrowright") return "→";
      if (l === "arrowup") return "↑";
      if (l === "arrowdown") return "↓";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join("+");
}
