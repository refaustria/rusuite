import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  ...(mode === "web"
    ? { base: "/calc/", build: { outDir: "dist-web" } }
    : {
        // The wasm package only exists for the web build; keep it out of the
        // Tauri bundle (the import is unreachable there and gets dropped).
        build: { rollupOptions: { external: [/src-wasm\/pkg\//] } },
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
