// P8-10: SyncController with notes, fields, TOCs, list labels and
// numbering definitions, against the fake (and, with WRITE_CORE_WASM, the
// real) backend.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { WriteApi } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Note } from "../generated/Note";
import { backendsUnderTest, type TestBackend } from "../test/backends";
import { li, makeDoc, para, run } from "../test/fixtures";
import { posOf, press, select, type } from "../test/harness";
import { fromPM, notesFromPM, notesNode } from "./fromPM";
import { canonBlock, canonNote, stableStringify } from "./model";
import { writeExtensions } from "./schema";
import { SyncController, SyncExtension } from "./SyncPlugin";
import { orderNotes } from "./toPM";

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

async function setup(backend: TestBackend, doc: Document): Promise<Setup> {
  const ctl = new SyncController(new WriteApi(backend));
  const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), SyncExtension(ctl)] });
  await ctl.load(doc);
  current = { backend, ctl, editor };
  return current;
}

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));
const canonNotes = (notes: Note[], body: Block[]) => stableStringify(orderNotes(notes, body).map(canonNote));

async function rustDoc(backend: TestBackend): Promise<Document> {
  const reply = (await backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  return reply.ok.doc;
}

/** Body and notes of the editor equal Rust's. */
async function expectConverged({ backend, ctl, editor }: Setup): Promise<void> {
  await ctl.idle();
  const doc = await rustDoc(backend);
  expect(canon(fromPM(editor.state.doc))).toBe(canon(doc.body));
  expect(stableStringify(notesFromPM(editor.state.doc).map(canonNote))).toBe(canonNotes(doc.notes ?? [], doc.body));
}

const labels = (editor: Editor) => {
  const out: (string | null)[] = [];
  editor.state.doc.descendants((n) => {
    if (n.isTextblock) out.push(n.attrs.listLabel ?? null);
    return !n.isTextblock;
  });
  return out;
};

type Cmd = { type: string; commands?: Cmd[] };
const flat = (c: Cmd): string[] => (c.type === "compound" ? (c.commands ?? []).flatMap(flat) : [c.type]);
const sentTypes = (b: TestBackend) => b.log.flatMap((r) => (r.type === "apply" ? flat(r.command as Cmd) : []));

describe.each(BACKENDS)("structure sync against the $name backend", ({ make }) => {
  it("insertFootnote adds the reference and the notes area; typing in the note converges", async () => {
    const s = await setup(make(), makeDoc([para(1, "Hello world")]));
    await s.ctl.run({ type: "insertFootnote", block: 1, offset: 5, text: "", kind: "foot" });
    const area = notesNode(s.editor.state.doc);
    expect(area?.childCount).toBe(1);
    const noteParaId = area!.child(0).child(0).attrs.id as number;
    let refs = 0;
    s.editor.state.doc.child(0).forEach((n) => (refs += n.type.name === "noteRef" ? 1 : 0));
    expect(refs).toBe(1);
    select(s.editor, noteParaId, 1);
    for (const ch of "Note") type(s.editor, ch);
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
    expect(sentTypes(s.backend).slice(-4)).toEqual(["insertText", "insertText", "insertText", "insertText"]);
  });

  it("deleting the reference deletes the note; undo brings both back", async () => {
    const s = await setup(make(), makeDoc([para(1, "Hello")]));
    await s.ctl.run({ type: "insertFootnote", block: 1, offset: 5, text: "n", kind: "end" });
    const at = posOf(s.editor, 1, 5);
    s.editor.view.dispatch(s.editor.state.tr.delete(at, at + 1));
    await s.ctl.idle();
    expect(sentTypes(s.backend)).toContain("deleteFootnote");
    expect(notesNode(s.editor.state.doc)).toBeNull();
    await expectConverged(s);
    s.ctl.undo();
    await expectConverged(s);
    expect(notesNode(s.editor.state.doc)?.childCount).toBe(1);
  });

  it("Enter in a note sends replaceNote and adopts the real id", async () => {
    const s = await setup(make(), makeDoc([para(1, "Body")]));
    await s.ctl.run({ type: "insertFootnote", block: 1, offset: 4, text: "abc", kind: "foot" });
    const noteParaId = notesNode(s.editor.state.doc)!.child(0).child(0).attrs.id as number;
    select(s.editor, noteParaId, 2);
    press(s.editor, "Enter");
    type(s.editor, "x");
    await expectConverged(s);
    const ids: number[] = [];
    notesNode(s.editor.state.doc)!.descendants((n) => {
      if (n.isTextblock) ids.push(n.attrs.id);
    });
    expect(ids.every((id) => id > 0)).toBe(true);
  });

  it("insertField shows the field; updateFields changes its cached result", async () => {
    const s = await setup(make(), makeDoc([para(1, "Page ")]));
    await s.ctl.run({ type: "insertField", block: 1, offset: 5, field: { kind: "page" }, cached: "1" });
    const f = s.editor.state.doc.child(0).child(1);
    expect(f.type.name).toBe("field");
    await s.ctl.run({ type: "updateFields", values: [[1, 5, "4"]] });
    expect(s.editor.state.doc.child(0).child(1).attrs.cached).toBe("4");
    await expectConverged(s);
  });

  it("insertToc renders the entries; updateToc fills in page numbers", async () => {
    const s = await setup(make(), makeDoc([para(1, "A", { style: "Heading1" }), para(2, "B", { style: "Heading2" }), para(3, "text")]));
    await s.ctl.run({ type: "insertToc", after: null, newId: -50 });
    const t = s.editor.state.doc.child(0);
    expect(t.type.name).toBe("toc");
    expect((t.attrs.entries as { text: string }[]).map((e) => e.text)).toEqual(["A", "B"]);
    await s.ctl.run({ type: "updateToc", id: t.attrs.id, pages: [[1, 1], [2, 3]] });
    expect((s.editor.state.doc.child(0).attrs.entries as { page?: number }[]).map((e) => e.page)).toEqual([1, 3]);
    await expectConverged(s);
  });

  it("list labels follow Rust: a new item, then an indent", async () => {
    const doc = makeDoc([li(1, "one", 2, 0), li(2, "two", 2, 0)]);
    const s = await setup(make(), doc);
    expect(labels(s.editor)).toEqual(["1.", "2."]);
    select(s.editor, 1, 3);
    press(s.editor, "Enter");
    type(s.editor, "x");
    await s.ctl.idle();
    expect(labels(s.editor)).toEqual(["1.", "2.", "3."]);
    press(s.editor, "Tab");
    await s.ctl.idle();
    expect(labels(s.editor)[1]).toMatch(/^(a\.|1\.1\.?)$/);
    expect(labels(s.editor)[2]).toBe("2.");
    await expectConverged(s);
  });

  it("a new numbering definition (multilevel preset) gives 1 / 1.1 labels", async () => {
    const s = await setup(make(), makeDoc([para(1, "one"), para(2, "sub")]));
    const numbering = structuredClone(s.ctl.numbering);
    const id = Math.max(0, ...numbering.defs.map((d) => d.id)) + 1;
    numbering.defs.push({
      id,
      levels: Array.from({ length: 9 }, (_, i) => ({
        kind: "decimal" as const,
        text: Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join(".") + (i === 0 ? "." : ""),
        start: 1,
        indent: { left: 432 * (i + 1), hanging: 432 },
      })),
    });
    await s.ctl.run({
      type: "compound",
      commands: [
        { type: "restoreNumbering", numbering },
        { type: "setParagraphProps", blocks: [1], patch: { numbering: { numId: id, level: 0 } } },
        { type: "setParagraphProps", blocks: [2], patch: { numbering: { numId: id, level: 1 } } },
      ],
    });
    expect(labels(s.editor)).toEqual(["1.", "1.1"]);
    await expectConverged(s);
  });

  it("opening a document with notes builds the notes area; a reload keeps it", async () => {
    const doc = makeDoc([para(1, [run("x"), { kind: "noteRef", value: { id: 1, kind: "foot" } }])]);
    doc.notes = [{ id: 1, kind: "foot", blocks: [para(9, " note text")] }];
    const s = await setup(make(), doc);
    expect(notesFromPM(s.editor.state.doc).map((n) => n.id)).toEqual([1]);
    await s.ctl.reload();
    expect(notesFromPM(s.editor.state.doc).map((n) => n.id)).toEqual([1]);
    await expectConverged(s);
  });

  it("beforeSave runs its command before SaveDocx", async () => {
    const s = await setup(make(), makeDoc([para(1, "")]));
    await s.ctl.run({ type: "insertField", block: 1, offset: 0, field: { kind: "numPages" }, cached: "1" });
    s.ctl.beforeSave = () => ({ type: "updateFields", values: [[1, 0, "9"]] });
    await s.ctl.saveDocx(async () => true);
    const types = s.backend.log.map((r) => (r.type === "apply" ? r.command.type : r.type));
    expect(types.indexOf("updateFields")).toBeLessThan(types.indexOf("saveDocx"));
    expect(s.editor.state.doc.child(0).child(0).attrs.cached).toBe("9");
  });
});

// The P8-9 reference documents through the real core: open, edit next to
// every field / reference / TOC, edit a note, and converge.
const real = BACKENDS.find((b) => b.name === "real core");
describe.runIf(real)("provisional-51…54 through the real core", () => {
  const files = [
    "provisional-51-multilevel-legal-numbering.docx",
    "provisional-52-sections-headers-fields.docx",
    "provisional-53-footnotes-endnotes.docx",
    "provisional-54-table-of-contents.docx",
  ];
  for (const name of files) {
    it(`${name}: opens, edits converge`, async () => {
      type NodeProcess = { getBuiltinModule(n: string): { readFileSync(p: string): Uint8Array } };
      const fs = (globalThis as unknown as { process: NodeProcess }).process.getBuiltinModule("fs");
      const bytes = fs.readFileSync(new URL(`../../../../testdata/docx/${name}`, import.meta.url).pathname.replace(/^\/@fs/, ""));
      const backend = real!.make();
      const ctl = new SyncController(new WriteApi(backend));
      const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), SyncExtension(ctl)] });
      current = { backend, ctl, editor };
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      expect(await ctl.openDocx(btoa(bin), name)).toBe(true);
      editor.state.doc.check();
      // Type at the end of every body paragraph holding an atom, and in every note.
      const targets: number[] = [];
      editor.state.doc.descendants((n) => {
        if (n.isTextblock && n.attrs.id != null) {
          let atom = false;
          n.forEach((c) => (atom ||= c.type.name === "field" || c.type.name === "noteRef"));
          if (atom) targets.push(n.attrs.id);
          return false;
        }
        return true;
      });
      notesNode(editor.state.doc)?.descendants((n) => {
        if (n.isTextblock) targets.push(n.attrs.id);
        return !n.isTextblock;
      });
      for (const id of targets.slice(0, 12)) {
        const node = editor.state.doc.nodeAt(posOf(editor, id, 0) - 1)!;
        let len = 0;
        node.forEach((c) => (len += c.isText ? [...c.text!].length : 1));
        select(editor, id, len);
        type(editor, "Z");
      }
      await expectConverged(current);
      expect(ctl.stats.mismatches).toBe(0);
      expect(ctl.stats.reloads).toBe(0);
    });
  }
});
