import { sharedTest } from "../../vitest.shared";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Heavy editor dependencies get their own chunk (cached across app updates).
const manualChunks = (id: string) =>
  /node_modules\/(@tiptap|prosemirror-[^/]+|orderedmap|rope-sequence|w3c-keyname|linkifyjs|crelt)\//.test(id)
    ? "tiptap"
    : /node_modules\/(loro-crdt|loro-prosemirror|lib0)\//.test(id)
      ? "loro"
      : undefined;

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // The app (dev and build) uses loro-crdt's `web` build: its wasm is fetched as a hashed asset of the app and
  // instantiated asynchronously by `initLoro()` (src/loro.ts) before anything touches Loro. The default browser
  // build would load it with a synchronous XMLHttpRequest. Tests run on Node and keep the `nodejs` build.
  resolve: mode === "test" ? undefined : { alias: [{ find: /^loro-crdt$/, replacement: "loro-crdt/web" }] },
  ...(mode === "web" ? { base: "/notes/", build: { outDir: "dist-web", target: "es2022", rollupOptions: { output: { manualChunks } } } } : {}),
  // The desktop shell (P11-N7) converts natively: the converter module is never loaded there (and not built).
  ...(mode === "desktop"
    ? { build: { outDir: "dist", target: "es2022", rollupOptions: { external: [/src-wasm-convert\/pkg\//], output: { manualChunks } } } }
    : {}),
  // The converter worker (P11-X1) imports the converter module: ES module workers keep its wasm a separate asset.
  // On the desktop it is never loaded (native converters), and its module is not built there.
  worker: { format: "es" as const, ...(mode === "desktop" ? { rollupOptions: { external: [/src-wasm-convert\/pkg\//] } } : {}) },
  optimizeDeps: { exclude: ["loro-crdt"] },
  envPrefix: mode === "desktop" ? ["VITE_", "TAURI_", "REPORT_RELAY_"] : ["VITE_"],
  server: {
    port: 1424,
    strictPort: true,
  },
  test: {
    ...sharedTest,
    setupFiles: ["./src/test-setup.ts"],
  },
}));
