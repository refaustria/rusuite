import React from "react";
import ReactDOM from "react-dom/client";
import { createBackend, DOCX_MIME, I18nProvider, type WasmModule } from "@rusuite/ui-shared";
import App from "./App";
import { t } from "./i18n";
import type { WriteBackend } from "./backend";
import "./styles.css";

async function loadWasm(): Promise<WasmModule> {
  if (import.meta.env.MODE !== "web") {
    throw new Error("WASM backend is only available in the web build");
  }
  // Produced by `pnpm build:wasm`; only reachable in web mode so the Tauri
  // bundle never includes it.
  // @ts-ignore -- generated, gitignored
  const mod = await import("../src-wasm/pkg/app_write_wasm.js");
  await mod.default();
  return mod as WasmModule;
}

// Word documents and templates (.dotx opens like .docx; File › New makes documents from templates).
const DOTX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.template";
createBackend(loadWasm, { accept: `.docx,.dotx,${DOCX_MIME},${DOTX_MIME}`, mime: DOCX_MIME, fileTypeLabel: () => t("write.fileType") }).then((backend) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <App backend={backend as WriteBackend} />
      </I18nProvider>
    </React.StrictMode>,
  );
});
