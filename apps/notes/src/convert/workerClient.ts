// The web app's converter module behind a Web Worker (P11-X1, `worker.ts`): the same calls as the wasm module, as
// promises. `terminate()` (Cancel) stops a running conversion at once; the next use starts a new worker.

import { ConvertCancelled, type ConvertWasmModule } from "./loader";

interface Reply {
  id: number;
  ok?: unknown;
  err?: string;
  load?: boolean;
}

export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<Reply>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

/** Starts the worker and resolves once its module is instantiated (rejects when it cannot load). */
export async function workerConverter(create: () => WorkerLike): Promise<ConvertWasmModule> {
  const w = create();
  let next = 1;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const failAll = (e: unknown) => {
    for (const p of waiting.values()) p.reject(e);
    waiting.clear();
  };
  w.onmessage = (ev) => {
    const r = ev.data;
    const p = waiting.get(r.id);
    if (!p) return;
    waiting.delete(r.id);
    if (r.err !== undefined) p.reject(r.load ? new Error(r.err) : r.err);
    else p.resolve(r.ok);
  };
  w.onerror = (ev) => {
    ev.preventDefault?.();
    failAll(new Error(ev.message || "the converter worker failed"));
  };
  const call = <T>(fn: string, ...args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, fn, args });
    });
  const version = await call<string>("ping").catch((e: unknown) => {
    w.terminate();
    throw e;
  });
  return {
    ping: () => version,
    import_file: (request, bytes) => call<Uint8Array>("import_file", request, bytes),
    export_file: (request, blobs) => call<Uint8Array>("export_file", request, blobs),
    paste_html: (request) => call<Uint8Array>("paste_html", request),
    terminate: () => {
      w.terminate();
      failAll(new ConvertCancelled());
    },
  };
}
