import { invoke } from "@tauri-apps/api/core";

export interface WasmModule {
  ping(): string;
  dispatch(json: string): string;
}

export interface Backend {
  readonly kind: "tauri" | "wasm";
  ping(): Promise<string>;
  dispatch<T = unknown>(request: unknown): Promise<T>;
}

export class TauriBackend implements Backend {
  readonly kind = "tauri" as const;

  ping(): Promise<string> {
    return invoke<string>("ping");
  }

  async dispatch<T = unknown>(request: unknown): Promise<T> {
    const reply = await invoke<string>("dispatch", {
      request: JSON.stringify(request),
    });
    return JSON.parse(reply) as T;
  }
}

export class WasmBackend implements Backend {
  readonly kind = "wasm" as const;

  constructor(private readonly module: WasmModule) {}

  async ping(): Promise<string> {
    return this.module.ping();
  }

  async dispatch<T = unknown>(request: unknown): Promise<T> {
    return JSON.parse(this.module.dispatch(JSON.stringify(request))) as T;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Picks the Tauri backend inside the desktop shell, else loads WASM. */
export async function createBackend(
  loadWasm: () => Promise<WasmModule>,
): Promise<Backend> {
  if (isTauri()) return new TauriBackend();
  return new WasmBackend(await loadWasm());
}
