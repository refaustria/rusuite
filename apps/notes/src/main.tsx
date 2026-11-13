import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "@rusuite/ui-shared";
import App from "./App";
import { WebNotesBackend, type NotesWasmModule } from "./backend";
import { NotesController } from "./controller";
import { initLoro } from "./loro";
import { IdbNotesStore, MemoryNotesStore } from "./store";
import "./i18n";
import "./styles.css";

async function loadWasm(): Promise<NotesWasmModule> {
  // Produced by `pnpm build:wasm` (gitignored).
  // @ts-ignore -- generated
  const mod = await import("../src-wasm/pkg/app_notes_wasm.js");
  await mod.default();
  return mod as NotesWasmModule;
}

async function boot() {
  const [wasm] = await Promise.all([loadWasm(), initLoro()]);
  const backend = new WebNotesBackend(wasm);
  const store = IdbNotesStore.available() ? new IdbNotesStore() : new MemoryNotesStore();
  const ctl = new NotesController(backend, store);
  ctl.persister.installPageHooks();
  (window as unknown as { __rusuiteNotes?: NotesController }).__rusuiteNotes = ctl; // e2e and diagnostics
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <App ctl={ctl} />
      </I18nProvider>
    </React.StrictMode>,
  );
  void ctl.start();
}

void boot();
