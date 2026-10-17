// P9-W6: field instructions and the field codes view (Alt+F9 / Shift+F9),
// Lock Fields, F9 leaving locked fields alone, STYLEREF / SECTIONPAGES per
// page in headers, the Field dialog's kinds, Convert Notes, the balloon
// editor's content (formatting, @mentions), the @ picker, Display for
// Review and the balloon layout around page gaps, markup print balloons.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import type { Block } from "../generated/Block";
import type { Comment } from "../generated/Comment";
import type { FieldKind } from "../generated/FieldKind";
import { field, makeDoc, para, run } from "../test/fixtures";
import { makeEditor, posOf, select, Tagger } from "../test/harness";
import { Extension } from "@tiptap/core";
import { fieldCode, fieldCodesKey, fieldCodesPlugin, fieldInstruction, lockFieldsCommand, showsAllCodes, styleRefOnPage, toggleAllFieldCodes, toggleSelectedFieldCodes } from "./fieldsW6";
import { blocksText } from "./pagination";
import { updateFieldsCommand } from "./references";
import type { FieldContext } from "./structure";
import { convertNotesCommands, DEFAULT_CHOICE, fieldFromChoice } from "../ui/w6Dialogs";
import { commentToPM, hasFormatting, mentionCandidates, mentionQuery, pmText, pmToCommentBlocks } from "../comments/richText";
import { avoidPageGaps, layoutBalloons } from "../comments/model";
import { commentsMode } from "../comments/CommentsUi";
import { markupPageHtml } from "../print/writePrintDoc";
import { pageGeometry } from "./pagination";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const Codes = Extension.create({ name: "testCodes", addProseMirrorPlugins: () => [fieldCodesPlugin()] });

const ctx: FieldContext = { pageAt: () => "3", pages: () => 5, fileName: () => null, now: () => new Date(2026, 9, 17), locale: () => "en" };

describe("field instructions", () => {
  it("mirror the core's (Alt+F9 shows them in braces)", () => {
    const cases: [FieldKind, string][] = [
      [{ kind: "page" }, "PAGE"],
      [{ kind: "sectionPages" }, "SECTIONPAGES"],
      [{ kind: "date", value: { format: "d.M.yyyy" } }, 'DATE \\@ "d.M.yyyy"'],
      [{ kind: "seq", value: { identifier: "Figure", format: "upperRoman", current: true, reset: 2, headingReset: 1, hidden: true } }, "SEQ Figure \\* ROMAN \\c \\r 2 \\s 1 \\h"],
      [{ kind: "ref", value: { bookmark: "_Ref1", number: true, position: true, hyperlink: true } }, "REF _Ref1 \\n \\p \\h"],
      [{ kind: "styleRef", value: { style: "Heading 1", last: true } }, 'STYLEREF "Heading 1" \\l'],
      [{ kind: "docProperty", value: { name: "Company" } }, "DOCPROPERTY Company"],
      [{ kind: "noteRef", value: { bookmark: "n", formatted: true } }, "NOTEREF n \\f"],
    ];
    for (const [k, s] of cases) expect(fieldInstruction(k)).toBe(s);
    expect(fieldCode({ kind: "page" })).toBe("{ PAGE }");
  });
});

describe("field codes view", () => {
  const doc = () => makeDoc([para(1, [run("Page "), field({ kind: "page" }, "1"), run(" of "), field({ kind: "numPages" }, "2")])]);
  const codes = (e: Editor) => Array.from(e.view.dom.querySelectorAll<HTMLElement>(".field-show-code")).map((x) => x.dataset.code);

  it("Alt+F9 shows every field's code, again hides them", () => {
    editor = makeEditor(doc(), [Tagger, Codes]);
    editor.view.dispatch(toggleAllFieldCodes(editor.state));
    expect(showsAllCodes(editor.state)).toBe(true);
    expect(codes(editor)).toEqual(["{ PAGE }", "{ NUMPAGES }"]);
    editor.view.dispatch(toggleAllFieldCodes(editor.state));
    expect(codes(editor)).toEqual([]);
  });

  it("Shift+F9 toggles the selection's fields only, and they follow edits", () => {
    editor = makeEditor(doc(), [Tagger, Codes]);
    select(editor, 1, 5, 1, 6);
    editor.view.dispatch(toggleSelectedFieldCodes(editor.state)!);
    expect(codes(editor)).toEqual(["{ PAGE }"]);
    editor.view.dispatch(editor.state.tr.insertText("X", posOf(editor, 1, 0)));
    expect(codes(editor)).toEqual(["{ PAGE }"]);
    expect(fieldCodesKey.getState(editor.state)!.toggled).toHaveLength(1);
    // With Alt+F9 on, Shift+F9 shows that field's result again.
    editor.view.dispatch(toggleAllFieldCodes(editor.state));
    select(editor, 1, 6, 1, 7);
    editor.view.dispatch(toggleSelectedFieldCodes(editor.state)!);
    expect(codes(editor)).toEqual(["{ NUMPAGES }"]);
    select(editor, 1, 1);
    expect(toggleSelectedFieldCodes(editor.state)).toBeNull();
  });
});

describe("lock and update", () => {
  it("Ctrl+F11 locks the selection's paragraphs' fields; Ctrl+A locks all", () => {
    editor = makeEditor(makeDoc([para(1, [field({ kind: "page" })]), para(2, "x")]));
    select(editor, 1, 0, 2, 1);
    expect(lockFieldsCommand(editor.state, true, false)).toEqual({ type: "lockFields", blocks: [1, 2], locked: true });
    expect(lockFieldsCommand(editor.state, false, true)).toEqual({ type: "lockFields", locked: false });
  });

  it("F9 leaves locked fields alone and lets the core compute STYLEREF", () => {
    const locked: Block = para(1, [{ kind: "field", value: { kind: { kind: "page" }, cached: "9", locked: true } }, field({ kind: "page" }, "9"), field({ kind: "styleRef", value: { style: "Heading 1" } }, "")]);
    editor = makeEditor(makeDoc([locked]));
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const cmd = updateFieldsCommand(editor.state, ctx, true);
    expect(cmd).toMatchObject({ type: "updateFields", values: [[1, 1, "3"]] });
    expect(editor.state.doc.child(0).child(0).attrs.locked).toBe(true);
  });
});

describe("header fields per page", () => {
  it("STYLEREF takes the first (\\l: last) heading on the page, else the one before", () => {
    editor = makeEditor(makeDoc([para(1, "Intro", { style: "Heading1" }), para(2, "a"), para(3, "Methods", { style: "Heading1" }), para(4, "b")]));
    const doc = editor.state.doc;
    const p3 = posOf(editor, 3, 0) - 1;
    expect(styleRefOnPage(doc, 0, p3, "Heading 1", false)).toBe("Intro");
    expect(styleRefOnPage(doc, 0, doc.content.size, "Heading 1", true)).toBe("Methods");
    // A page without a heading shows the one before it.
    const p4 = posOf(editor, 4, 0) - 1;
    expect(styleRefOnPage(doc, p4, doc.content.size, "heading1", false)).toBe("Methods");
    expect(styleRefOnPage(doc, 0, doc.content.size, "Quote", false)).toBeNull();
    const header: Block[] = [para(9, [field({ kind: "styleRef", value: { style: "Heading 1" } }, "old"), run(" – "), field({ kind: "sectionPages" }, "?"), field({ kind: "page" })])];
    expect(blocksText(header)).toBe("old – ?{PAGE}");
    expect(blocksText(header, { styleRef: () => "Methods", sectionPages: 4 })).toBe("Methods – 4{PAGE}");
  });
});

describe("Insert › Field dialog", () => {
  it("turns choices into field kinds", () => {
    expect(fieldFromChoice({ ...DEFAULT_CHOICE, name: "SEQ", identifier: "Table", format: "lowerLetter", current: true, headingReset: "2" })).toEqual({
      kind: "seq", value: { identifier: "Table", format: "lowerLetter", current: true, headingReset: 2 },
    });
    expect(fieldFromChoice({ ...DEFAULT_CHOICE, name: "REF", bookmark: "" })).toBeNull();
    expect(fieldFromChoice({ ...DEFAULT_CHOICE, name: "REF", bookmark: "b", hyperlink: false, full: true })).toEqual({ kind: "ref", value: { bookmark: "b", full: true } });
    expect(fieldFromChoice({ ...DEFAULT_CHOICE, name: "STYLEREF", last: true })).toEqual({ kind: "styleRef", value: { style: "Heading 1", last: true } });
    expect(fieldFromChoice({ ...DEFAULT_CHOICE, name: "DATE", picture: "yyyy" })).toEqual({ kind: "date", value: { format: "yyyy" } });
    expect(fieldFromChoice({ ...DEFAULT_CHOICE, name: "SECTIONPAGES" })).toEqual({ kind: "sectionPages" });
  });

  it("Convert Notes: all one way, or swapped", () => {
    const notes = [{ id: 1, kind: "foot" as const }, { id: 2, kind: "end" as const }];
    expect(convertNotesCommands("footToEnd", notes)).toEqual([{ type: "convertNotes", to: "end" }]);
    expect(convertNotesCommands("swap", notes)).toEqual([
      { type: "convertNotes", ids: [1], to: "end" },
      { type: "convertNotes", ids: [2], to: "foot" },
    ]);
  });
});

describe("balloon editor content", () => {
  const blocks: Block[] = [
    {
      kind: "paragraph",
      value: {
        id: 5,
        props: { style: "CommentText" },
        inlines: [
          run("Fix ", { bold: true }),
          run("this", { italic: true, underline: "single" }),
          { kind: "run", value: { text: "@Bo Lee", style: "Mention", link: { target: { kind: "email", value: { address: "bo@example.com" } } } } },
          { kind: "run", value: { text: " see", link: { target: { kind: "url", value: "https://example.com" } } } },
        ],
      },
    },
  ];

  it("round-trips formatting, links and mentions", () => {
    const pm = commentToPM(blocks);
    expect(pm.content![0]!.content!.map((n) => n.marks?.map((m) => m.type).join("+") ?? "")).toEqual(["bold", "italic+underline", "link", "link"]);
    let id = -1;
    const back = pmToCommentBlocks(pm, () => id--);
    const inlines = back[0]!.kind === "paragraph" ? back[0]!.value.inlines : [];
    expect(inlines).toEqual([
      run("Fix ", { bold: true }),
      run("this", { italic: true, underline: "single" }),
      { kind: "run", value: { text: "@Bo Lee", style: "Mention", link: { target: { kind: "email", value: { address: "bo@example.com" } } } } },
      { kind: "run", value: { text: " see", link: { target: { kind: "url", value: "https://example.com" } } } },
    ]);
    expect(back[0]!.value.id).toBe(-1);
    expect(hasFormatting(back)).toBe(true);
    expect(pmText(pm)).toBe("Fix this@Bo Lee see");
  });

  it("merges runs of one format and drops trailing empty paragraphs", () => {
    const back = pmToCommentBlocks({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }, { type: "paragraph" }] }, () => -9);
    expect(back).toEqual([{ kind: "paragraph", value: { id: -9, inlines: [run("ab")] } }]);
    expect(hasFormatting(back)).toBe(false);
  });

  it("@ offers the document's authors", () => {
    expect(mentionQuery("Hello @an")).toBe("an");
    expect(mentionQuery("Hello @")).toBe("");
    expect(mentionQuery("mail@an")).toBeNull();
    const comments = [{ id: 1, author: "Ann Lee" }, { id: 2, author: "Bo" }] as Comment[];
    const people = [{ author: "Bo", providerId: "AD", userId: "bo@example.com" }];
    const all = mentionCandidates(comments, people, "Carla", "Ann Lee", "");
    expect(all.map((p) => [p.name, p.email])).toEqual([["Ann Lee", "Ann Lee"], ["Bo", "bo@example.com"], ["Carla", "Carla"]]);
    expect(mentionCandidates(comments, people, null, null, "le").map((p) => p.name)).toEqual(["Ann Lee"]);
  });
});

describe("Display for Review and balloon layout", () => {
  const ui = { show: true, pane: false, filter: "all" as const, active: null, hover: null, draft: null, editing: null, markup: "all" as const };
  it("Simple Markup shows markers, No Markup / Original nothing", () => {
    expect(commentsMode({ ...ui, markup: "simple" }, 2, 1600)).toBe("indicators");
    expect(commentsMode({ ...ui, markup: "none" }, 2, 1600)).toBe("none");
    expect(commentsMode({ ...ui, markup: "original" }, 2, 1600)).toBe("none");
    // The pane stays available; a new comment shows its balloon.
    expect(commentsMode({ ...ui, markup: "none", pane: true }, 2, 1600)).toBe("pane");
    expect(commentsMode({ ...ui, markup: "simple", draft: { from: 1, to: 2, start: { block: 1, offset: 0 }, end: { block: 1, offset: 1 } } }, 2, 1600)).toBe("balloons");
  });

  it("balloons never sit in a page gap: they move to the next page's top", () => {
    const boxes = [
      { id: 1, anchor: 900, height: 80 },
      { id: 2, anchor: 950, height: 40 },
      { id: 3, anchor: 2000, height: 40 },
    ];
    const tops = layoutBalloons(boxes, 8, null, 0, [[960, 1000]]);
    // 1 would cross the gap (900–980): next page top + gap; 2 below it; 3 untouched.
    expect(tops.get(1)).toBe(1008);
    expect(tops.get(2)).toBe(1096);
    expect(tops.get(3)).toBe(2000);
    expect(avoidPageGaps(boxes, new Map([[1, 100], [2, 200], [3, 300]]), 8, [])).toEqual(new Map([[1, 100], [2, 200], [3, 300]]));
  });

  it("markup print puts the page's balloons in a pane at the right", () => {
    const geo = pageGeometry(null);
    const c: Comment = { id: 4, author: "Ann", content: [para(1, [run("Bold", { bold: true }), run(" text")])] };
    const html = markupPageHtml("<p>page</p>", geo, [{ id: 4, page: 0, y: 200 }], [c]);
    const host = document.createElement("div");
    host.innerHTML = html;
    const pane = host.querySelector<HTMLElement>(".rs-markup-pane")!;
    expect(parseFloat(pane.style.left)).toBeGreaterThan(geo.width / 2);
    const balloon = pane.querySelector<HTMLElement>("[data-comment-balloon='4']")!;
    expect(balloon.innerHTML).toContain("<b>Bold</b>");
    expect(balloon.textContent).toContain("Ann");
    expect(host.querySelector<HTMLElement>(".rs-markup-page")!.style.zoom).toBe("0.72");
  });
});

describe("selections", () => {
  it("Shift+F9 with a caret right after a field toggles that field", () => {
    editor = makeEditor(makeDoc([para(1, [run("a"), field({ kind: "page" }, "1")])]), [Tagger, Codes]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor, 1, 2))));
    expect(toggleSelectedFieldCodes(editor.state)).not.toBeNull();
  });
});
