// P8-25: comment markers in the sync mapper, the marker-keeping plugin, the
// comments model (threads, filters, colours, dates, ranges), the balloon
// layout and the thread operations → commands (fake backend).

import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Comment } from "../generated/Comment";
import type { Document } from "../generated/Document";
import type { Inline } from "../generated/Inline";
import { WriteApi } from "../backend";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { backendsUnderTest } from "../test/backends";
import { makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, posOf, select, Tagger, type } from "../test/harness";
import { fromPM, inlinesFromPM } from "../sync/fromPM";
import { inlinesToPM } from "../sync/toPM";
import { paragraphLength, stableStringify, canonBlock } from "../sync/model";
import { writeExtensions, writeSchema } from "../sync/schema";
import { SyncController, SyncExtension } from "../sync/SyncPlugin";
import { countNodeWords } from "../wordCount";
import { commentsPlugin } from "./plugin";
import {
  addComment, deleteAllComments, deleteComment, draftFromSelection, editComment, goToComment, replyComment, resolveComment, wordAt,
} from "./commands";
import {
  authorColor, AUTHOR_COLORS, commentText, filterThreads, initialsOf, layoutBalloons, loadUser, nextRange, nowIso, pmRanges, rangeAt, relativeDate, rootOf, saveUser, threads,
} from "./model";
import { commentsMode } from "./CommentsUi";
import { addCommentMarkup, commentLabel } from "../print/writePrintDoc";

const S = (id: number): Inline => ({ kind: "commentStart", value: { id } });
const E = (id: number): Inline => ({ kind: "commentEnd", value: { id } });

const comment = (id: number, author: string, text: string, extra: Partial<Comment> = {}): Comment => ({
  id,
  author,
  content: [{ kind: "paragraph", value: { id: 1000 + id, inlines: [run(text)] } }],
  ...extra,
});

const CommentsExt = Extension.create({
  name: "testComments",
  addProseMirrorPlugins: () => [commentsPlugin({ color: () => AUTHOR_COLORS[0]!, onActivate: () => undefined, view: () => ({ show: true, active: null, hover: null, draft: null }) })],
});

const editorWith = (doc: Document) => makeEditor(doc, [Tagger, CommentsExt]);

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
});

// ----- mapping ------------------------------------------------------------------------

describe("comment markers in the mapper", () => {
  const inlines = [run("ab"), S(1), run("cd"), E(1), run("e")];

  it("toPM / fromPM keep the markers as atoms (no offset drift)", () => {
    const schema = writeSchema();
    const nodes = inlinesToPM(schema, inlines);
    expect(nodes.map((n) => n.type.name)).toEqual(["text", "commentStart", "text", "commentEnd", "text"]);
    const p = schema.nodes.paragraph!.create({ id: 1 }, nodes);
    expect(inlinesFromPM(p)).toEqual(inlines);
    expect(p.content.size).toBe(7);
    expect(paragraphLength({ id: 1, inlines })).toBe(7);
  });

  it("whole documents round-trip", () => {
    const doc = makeDoc([para(1, inlines), para(2, [S(2), run("x")]), para(3, [run("y"), E(2)])]);
    const editor = editorWith(doc);
    expect(stableStringify(fromPM(editor.state.doc).map(canonBlock))).toBe(stableStringify(doc.body.map(canonBlock)));
    editor.destroy();
  });

  it("typing inside a range sends insertText after the start marker", () => {
    const editor = editorWith(makeDoc([para(1, inlines)]));
    const r = change(editor, () => {
      select(editor, 1, 4);
      type(editor, "Z");
    });
    expect(r?.command).toEqual({ type: "insertText", block: 1, offset: 4, text: "Z", props: {} });
    editor.destroy();
  });

  it("deleting text inside a range sends deleteText", () => {
    const editor = editorWith(makeDoc([para(1, inlines)]));
    const r = change(editor, () => {
      select(editor, 1, 3, 1, 5);
      editor.commands.deleteSelection();
    });
    expect(r?.command).toEqual({ type: "deleteText", block: 1, from: 3, to: 5 });
    editor.destroy();
  });

  it("pasted HTML never brings comment markers", () => {
    const schema = writeSchema();
    const div = document.createElement("div");
    div.innerHTML = '<p>a<span class="comment-mark comment-start" data-comment-start="1"></span>b<span class="comment-mark comment-end" data-comment-end="1"></span></p>';
    const parsed = PMDOMParser.fromSchema(schema).parse(div);
    let marks = 0;
    parsed.descendants((n) => void (n.type.name.startsWith("comment") && marks++));
    expect(marks).toBe(0);
    expect(parsed.textContent).toBe("ab");
  });

  it("markers do not split words in the word count", () => {
    const schema = writeSchema();
    const p = schema.nodes.paragraph!.create({ id: 1 }, inlinesToPM(schema, [run("qui"), S(1), run("ck fox"), E(1)]));
    expect(countNodeWords(p)).toBe(2);
  });
});

// ----- marker-keeping plugin -------------------------------------------------------------

describe("the marker-keeping plugin", () => {
  const body = () => [para(1, [run("abc "), S(1), run("defgh"), E(1), run(" ijk")])];

  it("deleting across the start keeps it (the range shrinks) and maps to deleteText", () => {
    const editor = editorWith(makeDoc(body()));
    const r = change(editor, () => {
      select(editor, 1, 2, 1, 7); // "c ", start, "de"
      editor.commands.deleteSelection();
    });
    const inl = fromPM(editor.state.doc)[0]!.value as { inlines: Inline[] };
    expect(inl.inlines).toEqual([run("ab"), S(1), run("fgh"), E(1), run(" ijk")]);
    expect(r?.command).toEqual({ type: "deleteText", block: 1, from: 2, to: 7 });
    editor.destroy();
  });

  it("typing over a selection across the end puts the end before the new text", () => {
    const editor = editorWith(makeDoc(body()));
    const r = change(editor, () => {
      select(editor, 1, 8, 1, 12); // "gh", end, " "
      type(editor, "X");
    });
    expect(r?.command).toEqual({
      type: "compound",
      commands: [
        { type: "deleteText", block: 1, from: 8, to: 12 },
        { type: "insertText", block: 1, offset: 9, text: "X", props: {} },
      ],
    });
    const inl = fromPM(editor.state.doc)[0]!.value as { inlines: Inline[] };
    expect(inl.inlines).toEqual([run("abc "), S(1), run("def"), E(1), run("Xijk")]);
    editor.destroy();
  });

  it("deleting the whole range removes both markers", () => {
    const editor = editorWith(makeDoc(body()));
    const r = change(editor, () => {
      select(editor, 1, 4, 1, 11);
      editor.commands.deleteSelection();
    });
    expect(pmRanges(editor.state.doc)).toEqual([]);
    expect(r?.command).toEqual({ type: "deleteText", block: 1, from: 4, to: 11 });
    editor.destroy();
  });

  it("deleting a paragraph join keeps the surviving marker", () => {
    const editor = editorWith(makeDoc([para(1, [run("one"), S(1), run("two")]), para(2, [run("three"), E(1)])]));
    select(editor, 1, 2, 2, 2);
    editor.commands.deleteSelection();
    const ranges = pmRanges(editor.state.doc);
    expect(ranges.length).toBe(1);
    expect(editor.state.doc.textContent).toBe("onree");
    editor.destroy();
  });
});

// ----- model ----------------------------------------------------------------------------

describe("comments model", () => {
  const list: Comment[] = [
    comment(1, "Anna Berg", "first"),
    comment(2, "Ben Cole", "second", { resolved: true }),
    comment(3, "Ben Cole", "reply", { parent: 1 }),
    comment(4, "Anna Berg", "reply 2", { parent: 1 }),
  ];

  it("threads follow the anchor order, replies attached", () => {
    const th = threads(list, [2, 1]);
    expect(th.map((t) => t.root.id)).toEqual([2, 1]);
    expect(th[1]!.replies.map((r) => r.id)).toEqual([3, 4]);
    expect(commentText(list[0]!)).toBe("first");
  });

  it("filters: all, open, resolved", () => {
    const th = threads(list);
    expect(filterThreads(th, "all").length).toBe(2);
    expect(filterThreads(th, "open").map((t) => t.root.id)).toEqual([1]);
    expect(filterThreads(th, "resolved").map((t) => t.root.id)).toEqual([2]);
  });

  it("roots, initials, colours", () => {
    expect(rootOf(list, 3)).toBe(1);
    expect(rootOf(list, 1)).toBe(1);
    expect(initialsOf("anna maria berg extra")).toBe("AMB");
    expect(initialsOf("  ")).toBe("");
    expect(authorColor("Anna Berg")).toBe(authorColor(" anna berg "));
    expect(AUTHOR_COLORS).toContain(authorColor("Ben Cole"));
  });

  it("relative dates and the ISO clock", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(relativeDate("2026-10-16T11:59:40Z", now)).toBe("Just now");
    expect(relativeDate("2026-10-16T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeDate("2026-10-16T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeDate("2026-10-01T09:00:00Z", now)).toMatch(/Oct/);
    expect(relativeDate(null, now)).toBe("");
    expect(nowIso(now)).toBe("2026-10-16T12:00:00Z");
  });

  it("ranges of the editor document, innermost and next / previous", () => {
    const editor = editorWith(makeDoc([para(1, [S(1), run("ab"), S(2), run("cd"), E(2), E(1), run("x")]), para(2, [S(3), run("y"), E(3)])]));
    const r = pmRanges(editor.state.doc);
    expect(r.map((x) => x.id)).toEqual([1, 2, 3]);
    const inner = posOf(editor, 1, 4);
    expect(rangeAt(r, inner)?.id).toBe(2);
    expect(rangeAt(r, posOf(editor, 1, 2))?.id).toBe(1);
    expect(rangeAt(r, posOf(editor, 1, 8))).toBeNull();
    expect(nextRange(r, 0, 1)?.id).toBe(1);
    expect(nextRange(r, r[2]!.start + 1, 1)?.id).toBe(1); // wraps
    expect(nextRange(r, r[0]!.start, -1)?.id).toBe(3); // wraps back
    editor.destroy();
  });

  it("the user is remembered in this browser only, and survives broken storage", () => {
    expect(loadUser()).toBeNull();
    saveUser({ name: "Anna Berg", initials: "AB" });
    expect(loadUser()).toEqual({ name: "Anna Berg", initials: "AB" });
    localStorage.setItem("rusuite.write.user", "{broken");
    expect(loadUser()).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveUser({ name: "X", initials: "" })).not.toThrow();
  });

  it("the margin mode: balloons, the pane on narrow windows, indicators when hidden", () => {
    const ui = { show: true, pane: false, filter: "all" as const, active: null, hover: null, draft: null, editing: null };
    expect(commentsMode(ui, 2, 1400)).toBe("balloons");
    expect(commentsMode(ui, 2, 1100)).toBe("pane");
    expect(commentsMode({ ...ui, pane: true }, 2, 1600)).toBe("pane");
    expect(commentsMode({ ...ui, show: false }, 2, 1600)).toBe("indicators");
    expect(commentsMode(ui, 0, 1600)).toBe("none");
  });
});

// ----- balloon layout ----------------------------------------------------------------------

describe("balloon layout", () => {
  it("each balloon at its anchor when there is room", () => {
    const tops = layoutBalloons([
      { id: 1, anchor: 0, height: 50 },
      { id: 2, anchor: 200, height: 50 },
    ]);
    expect([...tops]).toEqual([
      [1, 0],
      [2, 200],
    ]);
  });

  it("overlapping balloons move down, in anchor order", () => {
    const tops = layoutBalloons(
      [
        { id: 2, anchor: 20, height: 60 },
        { id: 1, anchor: 10, height: 60 },
        { id: 3, anchor: 30, height: 60 },
      ],
      8,
    );
    expect(tops.get(1)).toBe(10);
    expect(tops.get(2)).toBe(78);
    expect(tops.get(3)).toBe(146);
  });

  it("the active balloon stays at its anchor; the ones above move up", () => {
    const tops = layoutBalloons(
      [
        { id: 1, anchor: 100, height: 60 },
        { id: 2, anchor: 120, height: 60 },
        { id: 3, anchor: 130, height: 60 },
      ],
      8,
      2,
    );
    expect(tops.get(2)).toBe(120);
    expect(tops.get(1)).toBe(52);
    expect(tops.get(3)).toBe(188);
  });

  it("never above the top: everything moves down again", () => {
    const tops = layoutBalloons(
      [
        { id: 1, anchor: 0, height: 60 },
        { id: 2, anchor: 10, height: 60 },
      ],
      8,
      2,
    );
    expect(tops.get(1)).toBe(0);
    expect(tops.get(2)).toBe(68);
    expect(layoutBalloons([]).size).toBe(0);
  });
});

// ----- thread operations → commands -----------------------------------------------------------

type Cmd = { type: string; [k: string]: unknown };

async function setup(body = [para(1, "hello brave world"), para(2, "second line")]) {
  const backend = new FakeWriteBackend();
  const ctl = new SyncController(new WriteApi(backend));
  const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), SyncExtension(ctl), CommentsExt] });
  await ctl.load(makeDoc(body));
  await ctl.setUser("Anna Berg");
  return { backend, ctl, editor };
}

const sent = (b: FakeWriteBackend): Cmd[] => b.log.flatMap((r) => (r.type === "apply" ? [r.command as Cmd] : []));

describe("thread operations", () => {
  it("a draft covers the selection, or the word at the caret", async () => {
    const { editor } = await setup();
    select(editor, 1, 6, 1, 11);
    expect(draftFromSelection(editor.state)).toMatchObject({ start: { block: 1, offset: 6 }, end: { block: 1, offset: 11 } });
    select(editor, 1, 8);
    expect(draftFromSelection(editor.state)).toMatchObject({ start: { block: 1, offset: 6 }, end: { block: 1, offset: 11 } });
    select(editor, 1, 6, 2, 3);
    expect(draftFromSelection(editor.state)).toMatchObject({ start: { block: 1, offset: 6 }, end: { block: 2, offset: 3 } });
    const [a, b] = wordAt(editor.state, posOf(editor, 1, 0));
    expect(b - a).toBe(5);
    editor.destroy();
  });

  it("addComment sends the range, text and the UI's date; the editor gets the markers", async () => {
    const { backend, ctl, editor } = await setup();
    select(editor, 1, 6, 1, 11);
    const id = await addComment(ctl, draftFromSelection(editor.state)!, "Too bold?", Date.parse("2026-10-16T09:30:00Z"));
    expect(sent(backend).at(-1)).toEqual({ type: "addComment", start: { block: 1, offset: 6 }, end: { block: 1, offset: 11 }, text: "Too bold?", date: "2026-10-16T09:30:00Z" });
    expect(id).toBe(1);
    expect(ctl.comments[0]).toMatchObject({ author: "Anna Berg", initials: "AB" });
    expect(pmRanges(editor.state.doc).map((r) => r.id)).toEqual([1]);
    expect(backend.log.some((r) => r.type === "setUser")).toBe(true);
    editor.destroy();
  });

  it("reply, edit, resolve, reopen and delete map to their commands", async () => {
    const { backend, ctl, editor } = await setup();
    select(editor, 1, 0, 1, 5);
    const id = (await addComment(ctl, draftFromSelection(editor.state)!, "Root"))!;
    const reply = await replyComment(ctl, id, "Answer");
    expect(sent(backend).at(-1)).toMatchObject({ type: "replyComment", parent: id, text: "Answer" });
    expect(ctl.comments.find((c) => c.id === reply)?.parent).toBe(id);
    await editComment(ctl, reply!, "Changed");
    expect(sent(backend).at(-1)).toEqual({ type: "editComment", id: reply, text: "Changed" });
    await resolveComment(ctl, id, true);
    expect(sent(backend).at(-1)).toEqual({ type: "resolveComment", id });
    expect(ctl.comments.every((c) => c.resolved)).toBe(true);
    await resolveComment(ctl, id, false);
    expect(sent(backend).at(-1)).toEqual({ type: "reopenComment", id });
    await deleteComment(ctl, reply!);
    expect(ctl.comments.length).toBe(1);
    await deleteComment(ctl, id);
    expect(ctl.comments.length).toBe(0);
    expect(pmRanges(editor.state.doc)).toEqual([]);
    editor.destroy();
  });

  it("delete all / delete all resolved", async () => {
    const { backend, ctl, editor } = await setup();
    select(editor, 1, 0, 1, 5);
    const a = (await addComment(ctl, draftFromSelection(editor.state)!, "A"))!;
    select(editor, 2, 0, 2, 6);
    await addComment(ctl, draftFromSelection(editor.state)!, "B");
    await resolveComment(ctl, a, true);
    await deleteAllComments(ctl, true);
    expect(sent(backend).at(-1)).toEqual({ type: "deleteAllComments", resolvedOnly: true });
    expect(ctl.comments.map((c) => commentText(c))).toEqual(["B"]);
    await deleteAllComments(ctl);
    expect(sent(backend).at(-1)).toEqual({ type: "deleteAllComments" });
    expect(ctl.comments).toEqual([]);
    editor.destroy();
  });

  it("Previous / Next select the commented text, wrapping around", async () => {
    const { ctl, editor } = await setup();
    select(editor, 1, 0, 1, 5);
    const a = await addComment(ctl, draftFromSelection(editor.state)!, "A");
    select(editor, 2, 0, 2, 6);
    const b = await addComment(ctl, draftFromSelection(editor.state)!, "B");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(goToComment(editor.view, 1)).toBe(a);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("hello");
    expect(goToComment(editor.view, 1)).toBe(b);
    expect(goToComment(editor.view, 1)).toBe(a);
    expect(goToComment(editor.view, -1)).toBe(b);
    editor.destroy();
  });

  it("deleting the commented text in the editor deletes the comment (and converges)", async () => {
    const { ctl, editor } = await setup();
    select(editor, 1, 6, 1, 11);
    await addComment(ctl, draftFromSelection(editor.state)!, "gone soon");
    select(editor, 1, 5, 1, 13); // " ", start, "brave", end
    editor.commands.deleteSelection();
    await ctl.idle();
    expect(ctl.comments).toEqual([]);
    expect(editor.state.doc.textContent.startsWith("hello world")).toBe(true);
    expect(ctl.stats.mismatches).toBe(0);
    editor.destroy();
  });
});

describe("print markup", () => {
  it("marks the ranges [AB1] and lists the threads at the end", () => {
    const p = document.createElement("p");
    p.innerHTML = 'x<span data-comment-start="5"></span>word<span data-comment-end="5"></span> y';
    const list = [comment(5, "Anna Berg", "Check", { initials: "AB", date: "2026-10-16T09:00:00Z" }), comment(6, "Ben Cole", "Yes", { parent: 5 })];
    const out = addCommentMarkup([p], list);
    expect(p.textContent).toBe("xword[AB1] y");
    expect(out.length).toBe(4);
    expect(out[2]!.textContent).toMatch(/^\[AB1\] Anna Berg \(.*\): Check$/);
    expect(out[3]!.className).toContain("print-comment-reply");
    expect(commentLabel(list[1]!, 2)).toBe("[BC2]");
    expect(addCommentMarkup([document.createElement("p")], list).length).toBe(1);
  });
});

// ----- the reference document through the real core ----------------------------------------

const BACKENDS = await backendsUnderTest();
const real = BACKENDS.find((b) => b.name === "real core");
describe.runIf(real)("provisional-59-comments through the real core", () => {
  it("opens with its threads; edits around the markers converge without mismatches", async () => {
    type NodeProcess = { getBuiltinModule(n: string): { readFileSync(p: string): Uint8Array } };
    const fs = (globalThis as unknown as { process: NodeProcess }).process.getBuiltinModule("fs");
    const name = "provisional-59-comments.docx";
    const bytes = fs.readFileSync(new URL(`../../../../testdata/docx/${name}`, import.meta.url).pathname.replace(/^\/@fs/, ""));
    const backend = real!.make();
    const ctl = new SyncController(new WriteApi(backend));
    const editor = new Editor({ element: document.createElement("div"), extensions: [...writeExtensions(), SyncExtension(ctl), CommentsExt] });
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    expect(await ctl.openDocx(btoa(bin), name)).toBe(true);
    expect(ctl.comments.length).toBe(5);
    expect(threads(ctl.comments).length).toBe(4);
    const ranges = pmRanges(editor.state.doc);
    expect(ranges.length).toBe(4);
    // Type inside and right after every range, delete across one start, then a whole range.
    for (const r of [...ranges].reverse()) {
      editor.view.dispatch(editor.state.tr.insertText("Z", r.end));
      editor.view.dispatch(editor.state.tr.insertText("Y", r.start + 2));
    }
    await ctl.idle();
    const r0 = pmRanges(editor.state.doc)[0]!;
    editor.view.dispatch(editor.state.tr.delete(r0.start - 2, r0.start + 3));
    await ctl.idle();
    const last = pmRanges(editor.state.doc).at(-1)!;
    editor.view.dispatch(editor.state.tr.delete(last.start, last.end + 1));
    await ctl.idle();
    expect(ctl.comments.length).toBe(4);
    const reply = await getDoc(backend);
    expect(stableStringify(fromPM(editor.state.doc).map(canonBlock))).toBe(stableStringify(reply.body.map(canonBlock)));
    expect(ctl.stats.mismatches).toBe(0);
    expect(ctl.stats.reloads).toBe(0);
    editor.destroy();
  });
});

async function getDoc(backend: { dispatch: (r: { type: "getDocument" }) => Promise<unknown> }): Promise<Document> {
  const reply = (await backend.dispatch({ type: "getDocument" })) as { ok: { doc: Document } };
  return reply.ok.doc;
}
