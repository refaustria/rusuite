// Lets ribbon commands reuse an app's shortcut map (and the dialogs its
// ShortcutLayer owns: Save As, help, …) without lifting their state: the
// combo is dispatched as a synthetic keydown on `window`, where
// `useShortcuts` listens.

import { canonicalCombo } from "../shortcuts/keys";

const KEYS: Record<string, { key: string; code?: string }> = {
  "/": { key: "/", code: "Slash" },
  plus: { key: "+", code: "Equal" },
  minus: { key: "-", code: "Minus" },
  space: { key: " ", code: "Space" },
  "[": { key: "[", code: "BracketLeft" },
  "]": { key: "]", code: "BracketRight" },
};

/** The `KeyboardEventInit` of a combo spec (`Mod+Shift+S`; Mod = Ctrl). */
export function comboEventInit(spec: string): KeyboardEventInit {
  const parts = canonicalCombo(spec).split("+");
  const name = parts[parts.length - 1] === "" ? "plus" : parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  let k = KEYS[name];
  if (!k) {
    if (/^[a-z]$/.test(name)) k = { key: name, code: `Key${name.toUpperCase()}` };
    else if (/^\d$/.test(name)) k = { key: name, code: `Digit${name}` };
    else if (/^f\d{1,2}$/.test(name)) k = { key: name.toUpperCase(), code: name.toUpperCase() };
    else k = { key: name.charAt(0).toUpperCase() + name.slice(1) };
  }
  return {
    key: mods.has("shift") && k.key.length === 1 ? k.key.toUpperCase() : k.key,
    code: k.code,
    ctrlKey: mods.has("mod"),
    altKey: mods.has("alt"),
    shiftKey: mods.has("shift"),
    bubbles: true,
    cancelable: true,
  };
}

/** Runs the app shortcut bound to `spec`; returns whether a handler took it. */
export function triggerShortcut(spec: string): boolean {
  const e = new KeyboardEvent("keydown", comboEventInit(spec));
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
