import { useEffect, useRef } from "react";
import { canonicalCombo, eventCombo } from "./keys";

export interface ShortcutEntry {
  /** Shown in the help dialog. */
  label: string;
  /** Help section; entries without one go to "General". */
  group?: string;
  /**
   * Runs the shortcut. Return `false` when it does not apply (the browser
   * default is kept); anything else counts as handled. Omit `run` for keys
   * handled natively (listed in the help, never bound).
   */
  run?: (e: KeyboardEvent) => unknown;
  /** Also fire when the key comes from a text field, menu or dialog (Save, Open, ...). */
  inField?: boolean;
  /** Extra guard, e.g. "the grid has focus". */
  when?: (e: KeyboardEvent) => boolean;
}

/** Combo spec (`Mod+Shift+S`) to entry. */
export type ShortcutMap = Record<string, ShortcutEntry>;

const FIELD = "input, textarea, select, [contenteditable=true], [contenteditable=''], [role=menu], [role=dialog], nav";

/** Whether a key event comes from a text field or a menu (those keep their keys). */
export function fromField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest(FIELD);
}

/** Runs the entry bound to the event, if any. Returns whether one handled it. */
export function dispatchShortcut(map: ShortcutMap, e: KeyboardEvent): boolean {
  const combo = eventCombo(e);
  for (const [spec, entry] of Object.entries(map)) {
    if (!entry.run || canonicalCombo(spec) !== combo) continue;
    if (!entry.inField && fromField(e.target)) continue;
    if (entry.when && !entry.when(e)) continue;
    if (entry.run(e) === false) continue;
    e.preventDefault();
    return true;
  }
  return false;
}

/**
 * Binds a shortcut map to the window (bubbling phase, so the editor's own
 * key handling goes first and events it handled are skipped).
 */
export function useShortcuts(map: ShortcutMap, options: { enabled?: boolean } = {}): void {
  const ref = useRef(map);
  ref.current = map;
  const enabled = options.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      dispatchShortcut(ref.current, e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
