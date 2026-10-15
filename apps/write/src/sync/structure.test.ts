// P8-10: the mapper for fields, note references, notes, tables of contents,
// list labels and section ends (ADR 0007 property tests extended).

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { WriteCommand } from "../generated/WriteCommand";
import { field, li, makeDoc, note, noteRef, para, run, structureDoc, toc } from "../test/fixtures";
import { change, makeEditor, posOf, press, select, Tagger, type } from "../test/harness";
import { fromPM, notesFromPM, notesNode } from "./fromPM";
import { canonBlock, canonNote, noteRefIds, stableStringify } from "./model";
import { writeSchema } from "./schema";
import { charOffsetOf, findPos, notesGuardPlugin, pmOffsetOf } from "./SyncPlugin";
import { orderNotes, toPM } from "./toPM";
import { Extension } from "@tiptap/core";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const Guard = Extension.create({ name: "testNotesGuard", addProseMirrorPlugins: () => [notesGuardPlugin()] });
const open = (doc: Document) => (editor = makeEditor(doc, [Tagger, Guard]));
const cmd = (r: { command: WriteCommand } | null) => r?.command;
const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));

describe("structure: toPM / fromPM", () => {
  it("fields, note references, TOC and section ends roundtrip the body", () => {
    const doc = structureDoc();
    const pm = toPM(doc, writeSchema());
    pm.check();
    expect(canon(fromPM(pm))).toBe(canon(doc.body));
  });

  it("notes roundtrip in display order: footnotes by first reference, then endnotes", () => {
    const doc = structureDoc();
    const pm = toPM(doc, writeSchema());
    const notes = notesFromPM(pm);
    expect(notes.map((n) => n.id)).toEqual([2, 1, 3]);
    expect(stableStringify(notes.map(canonNote))).toBe(stableStringify(orderNotes(doc.notes!, doc.body).map(canonNote)));
    expect(pm.lastChild!.type.name).toBe("notes");
  });

  it("a document without notes has no notes area", () => {
    const pm = toPM(makeDoc([para(1, "x")]), writeSchema());
    expect(notesNode(pm)).toBeNull();
    expect(pm.childCount).toBe(1);
  });

  it("field node: kind, cached result and formatting as marks", () => {
    const pm = toPM(structureDoc(), writeSchema());
    const p = pm.child(2);
    const f = p.child(1);
    expect(f.type.name).toBe("field");
    expect(f.attrs).toMatchObject({ kind: { kind: "page" }, cached: "1" });
    expect(f.marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(f.isAtom && f.isInline).toBe(true);
  });

  it("note reference node: id, kind and its own formatting", () => {
    const pm = toPM(structureDoc(), writeSchema());
    const refs: { id: number; kind: string; marks: string[] }[] = [];
    pm.descendants((n) => {
      if (n.type.name === "noteRef") refs.push({ id: n.attrs.id, kind: n.attrs.kind, marks: n.marks.map((m) => m.type.name) });
    });
    expect(refs).toEqual([
      { id: 2, kind: "foot", marks: [] },
      { id: 1, kind: "foot", marks: ["italic"] },
      { id: 3, kind: "end", marks: [] },
    ]);
  });

  it("TOC block: a non-editable atom with id and entries", () => {
    const pm = toPM(structureDoc(), writeSchema());
    const t = pm.child(0);
    expect(t.type.name).toBe("toc");
    expect(t.isAtom).toBe(true);
    expect(t.attrs).toMatchObject({ id: 1, title: "Contents", fromLevel: 1, toLevel: 3 });
    expect(t.attrs.entries).toHaveLength(2);
  });

  it("list labels become an attribute (rendered), never sent back", () => {
    const body = [li(1, "a", 2, 0), li(2, "b", 2, 1)];
    (body[0]!.value as { listLabel?: string }).listLabel = "1.";
    (body[1]!.value as { listLabel?: string }).listLabel = "1.1.";
    const e = open(makeDoc(body));
    const labels: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.type.name === "paragraph") labels.push(n.attrs.listLabel);
    });
    expect(labels).toEqual(["1.", "1.1."]);
    expect(e.view.dom.querySelectorAll("p[data-label]")).toHaveLength(2);
    expect(JSON.stringify(fromPM(e.state.doc))).not.toContain("listLabel");
  });

  it("renders fields grey with their cached text, references and section ends with data attributes", () => {
    const e = open(structureDoc());
    const dom = e.view.dom;
    expect(dom.querySelector(".field[data-field=page]")!.textContent).toBe("1");
    expect(dom.querySelectorAll("sup.note-ref")).toHaveLength(3);
    expect(dom.querySelector("[data-section-end='1']")).not.toBeNull();
    expect(dom.querySelector(".toc .toc-entry .toc-text")!.textContent).toBe("Intro");
    expect(dom.querySelector(".toc .toc-page")!.textContent).toBe("2");
    expect(dom.querySelectorAll(".notes-area .note")).toHaveLength(3);
  });

  it("random documents with fields, references and TOCs (seeded property test)", () => {
    let seed = 777;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let iter = 0; iter < 150; iter++) {
      let id = 1;
      const body: Block[] = [];
      const noteIds: number[] = [];
      for (let i = 0, n = 1 + rnd(8); i < n; i++) {
        const kind = rnd(5);
        if (kind === 0) body.push(toc(id++, rnd(2) ? [{ text: "H", level: 1 + rnd(3), target: 99, ...(rnd(2) ? { page: 1 + rnd(9) } : {}) }] : []));
        else {
          const inl = Array.from({ length: rnd(5) }, () => {
            const k = rnd(4);
            if (k === 0) return field(rnd(2) ? { kind: "page" } : { kind: "time", value: { format: "HH:mm" } }, String(rnd(9)), rnd(2) ? { bold: true } : undefined);
            if (k === 1) {
              const nid = 1 + noteIds.length;
              noteIds.push(nid);
              return noteRef(nid, rnd(2) ? "foot" : "end");
            }
            return run(["a", "😀", " b"][rnd(3)]!, rnd(2) ? { italic: true } : undefined);
          });
          body.push(para(id++, inl, rnd(3) === 0 ? { sectionEnd: 1 + rnd(3) } : undefined));
        }
      }
      const doc = makeDoc(body);
      doc.notes = noteIds.map((nid) => note(nid, "foot", [para(1000 + nid, `n${nid}`)]));
      const pm = toPM(doc, writeSchema());
      pm.check();
      expect(canon(fromPM(pm))).toBe(canon(body));
      expect(notesFromPM(pm).map((n) => n.id).sort((a, b) => a - b)).toEqual(noteIds);
    }
  });
});

describe("structure: offsets count atoms as one position", () => {
  it("charOffsetOf / pmOffsetOf around fields and references", () => {
    const e = open(makeDoc([para(1, [run("ab"), field({ kind: "page" }, "12"), run("c"), noteRef(1), run("d")])]));
    const p = e.state.doc.child(0);
    expect(charOffsetOf(p, 3)).toBe(3); // after "ab" + field
    expect(pmOffsetOf(p, 5)).toBe(5);
    expect(charOffsetOf(p, p.content.size)).toBe(6);
  });

  it("typing after a field → insertText at the model offset", () => {
    const e = open(makeDoc([para(1, [run("Page "), field({ kind: "page" }, "1"), run("!")])]));
    select(e, 1, 6);
    expect(cmd(change(e, () => type(e, "x")))).toEqual({ type: "insertText", block: 1, offset: 6, text: "x", props: {} });
  });

  it("typing after a note reference → insertText at the model offset", () => {
    const doc = makeDoc([para(1, [run("Text"), noteRef(1), run(" more")])]);
    doc.notes = [note(1, "foot", [para(5, " note")])];
    const e = open(doc);
    select(e, 1, 5);
    expect(cmd(change(e, () => type(e, "y")))).toMatchObject({ type: "insertText", block: 1, offset: 5, text: "y" });
  });

  it("deleting a field → deleteText of its one position", () => {
    const e = open(makeDoc([para(1, [run("a"), field({ kind: "page" }, "1"), run("b")])]));
    const from = posOf(e, 1, 1);
    expect(cmd(change(e, () => e.view.dispatch(e.state.tr.delete(from, from + 1))))).toEqual({ type: "deleteText", block: 1, from: 1, to: 2 });
  });
});

describe("structure: notes in the mapper", () => {
  const notesDoc = () => {
    const doc = makeDoc([para(1, [run("One"), noteRef(1)]), para(2, [run("Two"), noteRef(2, "end")])]);
    doc.notes = [note(1, "foot", [para(10, " foot")]), note(2, "end", [para(11, " end")])];
    return doc;
  };

  it("deleting a reference deletes its note (deleteText, then deleteFootnote)", () => {
    const e = open(notesDoc());
    const from = posOf(e, 1, 3);
    expect(cmd(change(e, () => e.view.dispatch(e.state.tr.delete(from, from + 1))))).toEqual({
      type: "compound",
      commands: [{ type: "deleteText", block: 1, from: 3, to: 4 }, { type: "deleteFootnote", id: 1 }],
    });
  });

  it("deleting a paragraph with a reference sends deleteFootnote too", () => {
    const e = open(notesDoc());
    const pos = findPos(e.state.doc, 2);
    const r = cmd(change(e, () => e.view.dispatch(e.state.tr.delete(pos, pos + e.state.doc.nodeAt(pos)!.nodeSize))));
    expect(r).toEqual({ type: "compound", commands: [{ type: "deleteBlocks", ids: [2] }, { type: "deleteFootnote", id: 2 }] });
  });

  it("moving a reference (drag and drop) keeps the note", () => {
    const e = open(notesDoc());
    const from = posOf(e, 1, 3);
    const r = cmd(
      change(e, () => {
        const ref = e.state.doc.nodeAt(from)!;
        const tr = e.state.tr.delete(from, from + 1);
        tr.insert(tr.mapping.map(posOf(e, 2, 0)), ref);
        e.view.dispatch(tr);
      }),
    );
    expect(JSON.stringify(r)).not.toContain("deleteFootnote");
  });

  it("joining paragraphs keeps the references (no deleteFootnote)", () => {
    const e = open(notesDoc());
    select(e, 2, 0);
    const r = cmd(change(e, () => press(e, "Backspace")));
    expect(r).toEqual({ type: "joinWithPrevious", block: 2 });
  });

  it("typing in a note → insertText on the note's paragraph", () => {
    const e = open(notesDoc());
    select(e, 10, 5);
    expect(cmd(change(e, () => type(e, "!")))).toEqual({ type: "insertText", block: 10, offset: 5, text: "!", props: {} });
  });

  it("formatting in a note → setRunProps on the note's paragraph", () => {
    const e = open(notesDoc());
    select(e, 11, 1, 11, 4);
    expect(cmd(change(e, () => e.commands.toggleBold()))).toEqual({ type: "setRunProps", block: 11, from: 1, to: 4, patch: { bold: true } });
  });

  it("Enter in a note → replaceNote with a temporary id for the new paragraph", () => {
    const e = open(notesDoc());
    select(e, 10, 3);
    const r = cmd(change(e, () => press(e, "Enter"))) as Extract<WriteCommand, { type: "replaceNote" }>;
    expect(r.type).toBe("replaceNote");
    expect(r.id).toBe(1);
    expect(r.blocks.map((b) => b.value.id)[0]).toBe(10);
    expect(r.blocks[1]!.value.id).toBeLessThan(0);
  });

  it("a body edit and a note edit in one transaction → compound of both", () => {
    const e = open(notesDoc());
    const r = cmd(
      change(e, () => {
        const tr = e.state.tr.insertText("X", posOf(e, 2, 0));
        tr.insertText("Y", tr.mapping.map(posOf(e, 11, 1)));
        e.view.dispatch(tr);
      }),
    );
    expect(r).toMatchObject({
      type: "compound",
      commands: [{ type: "insertText", block: 2, offset: 0, text: "X" }, { type: "insertText", block: 11, offset: 1, text: "Y" }],
    });
  });

  it("the guard rejects removing a note whose reference stays", () => {
    const e = open(notesDoc());
    const area = notesNode(e.state.doc)!;
    const start = e.state.doc.content.size - area.nodeSize + 1;
    const first = area.child(0);
    const before = e.state.doc;
    e.view.dispatch(e.state.tr.delete(start, start + first.nodeSize));
    expect(e.state.doc).toBe(before);
  });

  it("the guard allows removing a note together with its reference", () => {
    const e = open(notesDoc());
    const end = e.state.doc.content.size;
    // Everything from the body's second paragraph to the end of the document.
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, findPos(e.state.doc, 1) + 1, end - 2)));
    const r = change(e, () => e.view.dispatch(e.state.tr.deleteSelection()));
    expect(noteRefIds(fromPM(e.state.doc)).size).toBe(0);
    expect(JSON.stringify(r?.command)).toContain("deleteFootnote");
  });
});

describe("structure: TOC in the mapper", () => {
  it("deleting a selected TOC → deleteBlocks", () => {
    const e = open(makeDoc([toc(1, []), para(2, "x")]));
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 0)));
    expect(cmd(change(e, () => e.view.dispatch(e.state.tr.deleteSelection())))).toEqual({ type: "deleteBlocks", ids: [1] });
  });

  it("typing next to a TOC leaves it alone", () => {
    const e = open(makeDoc([toc(1, [{ text: "A", level: 1, target: 2 }]), para(2, "A", { style: "Heading1" })]));
    select(e, 2, 1);
    expect(cmd(change(e, () => type(e, "b")))).toMatchObject({ type: "insertText", block: 2, offset: 1 });
  });
});
