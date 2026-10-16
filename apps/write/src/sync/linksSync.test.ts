// P8-27 sync: links, bookmarks and column breaks through toPM / fromPM, the
// multi-column section boxes, the mapper (typing in links, edits around
// bookmark markers) — against the fake and, with WRITE_CORE_WASM, the real
// core, including the reference document 60.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { WriteApi } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Hyperlink } from "../generated/Hyperlink";
import type { Inline } from "../generated/Inline";
import { backendsUnderTest, type TestBackend } from "../test/backends";
import { makeDoc, para, run } from "../test/fixtures";
import { posOf, select, type } from "../test/harness";
import { fromPM } from "./fromPM";
import { canonBlock, stableStringify } from "./model";
import { writeExtensions, writeSchema } from "./schema";
import { SyncController, SyncExtension } from "./SyncPlugin";
import { toPM } from "./toPM";
import { mapDocChange } from "./transactionMapper";
import { Extension } from "@tiptap/core";
import { commentsPlugin } from "../comments/plugin";

/** The comments plugin keeps lone range markers (comments and bookmarks), as in the app. */
const CommentsExtensionForTests = Extension.create({
  name: "testMarkers",
  addProseMirrorPlugins: () => [commentsPlugin({ color: () => ({ light: "#eee", dark: "#ccc" }), onActivate: () => undefined, view: () => ({ show: true, active: null, hover: null, draft: null }) })],
});

const BACKENDS = await backendsUnderTest();
const WEB: Hyperlink = { target: { kind: "url", value: "https://rusuite.example/" } };
const linked = (text: string): Inline => ({ kind: "run", value: { text, style: "Hyperlink", link: WEB } });
const bm = (id: number, name: string): Inline => ({ kind: "bookmarkStart", value: { id, name } });
const bmEnd = (id: number): Inline => ({ kind: "bookmarkEnd", value: { id } });
const A4 = { width: 11906, height: 16838, orientation: "portrait" as const, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } };

function columnsDoc(): Document {
  const doc = makeDoc([para(1, "Intro", { sectionEnd: 1 }), para(2, "Left column"), para(3, [run("Right"), { kind: "break", value: "column" }, run("more")], { sectionEnd: 2 }), para(4, "After")]);
  doc.sections = [
    { id: 1, page: A4, kind: "nextPage", titlePage: false },
    { id: 2, page: A4, kind: "continuous", titlePage: false, columns: { count: 2, equal: true } },
    { id: 3, page: A4, kind: "continuous", titlePage: false },
  ];
  return doc;
}

describe("mapping", () => {
  it("links, bookmarks and column breaks survive toPM → fromPM", () => {
    const doc = makeDoc([para(1, [run("a "), linked("site"), bm(4, "here"), run("x"), bmEnd(4), { kind: "break", value: "column" }])]);
    const pm = toPM(doc, writeSchema());
    const back = fromPM(pm);
    expect(stableStringify(back.map(canonBlock))).toBe(stableStringify(doc.body.map(canonBlock)));
    expect(pm.firstChild!.child(1).marks.map((m) => m.type.name)).toContain("link");
  });

  it("a multi-column section becomes one columns box; fromPM flattens it", () => {
    const doc = columnsDoc();
    const pm = toPM(doc, writeSchema());
    expect(pm.childCount).toBe(3);
    expect(pm.child(1).type.name).toBe("columns");
    expect(pm.child(1).childCount).toBe(2);
    expect(pm.child(1).attrs.columns).toEqual({ count: 2, equal: true });
    expect(fromPM(pm).map((b) => b.value.id)).toEqual([1, 2, 3, 4]);
  });

  it("typing inside a link carries the link; at its end it does not (Word)", () => {
    const schema = writeSchema();
    const doc = makeDoc([para(1, [run("a "), linked("site"), run(" b")])]);
    const editor = new Editor({ element: document.createElement("div"), extensions: writeExtensions(), content: toPM(doc, schema).toJSON() });
    const before = editor.state.doc;
    select(editor, 1, 4);
    type(editor, "X");
    const inside = mapDocChange(before, editor.state.doc);
    expect(inside?.command).toMatchObject({ type: "insertText", offset: 4, text: "X", link: WEB });
    const mid = editor.state.doc;
    select(editor, 1, 7);
    type(editor, "Y");
    const after = mapDocChange(mid, editor.state.doc)?.command as { link?: unknown };
    expect(after).toMatchObject({ type: "insertText", offset: 7, text: "Y" });
    expect(after.link).toBeUndefined();
    editor.destroy();
  });

  it("deleting across a bookmark start keeps the marker (the range shrinks), like the core", () => {
    const doc = makeDoc([para(1, [run("ab"), bm(1, "m"), run("cd"), bmEnd(1), run("ef")])]);
    const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), CommentsExtensionForTests] });
    editor.commands.setContent(toPM(doc, writeSchema()).toJSON());
    const before = editor.state.doc;
    editor.view.dispatch(editor.state.tr.delete(posOf(editor, 1, 1), posOf(editor, 1, 4)));
    const kinds = fromPM(editor.state.doc)[0]!.value as { inlines: Inline[] };
    expect(kinds.inlines.map((i) => i.kind)).toEqual(["run", "bookmarkStart", "run", "bookmarkEnd", "run"]);
    // `DeleteText` keeps the lone marker in the core too.
    expect(mapDocChange(before, editor.state.doc)?.command).toEqual({ type: "deleteText", block: 1, from: 1, to: 4 });
    editor.destroy();
  });
});

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
  const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions({ resolveMedia: ctl.media.resolve }), SyncExtension(ctl), CommentsExtensionForTests] });
  await ctl.load(doc);
  current = { backend, ctl, editor };
  return current;
}

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));
async function converged({ backend, ctl, editor }: Setup): Promise<Document> {
  await ctl.idle();
  const reply = (await backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  expect(canon(fromPM(editor.state.doc))).toBe(canon(reply.ok.doc.body));
  return reply.ok.doc;
}

describe.each(BACKENDS)("links and columns against the $name backend", ({ make }) => {
  it("SetHyperlink / RemoveHyperlink and typing inside the link converge", async () => {
    const s = await setup(make(), makeDoc([para(1, "Visit our site now")]));
    await s.ctl.run({ type: "setHyperlink", block: 1, from: 6, to: 14, link: WEB });
    select(s.editor, 1, 9);
    type(s.editor, "Z");
    const doc = await converged(s);
    const runs = (doc.body[0]!.value as { inlines: Inline[] }).inlines.filter((i) => i.kind === "run");
    expect(runs.map((r) => (r.kind === "run" && r.value.link ? r.value.text : null)).filter(Boolean)).toEqual(["ourZ site"]);
    await s.ctl.run({ type: "removeHyperlink", block: 1, from: 6, to: 15 });
    await converged(s);
    expect(s.editor.view.dom.querySelector("a.doc-link")).toBeNull();
    expect(s.ctl.stats.mismatches).toBe(0);
  });

  it("columns: SetSection re-wraps the section box; a column preset back to one column unwraps it", async () => {
    const s = await setup(make(), columnsDoc());
    expect(s.editor.state.doc.child(1).type.name).toBe("columns");
    await s.ctl.run({ type: "setSection", section: 2, patch: { columns: { count: 3, equal: true, separator: true } } });
    expect(s.editor.state.doc.child(1).attrs.columns).toMatchObject({ count: 3, separator: true });
    await s.ctl.run({ type: "setSection", section: 2, patch: { columns: { count: 1, equal: true } } });
    await converged(s);
    s.editor.state.doc.forEach((n) => expect(n.type.name).not.toBe("columns"));
    // Typing inside a box converges.
    await s.ctl.run({ type: "setSection", section: 2, patch: { columns: { count: 2, equal: true } } });
    select(s.editor, 2, 4);
    type(s.editor, "!");
    await converged(s);
    expect(s.editor.state.doc.child(1).type.name).toBe("columns");
    expect(s.ctl.stats.mismatches).toBe(0);
  });

  it("bookmarks: add, edit around the markers, delete", async () => {
    const s = await setup(make(), makeDoc([para(1, "one two three")]));
    await s.ctl.run({ type: "addBookmark", name: "two", start: { block: 1, offset: 4 }, end: { block: 1, offset: 7 } });
    expect(s.editor.view.dom.querySelector('[data-bookmark="two"]')).not.toBeNull();
    select(s.editor, 1, 6);
    type(s.editor, "o");
    await converged(s);
    await s.ctl.run({ type: "deleteBookmark", name: "two" });
    await converged(s);
    expect(s.editor.view.dom.querySelector('[data-bookmark="two"]')).toBeNull();
  });
});

// ----- the reference document through the real core ----------------------------------------

const real = BACKENDS.find((b) => b.name === "real core");
describe.runIf(real)("provisional-60-links-bookmarks-columns through the real core", () => {
  it("opens with its links, bookmarks, fields and column boxes; edits converge without mismatches", async () => {
    type NodeProcess = { getBuiltinModule(n: string): { readFileSync(p: string): Uint8Array } };
    const fs = (globalThis as unknown as { process: NodeProcess }).process.getBuiltinModule("fs");
    const name = "provisional-60-links-bookmarks-columns.docx";
    const bytes = fs.readFileSync(new URL(`../../../../testdata/docx/${name}`, import.meta.url).pathname.replace(/^\/@fs/, ""));
    const backend = real!.make();
    const ctl = new SyncController(new WriteApi(backend));
    const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), SyncExtension(ctl), CommentsExtensionForTests] });
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    expect(await ctl.openDocx(btoa(bin), name)).toBe(true);
    const dom = editor.view.dom;
    expect(dom.querySelectorAll("a.doc-link").length).toBe(3);
    expect(dom.querySelectorAll(".bookmark-start").length).toBe(2);
    const boxes: number[] = [];
    editor.state.doc.forEach((n) => n.type.name === "columns" && boxes.push((n.attrs.columns as { count: number }).count));
    expect(boxes).toEqual([2, 3]);
    expect(dom.querySelectorAll(".column-break").length).toBe(1);
    // Type in a link, in a column box and next to a bookmark; delete across a bookmark start.
    const cur = { backend, ctl, editor };
    const firstLink = dom.querySelector("a.doc-link")!;
    const at = editor.view.posAtDOM(firstLink, 0);
    editor.view.dispatch(editor.state.tr.insertText("Q", at + 2));
    let boxPos = -1;
    editor.state.doc.forEach((n, off) => {
      if (boxPos < 0 && n.type.name === "columns") boxPos = off;
    });
    editor.view.dispatch(editor.state.tr.insertText("W", boxPos + 3));
    await ctl.idle();
    const start = dom.querySelector(".bookmark-start")!;
    const p = editor.view.posAtDOM(start, 0);
    editor.view.dispatch(editor.state.tr.delete(p - 2, p + 3));
    await converged(cur);
    expect(ctl.stats.mismatches).toBe(0);
    expect(ctl.stats.reloads).toBe(0);
    // Update Fields: the core recomputes the REF to the (shortened) bookmark.
    await ctl.run({ type: "updateFields", values: [], refresh: { pages: [] } });
    const doc = await converged(cur);
    expect(JSON.stringify(doc.body)).toContain('"kind":"pageRef"');
    editor.destroy();
  });
});
