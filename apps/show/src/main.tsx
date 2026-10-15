import React from "react";
import ReactDOM from "react-dom/client";
import { createBackend, I18nProvider, type WasmModule } from "@rusuite/ui-shared";
import App from "./App";
import type { ShowBackend } from "./backend";
import { Audience } from "./present/Audience";
import { audienceIdOf } from "./present/sync";
import { t } from "./i18n";
import "./styles.css";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

async function loadWasm(): Promise<WasmModule> {
  if (import.meta.env.MODE !== "web") {
    throw new Error("WASM backend is only available in the web build");
  }
  // Produced by `pnpm build:wasm`; only reachable in web mode so the Tauri
  // bundle never includes it.
  // @ts-ignore -- generated, gitignored
  const mod = await import("../src-wasm/pkg/app_show_wasm.js");
  await mod.default();
  return mod as WasmModule;
}

// The presenter view's audience window (P7-8) renders what the main window sends: no backend.
const audience = audienceIdOf(window.location.search);
if (audience) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <Audience id={audience} />
      </I18nProvider>
    </React.StrictMode>,
  );
} else {
  createBackend(loadWasm, { accept: `.pptx,${PPTX_MIME}`, mime: PPTX_MIME, fileTypeLabel: () => t("show.fileType") }).then((backend) => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <I18nProvider>
          <App backend={backend as ShowBackend} />
        </I18nProvider>
      </React.StrictMode>,
    );
  });
}
