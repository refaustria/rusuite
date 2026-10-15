import React from "react";
import ReactDOM from "react-dom/client";
import { createBackend, I18nProvider, type WasmModule } from "@rusuite/ui-shared";
import App from "./App";
import { t } from "./i18n";
import type { Request } from "./generated/Request";
import type { ResponseBody } from "./generated/ResponseBody";
import "./styles.css";

async function loadWasm(): Promise<WasmModule> {
  if (import.meta.env.MODE !== "web") {
    throw new Error("WASM backend is only available in the web build");
  }
  // Produced by `pnpm build:wasm`; only reachable in web mode so the Tauri
  // bundle never includes it.
  // @ts-ignore -- generated, gitignored
  const mod = await import("../src-wasm/pkg/app_calc_wasm.js");
  await mod.default();
  return mod as WasmModule;
}

createBackend<Request, ResponseBody>(loadWasm, { fileTypeLabel: () => t("calc.fileType") }).then((backend) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <App backend={backend} />
      </I18nProvider>
    </React.StrictMode>,
  );
});
