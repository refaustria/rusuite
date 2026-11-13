// The real notes core in Node tests: `src-wasm/pkg` (`pnpm build:wasm`) loaded synchronously. Tests that need it use
// `describe.runIf(coreAvailable)`; CI's unit-test job runs before the wasm builds, so they are skipped there and
// covered by the e2e suite.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NotesWasmModule } from "../backend";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src-wasm/pkg");
const wasm = path.join(pkg, "app_notes_wasm_bg.wasm");

export const coreAvailable = fs.existsSync(wasm);

/** The wasm module (one core host per test file: vitest isolates modules per file). */
export async function loadCore(): Promise<NotesWasmModule> {
  const mod = (await import(/* @vite-ignore */ path.join(pkg, "app_notes_wasm.js"))) as NotesWasmModule & { initSync: (o: { module: Uint8Array }) => void };
  mod.initSync({ module: fs.readFileSync(wasm) });
  return mod;
}
