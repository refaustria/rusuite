import { Editor } from "@tiptap/core";
import { LoroDoc } from "loro-crdt";
import { beforeAll, describe, expect, it } from "vitest";
import type { NotesWasmModule } from "../backend";
import type { OpenedPage } from "../generated/OpenedPage";
import { coreAvailable, loadCore } from "../test/core";
import { LoroBinding, editorRedo, editorUndo } from "./binding";
import { genesisTextId, PageMirror, type MirrorHost } from "./mirror";
import { notesSchemaExtensions } from "./schema";

let core: NotesWasmModule;
const call = (req: object) => {
  const r = JSON.parse(core.dispatch(JSON.stringify({ now: 1_700_000_000_000, ...req })));
  if (r.err) throw new Error(r.err.message);
  return r.ok;
};

function host(): MirrorHost & { imported: number } {
  const h = {
    imported: 0,
    genesis: core.page_genesis(),
    exportUpdates: async (doc: string, vv: Uint8Array) => core.export_updates(doc, vv),
    importUpdates: async (doc: string, bytes: Uint8Array) => {
      const r = JSON.parse(core.import_updates(doc, bytes));
      if (r.err) throw new Error(r.err.message);
      h.imported++;
    },
  };
  return h;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function openEditor(docId: string) {
  const page = call({ type: "openPage", docId }).page as OpenedPage;
  const h = host();
  const mirror = await PageMirror.open(page, h);
  const editor = new Editor({ element: document.createElement("div"), extensions: [...notesSchemaExtensions(), LoroBinding(mirror)] });
  await tick(); // the sync plugin binds on the next task
  return { page, mirror, editor, h };
}

describe.runIf(coreAvailable)("page mirror ↔ notes-core", () => {
  let docId = "";
  beforeAll(async () => {
    core = await loadCore();
    call({ type: "hello", deviceId: "test" });
    call({ type: "createNotebook", name: "T", id: "nb-mirror" });
    const s = call({ type: "createSection", notebook: "nb-mirror", title: "S" }).id as string;
    docId = call({ type: "createPage", notebook: "nb-mirror", parent: s, title: "P" }).page.docId as string;
  });

  it("seeds from the core, uses the mirror peer, and binds without writing anything", async () => {
    const { page, mirror, editor, h } = await openEditor(docId);
    expect(mirror.doc.peerIdStr).toBe(page.mirrorPeer);
    expect(mirror.hasGenesis()).toBe(true);
    const before = mirror.doc.oplogVersion().toJSON();
    expect(editor.getJSON()).toEqual({ type: "doc", content: [{ type: "paragraph", attrs: { tags: null, checked: null, canvasItem: null } }] });
    await mirror.settle();
    expect(mirror.doc.oplogVersion().toJSON()).toEqual(before);
    expect(h.imported).toBe(0);
    editor.destroy();
    mirror.dispose();
  });

  it("typing reuses the genesis text container and reaches the core; undo/redo is local", async () => {
    const { mirror, editor } = await openEditor(docId);
    const genesisId = genesisTextId(mirror.doc);
    editor.commands.insertContent("Hello");
    editor.commands.toggleBold();
    editor.commands.insertContent(" world");
    await mirror.settle();
    expect(genesisTextId(mirror.doc)).toBe(genesisId);
    const text = mirror.doc.getContainerById(genesisId as never) as { toString(): string };
    expect(text.toString()).toBe("Hello world");
    // The core has the text (search index reads the page doc).
    const hits = call({ type: "search", query: "world" }).hits as { docId: string }[];
    expect(hits.map((h) => h.docId)).toContain(docId);
    // Undo removes the typing (one merged step within 1 s), redo brings it back.
    expect(editorUndo(editor.state, editor.view.dispatch)).toBe(true);
    await tick();
    expect(editor.getText()).toBe("");
    expect(editorRedo(editor.state, editor.view.dispatch)).toBe(true);
    await tick();
    expect(editor.getText()).toBe("Hello world");
    await mirror.settle();
    editor.destroy();
    mirror.dispose();
  });

  it("a second mirror of the same page starts from what the first one wrote", async () => {
    const { editor, mirror } = await openEditor(docId);
    expect(editor.getText()).toBe("Hello world");
    expect(editor.getJSON().content?.[0]?.content?.[1]?.marks).toEqual([{ type: "bold" }]);
    editor.destroy();
    mirror.dispose();
  });

  it("pulls core-side changes (rename → meta.title) into the mirror", async () => {
    const { mirror, editor } = await openEditor(docId);
    const node = call({ type: "openPage", docId }).page.nodeId as string;
    call({ type: "rename", notebook: "nb-mirror", node, title: "Renamed" });
    await mirror.pull();
    expect(mirror.doc.getMap("meta").get("title")).toBe("Renamed");
    editor.destroy();
    mirror.dispose();
  });

  it("the binding writes loro-prosemirror's layout the core reads (task items, page links, tags)", async () => {
    const { mirror, editor } = await openEditor(docId);
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }] },
        { type: "paragraph", attrs: { tags: ["todo"], checked: false }, content: [{ type: "text", text: "call " }, { type: "pageLink", attrs: { pageId: "pg-x", title: "Other" } }] },
      ],
    });
    await mirror.settle();
    const json = new LoroDoc();
    json.import(core.export_updates(docId, new Uint8Array()));
    const docMap = json.getMap("doc").toJSON() as { children: { nodeName: string; attributes: Record<string, unknown> }[] };
    expect(docMap.children.map((c) => c.nodeName)).toEqual(["taskList", "paragraph"]);
    expect(docMap.children[1]!.attributes).toEqual({ tags: ["todo"], checked: false });
    const backlinks = call({ type: "backlinks", pageId: "pg-x" }).pages as { docId: string }[];
    expect(backlinks.map((p) => p.docId)).toEqual([docId]);
    const tasks = call({ type: "tasks", filter: "all" }).tasks as unknown[];
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    editor.destroy();
    mirror.dispose();
  });

  it("keeps the converters' schema (notes-format §7.1): canvasItem, colours, image, attachment, tables, start, language", async () => {
    const { mirror, editor } = await openEditor(docId);
    const content = [
      { type: "paragraph", attrs: { canvasItem: "c1" }, content: [{ type: "text", marks: [{ type: "textStyle", attrs: { color: "#FF0000" } }, { type: "highlight", attrs: { color: "#00FF00" } }], text: "col" }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }] },
      { type: "codeBlock", attrs: { language: "rust" }, content: [{ type: "text", text: "fn x() {}" }] },
      { type: "image", attrs: { blob: "a".repeat(64), alt: "pic", width: 100, height: 50 } },
      { type: "attachment", attrs: { blob: "b".repeat(64), name: "f.pdf", size: 12 } },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "wide" }] }] }] }] },
    ];
    editor.commands.setContent({ type: "doc", content });
    await mirror.settle();
    const json = new LoroDoc();
    json.import(core.export_updates(docId, new Uint8Array()));
    const kids = (json.getMap("doc").toJSON() as { children: { nodeName: string; attributes: Record<string, unknown> }[] }).children;
    expect(kids.map((c) => c.nodeName)).toEqual(["paragraph", "orderedList", "codeBlock", "image", "attachment", "table"]);
    expect(kids[0]!.attributes.canvasItem).toBe("c1");
    expect(kids[1]!.attributes.start).toBe(3);
    expect(kids[2]!.attributes.language).toBe("rust");
    expect(kids[3]!.attributes).toMatchObject({ blob: "a".repeat(64), alt: "pic", width: 100, height: 50 });
    expect(kids[4]!.attributes).toMatchObject({ name: "f.pdf", size: 12 });
    type J = { attrs?: Record<string, unknown>; marks?: unknown[]; content?: J[] };
    const doc = editor.getJSON() as J;
    const marks = doc.content![0]!.content![0]!.marks;
    expect(marks).toEqual(expect.arrayContaining([{ type: "textStyle", attrs: { color: "#FF0000" } }, { type: "highlight", attrs: { color: "#00FF00" } }]));
    const cell = doc.content![5]!.content![0]!.content![0]!;
    expect(cell.attrs?.colspan).toBe(2);
    editor.destroy();
    mirror.dispose();
  });
});
