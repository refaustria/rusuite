import { describe, expect, it } from "vitest";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import { FIXTURES, li, makeDoc, para, run } from "../test/fixtures";
import { fromPM } from "./fromPM";
import { canonBlock, stableStringify, type RunProperties } from "./model";
import { writeSchema } from "./schema";
import { toPM } from "./toPM";

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));

function roundtrip(doc: Document): Block[] {
  const pm = toPM(doc, writeSchema());
  pm.check();
  return fromPM(pm);
}

describe("fromPM(toPM(doc)) == doc", () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`fixture ${name}`, () => {
      expect(canon(roundtrip(doc))).toBe(canon(doc.body));
    });
  }

  it("renders headings, title, lists and tables as the expected node types", () => {
    const s = writeSchema();
    const types = (d: Document) => {
      const out: string[] = [];
      toPM(d, s).forEach((n) => out.push(n.type.name));
      return out;
    };
    expect(types(FIXTURES.headings!)).toEqual(["title", "heading", "heading", "heading", "paragraph", "paragraph"]);
    expect(types(FIXTURES.lists3!)).toEqual([
      "paragraph", "bulletList", "orderedList", "paragraph", "bulletList", "orderedList", "paragraph",
    ]);
    expect(types(FIXTURES.table!)).toEqual(["paragraph", "table", "paragraph"]);
  });

  it("nests three list levels", () => {
    const pm = toPM(FIXTURES.lists3!, writeSchema());
    const list = pm.child(1);
    expect(list.attrs).toMatchObject({ numId: 1, level: 0, kind: "bullet" });
    const l1 = list.child(0).child(1);
    expect(l1.type.name).toBe("bulletList");
    expect(l1.attrs.level).toBe(1);
    expect(l1.child(0).child(1).attrs.level).toBe(2);
  });

  it("random documents (seeded property test)", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const propsPool: (RunProperties | undefined)[] = [
      undefined, { bold: true }, { italic: true, underline: "single" }, { size: 1400 }, { bold: false }, { verticalAlign: "subscript" },
    ];
    for (let iter = 0; iter < 200; iter++) {
      let id = 1;
      const body: Block[] = [];
      const n = 1 + rnd(12);
      for (let i = 0; i < n; i++) {
        const runs = Array.from({ length: rnd(4) }, () => run(["a", "bc", "dé", "😀", " "][rnd(5)]!, propsPool[rnd(propsPool.length)]));
        const kind = rnd(6);
        if (kind === 0) body.push(li(id++, "", 1 + rnd(2), rnd(4)));
        else if (kind === 1) body.push(para(id++, runs, { style: ["Heading1", "Title", "ListParagraph"][rnd(3)]! }));
        else if (kind === 2) body.push(para(id++, runs, { numbering: { numId: 1 + rnd(2), level: rnd(3) } }));
        else body.push(para(id++, runs));
      }
      const doc = makeDoc(body);
      expect(canon(roundtrip(doc))).toBe(canon(body));
    }
  });
});
