// P8-17: the mapper with merged cells (gridSpan / vMerge ↔ colspan /
// rowspan, continue cells kept on the merge's first cell), floating images
// (`anchor`) and paragraph borders / shading / tabs; convergence against
// the fake and (with WRITE_CORE_WASM) the real core, incl. the reference
// documents 55–57.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { WriteApi } from "../backend";
import type { Anchor } from "../generated/Anchor";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import { backendsUnderTest, type TestBackend } from "../test/backends";
import { makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, posOf, select, type } from "../test/harness";
import { fromPM, tableFromPM } from "./fromPM";
import { blockKey, canonBlock, stableStringify } from "./model";
import { writeExtensions, writeSchema } from "./schema";
import { SyncController, SyncExtension } from "./SyncPlugin";
import { tableToPM, toPM, verticalMerges } from "./toPM";

const BACKENDS = await backendsUnderTest();

type Cell = { id: number; gridSpan?: number; vMerge?: "restart" | "continue"; props?: Record<string, unknown>; blocks: Block[] };
const c = (id: number, text: string, extra: Partial<Cell> = {}): Cell => ({ id, blocks: [para(id + 1000, text)], ...extra });

/** Rows: [Header (span 3)], [Region (restart) | Q1 | Q2], [(continue) | 10 | 12], [(continue) | 5 (span 2)]. */
export function mergedTable(): Block {
  return {
    kind: "table",
    value: {
      id: 10,
      props: { colWidths: [1500, 2000, 2500] },
      rows: [
        { id: 11, cells: [c(20, "Header", { gridSpan: 3 })] },
        { id: 12, cells: [c(21, "Region", { vMerge: "restart" }), c(22, "Q1"), c(23, "Q2")] },
        { id: 13, cells: [c(24, "", { vMerge: "continue" }), c(25, "10"), c(26, "12")] },
        { id: 14, cells: [c(27, "", { vMerge: "continue" }), c(28, "5", { gridSpan: 2 })] },
      ],
    },
  } as Block;
}

/** A 2 × 2 block merged over a whole 2-row table: the second row has continue cells only. */
function fullMerge(): Block {
  return {
    kind: "table",
    value: {
      id: 40,
      rows: [
        { id: 41, cells: [c(42, "all", { gridSpan: 2, vMerge: "restart" })] },
        { id: 43, cells: [c(44, "", { gridSpan: 2, vMerge: "continue" })] },
      ],
    },
  } as Block;
}

const ANCHOR: Anchor = {
  h: { relativeTo: "column", place: { kind: "align", value: "right" } },
  v: { relativeTo: "paragraph", place: { kind: "offset", value: 635 } },
  wrap: "square",
  distance: { top: 0, bottom: 0, left: 114300, right: 114300 },
  allowOverlap: true,
};

const imagePara = (anchor?: Anchor): Block =>
  para(1, [run("x"), { kind: "image", value: { media: 1, width: 952500, height: 476250, ...(anchor ? { anchor } : {}) } }, run("y")]);

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));

describe("merged cells in the mapper", () => {
  const schema = writeSchema();
  const ctx = { schema, numbering: { defs: [] } };

  it("gridSpan → colspan with the grid widths; vMerge → rowspan; continue cells live on the first cell", () => {
    const t = tableToPM(ctx, (mergedTable() as unknown as { value: never }).value);
    const map = TableMap.get(t);
    expect([map.width, map.height]).toEqual([3, 4]);
    const header = t.child(0).child(0);
    expect(header.attrs.colspan).toBe(3);
    expect(header.attrs.colwidth).toEqual([100, 133, 167]);
    const region = t.child(1).child(0);
    expect(region.attrs.rowspan).toBe(3);
    expect((region.attrs.continues as Cell[]).map((x) => x.id)).toEqual([24, 27]);
    expect(t.child(2).childCount).toBe(2);
    expect(t.child(3).childCount).toBe(1);
    expect(t.child(3).child(0).attrs.colspan).toBe(2);
    expect(map.problems).toBeNull();
  });

  it("round trip: tableFromPM(tableToPM(t)) equals t", () => {
    for (const b of [mergedTable(), fullMerge()]) {
      const t = tableToPM(ctx, (b as unknown as { value: never }).value);
      expect(blockKey({ kind: "table", value: tableFromPM(t) })).toBe(blockKey(b));
    }
  });

  it("a row of continue cells only becomes an empty row and comes back", () => {
    const t = tableToPM(ctx, (fullMerge() as unknown as { value: never }).value);
    expect(t.child(1).childCount).toBe(0);
    expect(t.child(0).child(0).attrs.rowspan).toBe(2);
    t.check();
    expect(tableFromPM(t).rows[1]!.cells).toEqual([expect.objectContaining({ id: 44, vMerge: "continue", gridSpan: 2 })]);
  });

  it("verticalMerges: an orphan continue cell stays a cell of its own", () => {
    const t = (mergedTable() as unknown as { value: { rows: { cells: Cell[] }[] } }).value;
    t.rows[1]!.cells[0]!.vMerge = undefined;
    const { continues, covered } = verticalMerges(t as never);
    expect(continues.size).toBe(0);
    expect(covered.size).toBe(0);
    const pm = tableToPM(ctx, t as never);
    expect(pm.child(2).child(0).attrs.vMerge).toBe("continue");
    expect(blockKey({ kind: "table", value: tableFromPM(pm) })).toBe(blockKey({ kind: "table", value: t } as Block));
  });

  it("a rowspan grown in the editor gets new continue cells", () => {
    const t = tableToPM(ctx, (mergedTable() as unknown as { value: never }).value);
    const json = t.toJSON();
    json.content[1].content[0].attrs.rowspan = 3;
    json.content[1].content[0].attrs.continues = null;
    const back = tableFromPM(schema.nodeFromJSON(json));
    expect(back.rows[2]!.cells[0]).toEqual(expect.objectContaining({ vMerge: "continue" }));
    expect(back.rows[3]!.cells[0]!.vMerge).toBe("continue");
    expect(back.rows[3]!.cells[0]!.id).toBeLessThan(0);
  });

  it("whole documents round trip (toPM / fromPM)", () => {
    const doc = makeDoc([para(1, "a"), mergedTable(), fullMerge(), imagePara(ANCHOR)]);
    expect(canon(fromPM(toPM(doc, schema)))).toBe(canon(doc.body));
  });

  it("canonBlock tells merged and unmerged tables apart", () => {
    const a = mergedTable();
    const b = structuredClone(a) as { value: { rows: { cells: Cell[] }[] } };
    b.value.rows[0]!.cells[0]!.gridSpan = 2;
    expect(blockKey(a)).not.toBe(blockKey(b as never));
    const d = structuredClone(a) as { value: { rows: { cells: Cell[] }[] } };
    d.value.rows[2]!.cells[0]!.vMerge = undefined;
    expect(blockKey(a)).not.toBe(blockKey(d as never));
  });

  it("typing next to a merged cell maps to InsertText (not ReplaceBlocks)", () => {
    const editor = makeEditor(makeDoc([mergedTable()]));
    select(editor, 1025, 2);
    const r = change(editor, () => type(editor, "0"));
    expect(r?.command).toEqual(expect.objectContaining({ type: "insertText", block: 1025, offset: 2, text: "0" }));
    editor.destroy();
  });

  it("typing in the merged cell itself maps to InsertText", () => {
    const editor = makeEditor(makeDoc([mergedTable()]));
    select(editor, 1021, 6);
    const r = change(editor, () => type(editor, "s"));
    expect(r?.command).toEqual(expect.objectContaining({ type: "insertText", block: 1021, offset: 6, text: "s" }));
    editor.destroy();
  });
});

describe("floating images in the mapper", () => {
  it("anchor round trips through the image node", () => {
    const doc = makeDoc([imagePara(ANCHOR)]);
    const pm = toPM(doc, writeSchema());
    expect(pm.child(0).child(1).attrs.anchor).toEqual(ANCHOR);
    expect(canon(fromPM(pm))).toBe(canon(doc.body));
  });

  it("changing the anchor attribute maps to SetImageAnchor; removing it to anchor null", () => {
    const editor = makeEditor(makeDoc([imagePara()]));
    const pos = posOf(editor, 1, 1);
    let r = change(editor, () => editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, anchor: ANCHOR })));
    expect(r?.command).toEqual({ type: "setImageAnchor", block: 1, offset: 1, anchor: ANCHOR });
    r = change(editor, () => editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, anchor: null })));
    expect(r?.command).toEqual({ type: "setImageAnchor", block: 1, offset: 1, anchor: null });
    editor.destroy();
  });

  it("resizing a floating image keeps SetImageSize only", () => {
    const editor = makeEditor(makeDoc([imagePara(ANCHOR)]));
    const pos = posOf(editor, 1, 1);
    const r = change(editor, () => editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, width: 100000 })));
    expect(r?.command).toEqual({ type: "setImageSize", block: 1, offset: 1, width: 100000, height: 476250 });
    editor.destroy();
  });
});

describe("paragraph borders, shading and tabs in the mapper", () => {
  it("adding a border through the extra attribute maps to SetParagraphProps", () => {
    const editor = makeEditor(makeDoc([para(1, "a")]));
    const bottom = { style: "single" as const, width: 10, color: { kind: "auto" as const } };
    const r = change(editor, () => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, extra: { borders: { bottom } } })));
    expect(r?.command).toEqual({ type: "setParagraphProps", blocks: [1], patch: { borders: { bottom } } });
    editor.destroy();
  });

  it("adding a tab stop maps to SetParagraphProps; removing one cannot be a merge patch (ReplaceBlocks)", () => {
    const editor = makeEditor(makeDoc([para(1, "a", { tabs: [{ pos: 1440, kind: "left" }] })]));
    let r = change(editor, () =>
      editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, extra: { tabs: [{ pos: 1440, kind: "left" }, { pos: 2880, kind: "right" }] } })),
    );
    expect(r?.command.type).toBe("setParagraphProps");
    r = change(editor, () => editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, extra: null })));
    expect(r?.command.type).toBe("replaceBlocks");
    editor.destroy();
  });
});

// ----- convergence ----------------------------------------------------------------------

interface Setup {
  backend: TestBackend;
  ctl: SyncController;
  editor: Editor;
}
let current: Setup | null = null;
afterEach(() => {
  current?.editor.destroy();
  current = null;
});

async function setup(backend: TestBackend, doc: Document | null): Promise<Setup> {
  const ctl = new SyncController(new WriteApi(backend));
  const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), SyncExtension(ctl)] });
  current = { backend, ctl, editor };
  if (doc) await ctl.load(doc);
  return current;
}

async function rustBody(backend: TestBackend): Promise<Block[]> {
  const reply = (await backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  return reply.ok.doc.body;
}

async function expectConverged(s: Setup) {
  await s.ctl.idle();
  expect(canon(fromPM(s.editor.state.doc))).toBe(canon(await rustBody(s.backend)));
}

describe.each(BACKENDS)("P8-17 sync against the $name backend", ({ name, make }) => {
  it("a merged table loads, typing in it converges without mismatches", async () => {
    const s = await setup(make(), makeDoc([para(1, "x"), mergedTable()]));
    select(s.editor, 1028, 1);
    // (The fake reports the whole table for a cell edit: let it answer before the next keystroke.)
    for (const ch of "00") {
      type(s.editor, ch);
      await s.ctl.idle();
    }
    select(s.editor, 1021, 0);
    type(s.editor, "R");
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
  });

  it("a floating image: anchor change converges", async () => {
    const s = await setup(make(), makeDoc([imagePara()]));
    const pos = posOf(s.editor, 1, 1);
    s.editor.view.dispatch(s.editor.state.tr.setNodeMarkup(pos, undefined, { ...s.editor.state.doc.nodeAt(pos)!.attrs, anchor: ANCHOR }));
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
    await s.ctl.run({ type: "setImageWrap", block: 1, offset: 1, wrap: "behind" });
    expect((s.editor.state.doc.nodeAt(pos)!.attrs.anchor as Anchor).wrap).toBe("behind");
    await expectConverged(s);
  });

  it.runIf(name === "real core")("mergeCells / splitCell patches show as rowspan / colspan", async () => {
    const t = {
      kind: "table",
      value: { id: 10, props: { colWidths: [1500, 1500] }, rows: [{ id: 11, cells: [c(20, "a"), c(21, "b")] }, { id: 12, cells: [c(22, "c"), c(23, "d")] }] },
    } as Block;
    const s = await setup(make(), makeDoc([para(1, "x"), t]));
    await s.ctl.run({ type: "mergeCells", table: 10, top: 0, left: 0, bottom: 1, right: 0 });
    const table = s.editor.state.doc.child(1);
    expect(table.child(0).child(0).attrs.rowspan).toBe(2);
    expect(table.child(1).childCount).toBe(1);
    await expectConverged(s);
    await s.ctl.run({ type: "mergeCells", table: 10, top: 0, left: 0, bottom: 1, right: 1 });
    expect(s.editor.state.doc.child(1).child(0).child(0).attrs.colspan).toBe(2);
    expect(s.editor.state.doc.child(1).child(1).childCount).toBe(0);
    await expectConverged(s);
    await s.ctl.run({ type: "splitCell", table: 10, row: 0, col: 0, rows: 2, cols: 2 });
    expect(TableMap.get(s.editor.state.doc.child(1)).map).toHaveLength(4);
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
  });

  it.runIf(name === "real core")("table style and paragraph formatting patches converge", async () => {
    const s = await setup(make(), makeDoc([para(1, "a\tb", {}), mergedTable()]));
    await s.ctl.run({ type: "setTableProps", table: 10, patch: { style: "GridTable4-Accent1", look: { firstRow: true, lastRow: false, firstCol: true, lastCol: false, bandedRows: true, bandedCols: false } } });
    expect((s.editor.state.doc.child(1).attrs.props as { style?: string }).style).toBe("GridTable4-Accent1");
    expect(s.ctl.styles?.styles.some((x) => x.id === "GridTable4-Accent1")).toBe(true);
    await s.ctl.run({ type: "setParagraphProps", blocks: [1], patch: { borders: { bottom: { style: "single", width: 10, color: { kind: "auto" }, space: 1 } }, tabs: [{ pos: 2880, kind: "center", leader: "dot" }] } });
    expect((s.editor.state.doc.child(0).attrs.extra as { tabs: unknown[] }).tabs).toHaveLength(1);
    await expectConverged(s);
  });
});

// The P8-14 reference documents through the real core: open, round trip, edit, converge.
const real = BACKENDS.find((b) => b.name === "real core");
describe.runIf(real)("provisional-55…57 through the real core", () => {
  const files = ["provisional-55-table-merged-cells.docx", "provisional-56-images-floating.docx", "provisional-57-paragraph-borders-shading-tabs.docx"];
  for (const name of files) {
    it(`${name}: opens, round trips, edits converge without mismatches`, async () => {
      type NodeProcess = { getBuiltinModule(n: string): { readFileSync(p: string): Uint8Array } };
      const fs = (globalThis as unknown as { process: NodeProcess }).process.getBuiltinModule("fs");
      const bytes = fs.readFileSync(new URL(`../../../../testdata/docx/${name}`, import.meta.url).pathname.replace(/^\/@fs/, ""));
      const s = await setup(real!.make(), null);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      expect(await s.ctl.openDocx(btoa(bin), name)).toBe(true);
      s.editor.state.doc.check();
      // The editor holds exactly what Rust has (merged cells, anchors, borders, tabs), and opening sent nothing back
      // (no table normalisation by the table plugin).
      await expectConverged(s);
      expect(s.backend.log.filter((r) => r.type === "apply")).toEqual([]);
      // Type at the end of every textblock (cells included).
      const ids: number[] = [];
      s.editor.state.doc.descendants((n) => {
        if (n.isTextblock && n.attrs.id != null) ids.push(n.attrs.id as number);
        return !n.isTextblock;
      });
      for (const id of ids) {
        const node = s.editor.state.doc.nodeAt(posOf(s.editor, id, 0) - 1)!;
        let len = 0;
        node.forEach((ch) => (len += ch.isText ? [...ch.text!].length : 1));
        select(s.editor, id, len);
        type(s.editor, "Z");
      }
      // Re-anchor every image (wrap changes) and move it.
      const images: number[] = [];
      s.editor.state.doc.descendants((n, pos) => {
        if (n.type.name === "image") images.push(pos);
        return true;
      });
      for (const pos of images) {
        const attrs = s.editor.state.doc.nodeAt(pos)!.attrs;
        const anchor: Anchor = attrs.anchor ? { ...attrs.anchor, wrap: "tight" } : { ...ANCHOR };
        const tr = s.editor.state.tr.setNodeMarkup(pos, undefined, { ...attrs, anchor });
        s.editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
      }
      await expectConverged(s);
      expect(s.ctl.stats.mismatches).toBe(0);
      expect(s.ctl.stats.reloads).toBe(0);
    });
  }
});
