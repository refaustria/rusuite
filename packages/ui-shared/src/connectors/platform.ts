// The two platforms of `Connectors`: the browser (IndexedDB + `fetch`) and the desktop shells (Tauri commands).

import type { ConnectorPlatform } from "./controller";
import { IdbConnectionStore, MemoryConnectionStore } from "./store";
import { TauriConnectionStore, TauriProvider } from "./tauri";
import { FetchWebDavProvider } from "./webdav-fetch";

/** `".xlsx,application/…"` → `[".xlsx"]`. */
export function extensionsOf(accept: string | undefined): string[] {
  return (accept ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.startsWith("."));
}

export function webConnectorPlatform(extensions: readonly string[]): ConnectorPlatform {
  return {
    kind: "web",
    store: IdbConnectionStore.available() ? new IdbConnectionStore() : new MemoryConnectionStore(),
    provider: (target) => new FetchWebDavProvider(target),
    extensions,
  };
}

export function tauriConnectorPlatform(extensions: readonly string[]): ConnectorPlatform {
  return {
    kind: "desktop",
    store: new TauriConnectionStore(),
    provider: (target) => new TauriProvider(target),
    extensions,
  };
}
