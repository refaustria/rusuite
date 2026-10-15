import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Heavy editor dependencies get their own chunk (cached across app updates).
const manualChunks = (id: string) => (/node_modules\/(@tiptap|prosemirror-[^/]+|orderedmap|rope-sequence|w3c-keyname|linkifyjs|crelt)\//.test(id) ? "tiptap" : undefined);

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  ...(mode === "web"
    ? { base: "/write/", build: { outDir: "dist-web", rollupOptions: { output: { manualChunks } } } }
    : {
        // The wasm package only exists for the web build; keep it out of the
        // Tauri bundle (the import is unreachable there and gets dropped).
        build: { rollupOptions: { external: [/src-wasm\/pkg\//], output: { manualChunks } } },
      }),
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
  },
}));
