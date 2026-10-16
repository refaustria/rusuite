import { sharedTest } from "../../vitest.shared";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Heavy editor dependencies get their own chunk (cached across app updates).
const manualChunks = (id: string) => (/node_modules\/(konva|react-konva|its-fine|react-reconciler|scheduler)\//.test(id) ? "konva" : undefined);

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  ...(mode === "web"
    ? { base: "/show/", build: { outDir: "dist-web", rollupOptions: { output: { manualChunks } } } }
    : {
        // The wasm package only exists for the web build; keep it out of the
        // Tauri bundle (the import is unreachable there and gets dropped).
        build: { rollupOptions: { external: [/src-wasm\/pkg\//], output: { manualChunks } } },
      }),
  envPrefix: ["VITE_", "TAURI_", "REPORT_RELAY_"], // REPORT_RELAY_URL: the desktop report relay (P8-43)
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    ...sharedTest,
    setupFiles: ["./src/test-setup.ts"],
  },
}));
