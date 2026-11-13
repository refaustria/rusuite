import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistEffect } from "./effects";
import { Persister } from "./persister";
import { MemoryNotesStore } from "./store";

const eff = (n: number): PersistEffect => ({ kind: "append", notebook: "nb", doc: "d", bytes: Uint8Array.of(n) });

afterEach(() => vi.useRealTimers());

describe("Persister", () => {
  it("batches effects into one write within the delay", async () => {
    vi.useFakeTimers();
    const store = new MemoryNotesStore();
    const apply = vi.spyOn(store, "apply");
    const p = new Persister(store, 200);
    p.enqueue([eff(1)]);
    p.enqueue([eff(2)]);
    expect(p.getState()).toBe("saving");
    await vi.advanceTimersByTimeAsync(199);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toHaveLength(2);
    await vi.runAllTimersAsync();
    expect(p.getState()).toBe("saved");
  });

  it("flushes at once when the page is hidden", async () => {
    const store = new MemoryNotesStore();
    const p = new Persister(store, 10_000);
    const uninstall = p.installPageHooks();
    p.enqueue([eff(1)]);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    await vi.waitFor(() => expect(store.applied).toBe(1));
    window.dispatchEvent(new Event("pagehide"));
    uninstall();
  });

  it("keeps a failed batch and retries it first", async () => {
    const store = new MemoryNotesStore();
    const p = new Persister(store, 10_000);
    const apply = vi.spyOn(store, "apply").mockRejectedValueOnce(new Error("quota"));
    p.enqueue([eff(1)]);
    await p.flush();
    expect(p.getState()).toBe("error");
    p.enqueue([eff(2)]);
    await p.flush();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0].map((e) => (e.kind === "append" ? e.bytes[0] : -1))).toEqual([1, 2]);
    expect(p.getState()).toBe("saved");
  });
});
