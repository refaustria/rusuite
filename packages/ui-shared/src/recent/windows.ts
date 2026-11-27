// One window per document in the desktop shells (P11-D2): every document has its own window with its own core,
// file, undo history and close guard (`apps/*\/src-tauri/src/windows.rs`). The shell routes opens itself – an empty
// window takes the document, a file that is already open brings its window to the front, anything else opens in a
// new window – so Open and the recent list never replace this window's document and never ask about its unsaved
// changes. New (Cmd/Ctrl+N) opens a new window, Cmd/Ctrl+W closes this one (its close guard asks).

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { subscribeLocale, t } from "../i18n/locale";

export interface DesktopWindows {
  /** Opens a new, empty window (File › New). */
  newWindow(): Promise<void>;
  /** Closes this window (the close guard asks about unsaved changes). */
  closeWindow(): Promise<void>;
}

/** This window's label (`main`, `doc-2`, …); `undefined` outside the shell (tests, the browser). */
export function currentWindowLabel(): string | undefined {
  try {
    return getCurrentWindow().label;
  } catch {
    return undefined;
  }
}

/**
 * Listener options for events the shell sends to one window (`emit_to`): only this window's listener runs.
 * Without a label (tests), every listener.
 */
export function thisWindow(): { target: string } | undefined {
  const label = currentWindowLabel();
  return label === undefined ? undefined : { target: label };
}

/** The macOS menu bar's entries (`windows::MenuTexts` in the shells) → their message keys. `{app}`: the app's name. */
export const MENU_KEYS = {
  about: "menu.about",
  services: "menu.services",
  hide: "menu.hide",
  hideOthers: "menu.hideOthers",
  showAll: "menu.showAll",
  quit: "menu.quit",
  file: "menu.file",
  newWindow: "menu.new",
  closeWindow: "menu.closeWindow",
  edit: "menu.edit",
  undo: "menu.undo",
  redo: "menu.redo",
  cut: "menu.cut",
  copy: "menu.copy",
  paste: "menu.paste",
  selectAll: "menu.selectAll",
  view: "menu.view",
  fullscreen: "menu.fullscreen",
  window: "menu.window",
  minimize: "menu.minimize",
  zoom: "menu.zoom",
  bringAllToFront: "menu.bringAllToFront",
} as const;

export type MenuTexts = Record<keyof typeof MENU_KEYS, string>;

/** The menu bar in the current language (`{app}` stays for the shell to fill in). */
export function menuTexts(): MenuTexts {
  const texts = {} as MenuTexts;
  for (const [field, key] of Object.entries(MENU_KEYS) as [keyof MenuTexts, string][]) texts[field] = t(key);
  return texts;
}

/** Whether the page runs on macOS (window titles follow its convention). */
export function onMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");
}

/**
 * The macOS window title of the apps' "<name> • – Rusuite Calc" / "• <name> – Rusuite Write": the document's name,
 * then " — Edited" while it has unsaved changes (as the system's own apps show it; the Window menu lists these).
 */
export function macWindowTitle(title: string, edited: string = t("window.edited")): string {
  const m = /^(.*?)\s+[–-]\s+Rusuite \w+$/u.exec(title);
  if (!m) return title;
  const marked = m[1]!;
  const lead = /^•\s+/u;
  const trail = /\s+•(?=\s|$)/u;
  const dirty = lead.test(marked) || trail.test(marked);
  const name = marked.replace(lead, "").replace(trail, "");
  return dirty ? `${name} — ${edited}` : name;
}

/**
 * The shell's window commands (`window_new`, the window's own close) and, on macOS (`mac`: the only menu bar), its
 * localized menu (`menu_texts`, again on every language switch).
 */
export function tauriWindows(mac: boolean = onMac()): DesktopWindows {
  if (mac) {
    const sendMenu = () => void invoke("menu_texts", { texts: menuTexts() }).catch(() => undefined);
    sendMenu();
    subscribeLocale(sendMenu);
  }
  return {
    newWindow: () => invoke<void>("window_new"),
    closeWindow: () => getCurrentWindow().close(),
  };
}
