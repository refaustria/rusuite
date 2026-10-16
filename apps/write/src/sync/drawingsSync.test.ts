// P8-34: shapes and text boxes against the fake and (with WRITE_CORE_WASM)
// the real core — a Rust-first InsertDrawing, text typed in the text box
// (the node's value as the nested editor writes it), shape changes; the
// reference documents 61 (shapes, text boxes) and 62 (character
// formatting) opened, edited and converged.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { WriteApi } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Drawing } from "../generated/Drawing";
import { backendsUnderTest, type TestBackend } from "../test/backends";
import { makeDoc, para } from "../test/fixtures";
import { posOf, select, type } from "../test/harness";
import { fromPM } from "./fromPM";
import { canonBlock, canonDrawing, stableStringify } from "./model";
import { writeExtensions } from "./schema";
import { SyncController, SyncExtension } from "./SyncPlugin";

const BACKENDS = await backendsUnderTest();

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

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));

async function expectConverged(s: Setup) {
  await s.ctl.idle();
  const reply = (await s.backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  expect(canon(fromPM(s.editor.state.doc))).toBe(canon(reply.ok.doc.body));
}

/** Every drawing node: [pos, value]. */
function drawings(editor: Editor): [number, Drawing][] {
  const out: [number, Drawing][] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "drawing") out.push([pos, n.attrs.value as Drawing]);
    return true;
  });
  return out;
}

/** What the nested editor does on typing: the drawing's text blocks with `text` appended to the first paragraph. */
function typeInDrawing(editor: Editor, pos: number, text: string) {
  const d = structuredClone(editor.state.doc.nodeAt(pos)!.attrs.value as Drawing);
  const first = d.text!.blocks.find((b) => b.kind === "paragraph");
  if (!first || first.kind !== "paragraph") return;
  first.value.inlines = [...(first.value.inlines ?? []), { kind: "run", value: { text } }];
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing(d) }));
}

describe.each(BACKENDS)("P8-34 drawings against the $name backend", ({ make }) => {
  it("InsertDrawing, typing in the shape and a shape change converge without mismatches", async () => {
    const s = await setup(make(), makeDoc([para(1, "Hello"), para(2, "after")]));
    await s.ctl.run({ type: "insertDrawing", block: 1, offset: 2, kind: "shape", preset: "roundRect", width: 900000, height: 900000, text: "" });
    const [[pos]] = drawings(s.editor) as [[number, Drawing]];
    for (const ch of "Hi!") {
      typeInDrawing(s.editor, drawings(s.editor)[0]![0], ch);
      await s.ctl.idle();
    }
    const d = structuredClone(drawings(s.editor)[0]![1]);
    s.editor.view.dispatch(s.editor.state.tr.setNodeMarkup(pos, undefined, { value: canonDrawing({ ...d, preset: "ellipse", rotation: 30 }) }));
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
    expect(s.ctl.stats.reloads).toBe(0);
    const text = drawings(s.editor)[0]![1].text!.blocks[0]!;
    expect(text.kind === "paragraph" && text.value.inlines?.[0]).toMatchObject({ kind: "run", value: { text: "Hi!" } });
  });

  it("a text box next to typed body text: undo restores the same ids", async () => {
    const s = await setup(make(), makeDoc([para(1, "x")]));
    await s.ctl.run({ type: "insertDrawing", block: 1, offset: 1, kind: "textBox", preset: "rect", width: 1800000, height: 900000, text: "Box" });
    const before = canon(fromPM(s.editor.state.doc));
    select(s.editor, 1, 0);
    type(s.editor, "A");
    typeInDrawing(s.editor, drawings(s.editor)[0]![0], "!");
    await expectConverged(s);
    s.ctl.undo();
    s.ctl.undo();
    await expectConverged(s);
    expect(canon(fromPM(s.editor.state.doc))).toBe(before);
  });
});

const real = BACKENDS.find((b) => b.name === "real core");
describe.runIf(real)("provisional-61 / 62 through the real core", () => {
  for (const name of ["provisional-61-shapes-text-boxes.docx", "provisional-62-character-formatting.docx"]) {
    it(`${name}: opens, edits (body and text boxes) converge without mismatches`, async () => {
      type NodeProcess = { getBuiltinModule(n: string): { readFileSync(p: string): Uint8Array } };
      const fs = (globalThis as unknown as { process: NodeProcess }).process.getBuiltinModule("fs");
      const bytes = fs.readFileSync(new URL(`../../../../testdata/docx/${name}`, import.meta.url).pathname.replace(/^\/@fs/, ""));
      const s = await setup(real!.make(), null);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      expect(await s.ctl.openDocx(btoa(bin), name)).toBe(true);
      s.editor.state.doc.check();
      await expectConverged(s);
      expect(s.backend.log.filter((r) => r.type === "apply")).toEqual([]);
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
      for (const [pos, d] of drawings(s.editor)) if (d.text) typeInDrawing(s.editor, pos, "Q");
      await expectConverged(s);
      expect(s.ctl.stats.mismatches).toBe(0);
      expect(s.ctl.stats.reloads).toBe(0);
    });
  }
});
