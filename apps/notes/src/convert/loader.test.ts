import { describe, expect, it, vi } from "vitest";
import { ConvertLoadError, decodeFrame, encodeFrame, LazyConverter, type ConvertWasmModule } from "./loader";

const fake = (): ConvertWasmModule => ({
  ping: () => "Rusuite Notes converters test",
  import_file: () => new Uint8Array(),
  export_file: () => new Uint8Array(),
  paste_html: () => new Uint8Array(),
});

describe("LazyConverter", () => {
  it("loads the module once, on first use", async () => {
    const load = vi.fn(async () => fake());
    const c = new LazyConverter(load);
    expect(load).not.toHaveBeenCalled();
    expect(c.loaded).toBe(false);
    const [a, b] = await Promise.all([c.module(), c.module()]);
    expect(a).toBe(b);
    await c.module();
    expect(load).toHaveBeenCalledTimes(1);
    expect(c.loaded).toBe(true);
  });

  it("reports loading while the module is fetched", async () => {
    let release!: (m: ConvertWasmModule) => void;
    const c = new LazyConverter(() => new Promise((r) => (release = r)));
    const seen: boolean[] = [];
    c.onLoading = (l) => seen.push(l);
    const p = c.module();
    expect(seen).toEqual([true]);
    release(fake());
    await p;
    expect(seen).toEqual([true, false]);
  });

  it("a failed load is an error with a message and can be retried", async () => {
    const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")).mockResolvedValueOnce(fake());
    const c = new LazyConverter(load);
    const err = await c.module().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConvertLoadError);
    expect((err as Error).message).toMatch(/converters could not be loaded/i);
    expect((err as Error).message).toContain("Failed to fetch");
    expect(c.loaded).toBe(false);
    await expect(c.module()).resolves.toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("thrown JSON error replies become CoreErrors", async () => {
    const m = fake();
    m.import_file = () => {
      throw JSON.stringify({ err: { code: "format", message: "not a OneNote file" } });
    };
    const c = new LazyConverter(async () => m);
    await expect(c.importFile({ kind: "oneNote", fileName: "x.one" }, new Uint8Array())).rejects.toMatchObject({ code: "format", message: "not a OneNote file" });
  });
});

describe("frames", () => {
  it("round-trip the JSON and the blobs", () => {
    const f = encodeFrame('{"a":1}', [new Uint8Array([1, 2]), new Uint8Array()]);
    const d = decodeFrame(f);
    expect(d.json).toBe('{"a":1}');
    expect(d.blobs.map((b) => Array.from(b))).toEqual([[1, 2], []]);
    expect(() => decodeFrame(f.slice(0, 3))).toThrow();
  });
});
