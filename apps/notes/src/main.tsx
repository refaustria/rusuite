import React from "react";
import ReactDOM from "react-dom/client";
import { Assistant, I18nProvider, isTauri, TauriAiStore } from "@rusuite/ui-shared";
import App from "./App";
import { WebNotesBackend, type NotesBackend, type NotesWasmModule } from "./backend";
import type { ConvertWasmModule } from "./convert/loader";
import { workerConverter, type WorkerLike } from "./convert/workerClient";
import { NotesController } from "./controller";
import { initLoro } from "./loro";
import { IdbNotesStore, MemoryNotesStore, type NotesStore } from "./store";
import { TabLock } from "./tablock";
import { wasmCrypto, type SyncWasmModule } from "./sync/crypto";
import { SyncManager } from "./sync/manager";
import { relaySocket, relaySocketTo } from "./sync/socket";
import type { SocketFactory } from "./sync/engine";
import { setDesktopShell } from "./tauri/shell";
import "./i18n";
import "./styles.css";

async function loadWasm(): Promise<NotesWasmModule & SyncWasmModule> {
  // Produced by `pnpm build:wasm` (gitignored).
  // @ts-ignore -- generated
  const mod = await import("../src-wasm/pkg/app_notes_wasm.js");
  await mod.default();
  return mod as NotesWasmModule & SyncWasmModule;
}

/** The converters (P11-N6b): a second wasm module, fetched the first time an import, export or rich paste needs it,
 * in a Web Worker (P11-X1) so a long conversion never blocks the page and can be cancelled. */
function loadConverter(): Promise<ConvertWasmModule> {
  return workerConverter(() => new Worker(new URL("./convert/worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike);
}

/**
 * The desktop shell (P11-N7): the native core and converters over IPC, notebooks as folders, the configured relay.
 * The sharing crypto stays the wasm module's (its calls are synchronous).
 */
async function desktopParts(): Promise<{ backend: NotesBackend; store: NotesStore; socket: SocketFactory; onReady: (ctl: NotesController) => void }> {
  const { TauriDesktop, TauriNotesBackend, TauriNotesStore } = await import("./tauri/backend");
  const backend = new TauriNotesBackend();
  await backend.reset();
  const api = new TauriDesktop();
  const relay = await api.relay();
  setDesktopShell({ api, relay, ai: new Assistant({ store: new TauriAiStore() }) });
  return {
    backend,
    store: new TauriNotesStore(),
    socket: relaySocketTo(relay.wsUrl),
    onReady: (ctl) => {
      ctl.desktop = { linkBase: relay.webBase, touch: async (id, name) => void (await api.touch(id, name)) };
      // Closing the window: the shell holds it until the writes are flushed (at most 5 s).
      void api.onCloseRequested(() => {
        void (async () => {
          try {
            await ctl.idle();
            if (ctl.sync) await Promise.all([...ctl.sync.engines.values()].map((e) => e.persistNow()));
          } finally {
            await api.closeNow();
          }
        })();
      });
    },
  };
}

async function boot() {
  const [wasm] = await Promise.all([loadWasm(), initLoro()]);
  const desktop = isTauri() ? await desktopParts() : null;
  const backend = desktop?.backend ?? new WebNotesBackend(wasm, loadConverter);
  const store = desktop?.store ?? (IdbNotesStore.available() ? new IdbNotesStore() : new MemoryNotesStore());
  const ctl = new NotesController(backend, store);
  desktop?.onReady(ctl);
  // Sharing (P11-N5b): engines (and their connection) exist only for shared notebooks.
  const sync = new SyncManager(wasmCrypto(wasm), store, ctl.syncHost(), desktop?.socket ?? relaySocket);
  ctl.attachSync(sync);
  window.addEventListener("online", () => sync.setOnline(true));
  window.addEventListener("offline", () => sync.setOnline(false));
  window.addEventListener("pagehide", () => {
    for (const e of sync.engines.values()) void e.persistNow();
  });
  ctl.persister.installPageHooks();
  (window as unknown as { __rusuiteNotes?: NotesController }).__rusuiteNotes = ctl; // e2e and diagnostics
  const lock = TabLock.browser();
  lock.onLost = () => ctl.goReadOnly();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <App ctl={ctl} lock={lock} />
      </I18nProvider>
    </React.StrictMode>,
  );
  // Only one tab writes the notebooks of this browser (src/tablock.ts).
  if (await lock.acquire()) void ctl.start();
}

void boot();
