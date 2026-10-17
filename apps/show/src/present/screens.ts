// Slide Show › Monitors (P9-S5): which screen the slide show (the
// audience window of the presenter view) goes to, remembered per
// browser / desktop install. The desktop shell enumerates its monitors
// (`show_monitors`) and swaps the two windows (`show_swap_displays`); the
// web asks the Window Management API (`getScreenDetails`, after a
// permission prompt) when the user wants to choose. Choosing is pure
// (`pickScreen`), so it is tested without screens.

import { isTauri } from "@rusuite/ui-shared";
import { t } from "../i18n";

/** A screen in logical (CSS) pixels. */
export interface ScreenInfo {
  /** Stable within a session: the shell's monitor index / the Window Management API's label. */
  id: string;
  label: string;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `"auto"`: like PowerPoint's Automatic – a screen other than the presenter's, else the presenter's. */
export type ScreenChoice = "auto" | "primary" | string;

export const SCREEN_KEY = "rusuite.show.audienceScreen";

export function loadScreenChoice(): ScreenChoice {
  try {
    return window.localStorage.getItem(SCREEN_KEY) || "auto";
  } catch {
    return "auto";
  }
}

export function saveScreenChoice(choice: ScreenChoice): void {
  try {
    if (choice === "auto") window.localStorage.removeItem(SCREEN_KEY);
    else window.localStorage.setItem(SCREEN_KEY, choice);
  } catch {
    // No storage: the choice lasts for this session only.
  }
}

const inside = (s: ScreenInfo, p: { x: number; y: number }) => p.x >= s.x && p.x < s.x + s.width && p.y >= s.y && p.y < s.y + s.height;

/**
 * The screen of the slide show: the chosen one when it exists (a monitor
 * that went away falls back to Automatic), "primary" the primary screen,
 * Automatic the first screen the presenter (`at`, a point of the main
 * window) is not on. `null`: no other screen – the show opens as a
 * normal window next to the presenter view.
 */
export function pickScreen(screens: readonly ScreenInfo[], choice: ScreenChoice, at: { x: number; y: number } | null): ScreenInfo | null {
  if (screens.length === 0) return null;
  const chosen = choice === "primary" ? screens.find((s) => s.primary) : choice !== "auto" ? screens.find((s) => s.id === choice) : undefined;
  if (chosen) return chosen;
  if (screens.length < 2) return null;
  const here = at ? screens.find((s) => inside(s, at)) : screens.find((s) => s.primary);
  return screens.find((s) => s !== here) ?? null;
}

/** The label of a choice in the Monitor menu. */
export function choiceLabel(choice: ScreenChoice, screens: readonly ScreenInfo[], t: (k: string) => string): string {
  if (choice === "auto") return t("show.monitor.auto");
  if (choice === "primary") return t("show.monitor.primary");
  return screens.find((s) => s.id === choice)?.label ?? t("show.monitor.auto");
}

// ----- enumeration ---------------------------------------------------------------------------

interface MonitorWire {
  index: number;
  name: string | null;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Monitors of the desktop shell (logical px). */
async function tauriScreens(): Promise<ScreenInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const list = await invoke<MonitorWire[]>("show_monitors");
  return list.map((m) => ({ id: String(m.index), label: m.name?.trim() || t("show.monitor.n", { n: m.index + 1 }), primary: m.primary, x: m.x, y: m.y, width: m.width, height: m.height }));
}

interface ScreenDetailed {
  label?: string;
  isPrimary?: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Screens known to the web page: the Window Management API's after `detectScreens`, else none. */
let webScreens: ScreenInfo[] = [];

/** Whether the browser can list screens (Window Management API). */
export const canDetectScreens = (): boolean => !isTauri() && typeof window !== "undefined" && "getScreenDetails" in window;

/** Asks the browser for its screens (permission prompt the first time; call from a click). */
export async function detectScreens(): Promise<ScreenInfo[]> {
  if (!canDetectScreens()) return [];
  const details = await (window as unknown as { getScreenDetails: () => Promise<{ screens: ScreenDetailed[] }> }).getScreenDetails();
  webScreens = details.screens.map((s, i) => ({ id: s.label || `screen-${i}`, label: s.label || t("show.monitor.n", { n: i + 1 }), primary: !!s.isPrimary, x: s.left, y: s.top, width: s.width, height: s.height }));
  return webScreens;
}

/** The screens for the Monitor menu: the desktop's monitors, or the screens the browser told us about. */
export async function listScreens(): Promise<ScreenInfo[]> {
  if (isTauri()) return tauriScreens().catch(() => []);
  return webScreens;
}

/** The web's known screens (synchronous: `window.open` must run inside the click). */
export const knownWebScreens = (): ScreenInfo[] => webScreens;

/** Presenter view › Swap displays: the presenter view and the slide show change screens (desktop). */
export async function swapDisplays(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("show_swap_displays").catch(() => false);
}

/** Whether Swap displays can work here (the desktop shell moves windows; browsers do not let pages do that). */
export const canSwapDisplays = (): boolean => isTauri();
