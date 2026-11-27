// The converter behind a worker (P11-X1): calls as promises, the worker's thrown error replies, a failed load,
// and Cancel (terminate) rejecting the running call with `ConvertCancelled` and starting over on the next use.

import { describe, expect, it, vi } from "vitest";
import { ConvertCancelled, ConvertLoadError, LazyConverter } from "./loader";
import { workerConverter, type WorkerLike } from "./workerClient";

type Msg = { id: number; fn: string; args: unknown[] };

/** A scripted worker: `answer` decides each reply (undefined = never answers, like a long conversion). */
function fakeWorker(answer: (m: Msg) => Record<string, unknown> | undefined) {
  const w: WorkerLike & { terminated: boolean; calls: Msg[] } = {
    terminated: false,
    calls: [],
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      const m = msg as Msg;
      w.calls.push(m);
      const r = answer(m);
      if (r) queueMicrotask(() => w.onmessage?.({ data: { id: m.id, ...r } } as MessageEvent));
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

describe("workerConverter", () => {
  it("answers calls with the worker's results and passes thrown error replies on as strings", async () => {
    const w = fakeWorker((m) => (m.fn === "ping" ? { ok: "conv 1" } : m.fn === "import_file" ? { ok: new Uint8Array([1, 2]) } : { err: '{"error":"x"}' }));
    const m = await workerConverter(() => w);
    expect(m.ping()).toBe("conv 1");
    expect(await m.import_file("{}", new Uint8Array())).toEqual(new Uint8Array([1, 2]));
    await expect(m.paste_html("{}")).rejects.toBe('{"error":"x"}');
  });

  it("a module that cannot load rejects and the worker is stopped", async () => {
    const w = fakeWorker(() => ({ err: "Failed to fetch", load: true }));
    await expect(workerConverter(() => w)).rejects.toThrow("Failed to fetch");
    expect(w.terminated).toBe(true);
  });

  it("Cancel stops the running conversion; the next use starts a new worker", async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const c = new LazyConverter(() =>
      workerConverter(() => {
        const w = fakeWorker((m) => (m.fn === "ping" ? { ok: "conv" } : workers.length > 1 ? { ok: new Uint8Array([7]) } : undefined));
        workers.push(w);
        return w;
      }),
    );
    expect(c.cancellable).toBe(true);
    const running = c.importFile({ kind: "markdown", name: "a.md" } as never, new Uint8Array());
    await vi.waitFor(() => expect(workers[0]?.calls.some((m) => m.fn === "import_file")).toBe(true));
    c.cancel();
    await expect(running).rejects.toBeInstanceOf(ConvertCancelled);
    expect(workers[0]!.terminated).toBe(true);
    expect(c.loaded).toBe(false);
    expect(await c.importFile({ kind: "markdown", name: "a.md" } as never, new Uint8Array())).toEqual(new Uint8Array([7]));
    expect(workers).toHaveLength(2);
  });

  it("Cancel while the module is still loading stops it once it arrives", async () => {
    let release!: () => void;
    const terminate = vi.fn();
    const c = new LazyConverter(
      () =>
        new Promise((r) => {
          release = () => r({ ping: () => "x", import_file: () => new Uint8Array(), export_file: () => new Uint8Array(), paste_html: () => new Uint8Array(), terminate });
        }),
    );
    const p = c.module();
    c.cancel();
    release();
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvertCancelled);
    expect(err).not.toBeInstanceOf(ConvertLoadError);
    expect(terminate).toHaveBeenCalled();
  });
});
