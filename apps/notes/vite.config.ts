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
  optimizeDeps: { exclude: ["loro-crdt"] },
  envPrefix: ["VITE_"],
  server: {
    port: 1424,
    strictPort: true,
  },
  test: {
    ...sharedTest,
    setupFiles: ["./src/test-setup.ts"],
  },
}));
