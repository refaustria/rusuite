// Mobile shells (P10-M1): the Android/iOS builds of the Tauri apps. Their `tauri-plugin-rusuite-mobile` marks the page
// with `window.__RUSUITE_MOBILE__` ("android" | "ios") in an initialization script, before any app code runs, so
// the check is synchronous and needs no OS plugin (desktop and web pages have no marker).

/** A mobile shell's operating system. */
export type MobilePlatform = "android" | "ios";

/** `"android"` / `"ios"` inside a mobile shell, else `null` (desktop shells, browsers). */
export function mobilePlatform(): MobilePlatform | null {
  const os = (globalThis as { __RUSUITE_MOBILE__?: unknown }).__RUSUITE_MOBILE__;
  return os === "android" || os === "ios" ? os : null;
}

/** Whether the page runs in a mobile shell (the web build on a phone is not one: it stays a `WasmBackend`). */
export function isMobile(): boolean {
  return mobilePlatform() !== null;
}
