import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { WriteApi } from "../backend";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import { backendsUnderTest, type TestBackend } from "../test/backends";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { FIXTURES, makeDoc, para, run } from "../test/fixtures";
import { posOf, press, select, type } from "../test/harness";
import { setParagraphStyle } from "./editorCommands";
import { fromPM } from "./fromPM";
import { canonBlock, stableStringify } from "./model";
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

async function setup(backend: TestBackend, doc?: Document): Promise<Setup> {
  const ctl = new SyncController(new WriteApi(backend));
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...writeExtensions({ resolveMedia: ctl.media.resolve }), SyncExtension(ctl)],
  });
  if (doc) await ctl.load(doc);
  else await ctl.newDocument();
  current = { backend, ctl, editor };
  return current;
}

const canon = (blocks: Block[]) => stableStringify(blocks.map(canonBlock));

/** The editor shows exactly Rust's document (ids included). */
async function expectConverged({ backend, ctl, editor }: Setup): Promise<void> {
  await ctl.idle();
  const reply = (await backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  expect(canon(fromPM(editor.state.doc))).toBe(canon(reply.ok.doc.body));
}

const ids = (editor: Editor) => {
  const out: number[] = [];
  editor.state.doc.descendants((n) => {
    if (n.attrs.id != null) out.push(n.attrs.id);
  });
  return out;
};

describe.each(BACKENDS)("sync against the $name backend", ({ make }) => {
  it("typing sends insertText and needs no correction", async () => {
    const s = await setup(make());
    const id = ids(s.editor)[0]!;
    select(s.editor, id, 0);
    for (const ch of "Hello") type(s.editor, ch);
    await expectConverged(s);
    const sent = s.backend.log.filter((r) => r.type === "apply").map((r) => (r as { command: { type: string } }).command.type);
    expect(sent).toEqual(["insertText", "insertText", "insertText", "insertText", "insertText"]);
    expect(s.ctl.stats.mismatches).toBe(0);
    expect(s.ctl.getState().revision).toBeGreaterThan(0);
    expect(s.ctl.getState().dirty).toBe(true);
  });

  it("Enter creates a temporary id that the patch replaces; queued commands use the real id", async () => {
    const s = await setup(make());
    const id = ids(s.editor)[0]!;
    select(s.editor, id, 0);
    type(s.editor, "ab");
    press(s.editor, "Enter");
    type(s.editor, "c"); // sent before the split's reply arrives
    await expectConverged(s);
    expect(ids(s.editor).every((x) => x > 0)).toBe(true);
    expect(s.ctl.stats.mismatches).toBe(0);
  });

  it("heading, two list items, bold, undo twice (the acceptance scenario)", async () => {
    const s = await setup(make());
    const e = s.editor;
    const first = ids(e)[0]!;
    select(e, first, 0);
    setParagraphStyle(e, "Heading1");
    for (const ch of "Report") type(e, ch);
    press(e, "Enter");
    for (const ch of "alpha beta") type(e, ch);
    e.commands.toggleBulletList();
    press(e, "Enter");
    for (const ch of "gamma") type(e, ch);
    await expectConverged(s);
    // Bold "beta".
    const second = ids(e)[1]!;
    select(e, second, 6, second, 10);
    e.commands.toggleBold();
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
    s.ctl.undo();
    s.ctl.undo();
    await expectConverged(s);
    expect(e.getText()).toContain("alpha beta");
    expect(e.getText()).not.toContain("gamma");
    expect(e.state.doc.child(0).type.name).toBe("heading");
  });

  it("undo and redo apply Rust's patches", async () => {
    const s = await setup(make(), makeDoc([para(1, "one"), para(2, "two")]));
    select(s.editor, 2, 0);
    press(s.editor, "Backspace");
    await expectConverged(s);
    expect(s.editor.state.doc.childCount).toBe(1);
    s.ctl.undo();
    await expectConverged(s);
    expect(s.editor.state.doc.childCount).toBe(2);
    s.ctl.redo();
    await expectConverged(s);
    expect(s.editor.state.doc.childCount).toBe(1);
    expect(s.ctl.stats.mismatches).toBe(0);
  });

  it("toggling a list adopts the numbering id Rust allocates (no mismatch)", async () => {
    const s = await setup(make(), makeDoc([para(1, "a"), para(2, "b")], []));
    select(s.editor, 1, 0, 2, 1);
    s.editor.commands.toggleOrderedList();
    await expectConverged(s);
    expect(s.ctl.stats.mismatches).toBe(0);
    expect(s.editor.state.doc.child(0).attrs.numId).toBeGreaterThan(0);
    expect(s.ctl.numbering.defs).toHaveLength(1);
  });

  it("a table inserted Rust-first appears in the editor", async () => {
    const s = await setup(make(), makeDoc([para(1, "a")]));
    await s.ctl.run({ type: "insertTable", after: 1, rows: 2, cols: 3 });
    await expectConverged(s);
    const table = s.editor.state.doc.child(1);
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(2);
    expect(table.child(0).childCount).toBe(3);
    // Typing into a cell goes back as a table edit.
    const cellPara = table.child(0).child(1).child(0).attrs.id as number;
    select(s.editor, cellPara, 0);
    type(s.editor, "x");
    await expectConverged(s);
  });

  it("find/replace reports the count and updates the text", async () => {
    const s = await setup(make(), makeDoc([para(1, "cat and cat"), para(2, "cat")]));
    await s.ctl.run({ type: "findReplace", find: "cat", replace: "dog", matchCase: false, wholeWord: false, all: true });
    await expectConverged(s);
    expect(s.editor.getText()).not.toContain("cat");
    expect(s.ctl.getState().info).toBe("3 replacements");
  });

  it("an inserted image is fetched through GetMedia", async () => {
    const s = await setup(make(), makeDoc([para(1, "ab")]));
    await s.ctl.run({
      type: "insertImage", block: 1, offset: 1, contentType: "image/png",
      bytesBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      width: 95250, height: 95250,
    });
    await expectConverged(s);
    let media: number | null = null;
    s.editor.state.doc.descendants((n) => {
      if (n.type.name === "image") media = n.attrs.mediaId;
    });
    expect(media).not.toBeNull();
    await s.ctl.media.resolve(media!);
    expect(s.backend.log.some((r) => r.type === "getMedia")).toBe(true);
  });

  it("loads all fixtures and stays converged after an edit", async () => {
    for (const doc of Object.values(FIXTURES)) {
      const s = await setup(make(), doc);
      await expectConverged(s);
      s.editor.destroy();
    }
  });
});

describe("sync error handling (fake backend)", () => {
  it("an err reply reloads the document from Rust and shows a toast", async () => {
    const fake = new FakeWriteBackend();
    const s = await setup(fake, makeDoc([para(1, "abc")]));
    select(s.editor, 1, 3);
    fake.failNext = "bad_offset";
    type(s.editor, "d");
    await expectConverged(s);
    expect(s.editor.getText()).toBe("abc");
    expect(s.ctl.getState().toasts[0]?.message).toContain("bad_offset");
    expect(s.ctl.stats.reloads).toBe(1);
  });

  it("a patch that differs from the local node replaces it, keeping the cursor", async () => {
    const fake = new FakeWriteBackend();
    const s = await setup(fake, makeDoc([para(1, "abc"), para(2, "xyz")]));
    select(s.editor, 1, 3);
    fake.tamper = (p) => ({ ...p, replaced: [para(1, [run("abcD", { bold: true })])] });
    type(s.editor, "d");
    await s.ctl.idle();
    expect(s.ctl.stats.mismatches).toBe(1);
    expect(s.editor.getText()).toContain("abcD");
    expect(s.editor.state.selection.from).toBe(posOf(s.editor, 1, 4));
    expect(s.editor.state.doc.child(0).firstChild!.marks.map((m) => m.type.name)).toEqual(["bold"]);
  });

  it("replies with an older revision are discarded", async () => {
    const fake = new FakeWriteBackend();
    const s = await setup(fake, makeDoc([para(1, "abc")]));
    const before = s.ctl.getState().revision;
    select(s.editor, 1, 3);
    fake.staleNext = true;
    fake.tamper = (p) => ({ ...p, replaced: [para(1, "WRONG")] });
    type(s.editor, "d");
    await s.ctl.idle();
    expect(s.ctl.stats.stale).toBe(1);
    expect(s.ctl.getState().revision).toBe(before);
    expect(s.editor.getText()).toBe("abcd");
  });

  it("inserted blocks missing locally are added after their predecessor", async () => {
    const fake = new FakeWriteBackend();
    const s = await setup(fake, makeDoc([para(1, "a"), para(2, "b")]));
    select(s.editor, 1, 1);
    fake.tamper = (p) => ({ ...p, inserted: [{ after: 1, parent: null, block: para(50, "from rust") }] });
    type(s.editor, "!");
    await s.ctl.idle();
    expect(fromPM(s.editor.state.doc).map((b) => b.value.id)).toEqual([1, 50, 2]);
    expect(s.ctl.stats.mismatches).toBe(1);
  });
});
