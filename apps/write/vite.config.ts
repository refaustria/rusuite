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
    // The App-level UI tests mount the whole editor and wait for each step (`findBy…`/`waitFor` with their own
    // timeouts); alone they take 1–3 s, but under CPU load (the whole repo's `pnpm test` next to a `cargo build`)
    // several exceeded vitest's default 5 s test deadline although every step was still progressing. The waits
    // decide what is checked; the test deadline only guards against hangs.
    testTimeout: 30_000,
  },
}));
