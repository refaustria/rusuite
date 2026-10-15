// Backends for the sync tests: the in-memory fake, and — when the
// `WRITE_CORE_WASM` environment variable points to a `wasm-pack --target
// nodejs` build of a shell that calls `write_core::dispatch_with` — the
// real Rust core.

import type { WriteBackend } from "../backend";
import type { Request } from "../generated/Request";
import { FakeWriteBackend } from "./fakeWriteBackend";

interface WasmCore {
  dispatch(json: string): string;
  ping(): string;
}

let core: WasmCore | null | undefined;

/** The real core, if configured and loadable. */
export async function realCore(): Promise<WasmCore | null> {
  if (core !== undefined) return core;
  type NodeProcess = {
    env?: Record<string, string | undefined>;
    getBuiltinModule?: (name: string) => { createRequire(from: string): (id: string) => unknown };
  };
  const proc = (globalThis as { process?: NodeProcess }).process;
  const path = proc?.env?.WRITE_CORE_WASM;
  core = null;
  if (path && proc?.getBuiltinModule) {
    // Plain Node `require` (outside Vite's module graph): the package lives
    // outside the repository.
    const mod = proc.getBuiltinModule("module").createRequire(import.meta.url)(path) as WasmCore;
    const reply = JSON.parse(mod.dispatch(JSON.stringify({ type: "newDocument" })));
    if (reply.ok?.type === "document") core = mod;
  }
  return core;
}

export class RealCoreBackend implements WriteBackend {
  readonly kind = "wasm" as const;
  readonly log: Request[] = [];
  constructor(private readonly mod: WasmCore) {}
  async ping() {
    return this.mod.ping();
  }
  async dispatch<T>(request: Request) {
    this.log.push(structuredClone(request));
    return JSON.parse(this.mod.dispatch(JSON.stringify(request))) as { ok: T } | { err: { code: string; message: string } };
  }
  async openFile() {
    return null;
  }
  async saveFile() {
    return false;
  }
  async setTitle() {}
  async print() {}
}

export type TestBackend = FakeWriteBackend | RealCoreBackend;

export async function backendsUnderTest(): Promise<{ name: string; make: () => TestBackend }[]> {
  const list: { name: string; make: () => TestBackend }[] = [{ name: "fake", make: () => new FakeWriteBackend() }];
  const mod = await realCore();
  if (mod) list.push({ name: "real core", make: () => new RealCoreBackend(mod) });
  return list;
}
