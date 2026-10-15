import React from "react";
import ReactDOM from "react-dom/client";
import { createBackend, type WasmModule } from "@rusuite/ui-shared";
import App from "./App";
import type { ShowBackend } from "./backend";
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

createBackend(loadWasm, { accept: `.pptx,${PPTX_MIME}`, mime: PPTX_MIME }).then((backend) => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App backend={backend as ShowBackend} />
    </React.StrictMode>,
  );
});
