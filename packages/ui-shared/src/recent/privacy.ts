// Privacy settings of the local document store (ADR 0009).
//
// "Keep autosave copies in this browser" (default on) is a per-browser preference kept in
// `localStorage` (on desktop: the webview's storage in the app data directory). When off, the
// session writes no recovery entries and stores no content with recent entries.

const KEY = "rusuite.keepAutosave";

export function getKeepAutosave(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeKeepAutosave(keep: boolean): void {
  try {
    if (keep) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, "off");
  } catch {
    // blocked storage: the choice lasts for this page only (the session keeps it in memory)
  }
}
