import { describe, expect, it } from "vitest";
import { decodeEffects, encodeEffects, frameRecords, splitRecords, type PersistEffect } from "./effects";

describe("persist effects framing", () => {
  it("decodes the core's layout byte by byte", () => {
    // count=1, kind=1 (append), notebook "nb" (u16 2), doc "d" (u16 1), bytes [7, 8] (u32 2)
    const raw = Uint8Array.of(1, 0, 0, 0, 1, 2, 0, 0x6e, 0x62, 1, 0, 0x64, 2, 0, 0, 0, 7, 8);
    expect(decodeEffects(raw)).toEqual([{ kind: "append", notebook: "nb", doc: "d", bytes: Uint8Array.of(7, 8) }]);
  });

  it("round-trips every kind, UTF-8 names included", () => {
    const effects: PersistEffect[] = [
      { kind: "append", notebook: "nb-1", doc: "pg-ä", bytes: Uint8Array.of(1, 2, 3) },
      { kind: "replace", notebook: "nb-1", doc: "nb-1", bytes: new Uint8Array(300).fill(9) },
      { kind: "delete", notebook: "nb-1", doc: "pg-2" },
      { kind: "blob", notebook: "nb-1", doc: "ab".repeat(32), bytes: Uint8Array.of(0) },
    ];
    expect(decodeEffects(encodeEffects(effects))).toEqual(effects);
  });

  it("treats the drained queue (count 0) and empty input as no effects", () => {
    expect(decodeEffects(Uint8Array.of(0, 0, 0, 0))).toEqual([]);
    expect(decodeEffects(new Uint8Array())).toEqual([]);
  });

  it("rejects truncated data and unknown kinds", () => {
    const ok = encodeEffects([{ kind: "append", notebook: "n", doc: "d", bytes: Uint8Array.of(1, 2) }]);
    expect(() => decodeEffects(ok.slice(0, ok.length - 1))).toThrow(/truncated/);
    const bad = ok.slice();
    bad[4] = 9;
    expect(() => decodeEffects(bad)).toThrow(/unknown kind/);
  });

  it("frames log records and drops a truncated tail", () => {
    const framed = frameRecords([Uint8Array.of(1), Uint8Array.of(2, 3)]);
    expect(Array.from(framed)).toEqual([1, 0, 0, 0, 1, 2, 0, 0, 0, 2, 3]);
    expect(splitRecords(framed)).toEqual([Uint8Array.of(1), Uint8Array.of(2, 3)]);
    expect(splitRecords(framed.slice(0, 9))).toEqual([Uint8Array.of(1)]);
  });
});
