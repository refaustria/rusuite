import { describe, expect, it } from "vitest";
import { paginate } from "./notesPrint";

describe("notes print pagination", () => {
  it("packs blocks onto sheets; a block taller than a sheet gets its own", () => {
    const b = (top: number, bottom: number) => ({ top, bottom });
    expect(paginate([b(0, 40), b(40, 90), b(90, 130)], 100)).toEqual([[0, 1], [2]]);
    expect(paginate([b(0, 30), b(30, 300), b(300, 320)], 100)).toEqual([[0], [1], [2]]);
    expect(paginate([], 100)).toEqual([]);
  });
});
