import { defineConfig } from "vitest/config";
import { sharedTest } from "../../vitest.shared";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { ...sharedTest, setupFiles: ["./src/test-setup.ts"] },
});
