// P8-27: cross-reference targets and commands, captions, Update Fields
// (F9) and the Date & Time / Line and Page Breaks / File › Info helpers.

import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";
import type { Inline } from "../generated/Inline";
import { field, makeDoc, note, noteRef, para, run } from "../test/fixtures";
import { makeEditor, select, Tagger } from "../test/harness";
import {
  captionAnchor, captionCommand, captionLabels, captionPreview, crossRefCommand, refItems, selectsAll, showOptions, updateFieldsCommand,
} from "./references";
import type { FieldContext } from "./structure";
import { dateFormats, dateTimeCommand, isTimeFormat, linkCommands, linkOfValues, linkValues } from "../ui/referenceDialogs";
import { flowPatch, flowValues } from "../ui/dialogs";
import { formatPropertyDate, propertyCommand } from "../ui/InfoPanel";
import { stampProperties } from "../sync/SyncPlugin";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const seq = (id: string, n: string): Inline => field({ kind: "seq", value: { identifier: id } }, n);
const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  pageAt: () => "7",
  pages: () => 9,
  fileName: () => "a.docx",
  now: () => new Date(2026, 9, 16, 10, 30),
  locale: () => "en",
  ...over,
});

function open(): Editor {
  const doc = makeDoc([
    { kind: "paragraph", value: { id: 1, props: { style: "Heading1" }, inlines: [run("Intro")] } },
    para(2, [run("Text"), noteRef(5), run(" and "), field({ kind: "page" }, "1"), field({ kind: "ref", value: { bookmark: "x" } }, "old")]),
    { kind: "paragraph", value: { id: 3, props: { style: "Caption" }, inlines: [run("Figure "), seq("Figure", "1"), run(": cat")] } },
    { kind: "paragraph", value: { id: 4, props: { style: "Caption" }, inlines: [run("Table "), seq("Table", "1")] } },
    { kind: "paragraph", value: { id: 6, inlines: [{ kind: "bookmarkStart", value: { id: 1, name: "mark" } }, run("m"), { kind: "bookmarkEnd", value: { id: 1 } }] } },
    { kind: "paragraph", value: { id: 7, listLabel: "1.", props: { numbering: { numId: 2, level: 0 } }, inlines: [run("First item")] } },
    { kind: "paragraph", value: { id: 8, inlines: [run("Machine"), seq("Machine_Part", "1")] } },
  ]);
  doc.notes = [note(5, "foot", [para(50, " The note")])];
  return (editor = makeEditor(doc, [Tagger]));
}

describe("cross-references", () => {
  it("refItems lists headings, bookmarks, numbered items, notes and captions", () => {
    const e = open();
    expect(refItems(e.state.doc, "heading").map((i) => i.label)).toEqual(["Intro"]);
    expect(refItems(e.state.doc, "bookmark").map((i) => i.target)).toEqual([{ kind: "bookmark", value: "mark" }]);
    expect(refItems(e.state.doc, "numbered").map((i) => i.label)).toEqual(["1. First item"]);
    expect(refItems(e.state.doc, "footnote")).toMatchObject([{ label: "1 The note", target: { kind: "note", value: 5 } }]);
    expect(refItems(e.state.doc, "caption:Figure")).toMatchObject([{ label: "Figure 1: cat", target: { kind: "paragraph", value: 3 } }]);
    expect(refItems(e.state.doc, "caption:Machine Part").length).toBe(1);
  });

  it("showOptions follow Word's lists per type", () => {
    expect(showOptions("footnote")).toEqual(["number", "noteFormatted", "page"]);
    expect(showOptions("heading")).toEqual(["text", "number", "page"]);
    expect(showOptions("caption:Figure")).toContain("number");
  });

  it("crossRefCommand: page numbers come along; a caption's number is its label and number", () => {
    const e = open();
    select(e, 2, 2);
    const [heading] = refItems(e.state.doc, "heading");
    expect(crossRefCommand(e.state, "heading", heading!, "text", true)).toEqual({
      type: "insertCrossReference", block: 2, offset: 2, target: { kind: "paragraph", value: 1 }, show: "text", hyperlink: true,
    });
    expect(crossRefCommand(e.state, "heading", heading!, "page", false)).toMatchObject({ show: "page", page: 1 });
    const [fig] = refItems(e.state.doc, "caption:Figure");
    expect(crossRefCommand(e.state, "caption:Figure", fig!, "number", true)).toMatchObject({ target: { kind: "captionLabel", value: 3 }, show: "text" });
  });

  it("captionLabels: Word's three, then the document's own", () => {
    const e = open();
    expect(captionLabels(e.state.doc, ["Chart"])).toEqual(["Figure", "Table", "Equation", "Chart", "Machine Part"]);
  });
});

describe("captions", () => {
  it("captionCommand goes with the caret's paragraph (or table); the preview counts the captions before", () => {
    const e = open();
    select(e, 6, 0);
    expect(captionAnchor(e.state)).toBe(6);
    expect(captionCommand(e.state, " Figure ", true, ": dog", -9)).toEqual({ type: "insertCaption", anchor: 6, below: true, label: "Figure", text: ": dog", newId: -9 });
    expect(captionCommand(e.state, "", true, "", -9)).toBeNull();
    expect(captionPreview(e.state, "Figure", true)).toBe("Figure 2");
    select(e, 1, 0);
    expect(captionPreview(e.state, "Figure", false)).toBe("Figure 1");
  });
});

describe("Update Fields (F9)", () => {
  it("the selection's fields: live values the UI knows, Rust recomputes the rest", () => {
    const e = open();
    select(e, 2, 1);
    const cmd = updateFieldsCommand(e.state, ctx(), false);
    expect(cmd).toEqual({ type: "updateFields", values: [[2, 10, "7"]], refresh: { pages: [], blocks: [2] } });
  });

  it("Ctrl+A F9: every field (no block scope)", () => {
    const e = open();
    e.view.dispatch(e.state.tr.setSelection(new AllSelection(e.state.doc)));
    expect(selectsAll(e.state)).toBe(true);
    const cmd = updateFieldsCommand(e.state, ctx(), true);
    expect(cmd).toMatchObject({ type: "updateFields", refresh: { pages: [] } });
    expect("blocks" in (cmd as { refresh: object }).refresh).toBe(false);
    select(e, 2, 1);
    expect(selectsAll(e.state)).toBe(false);
  });
});

describe("dialog helpers", () => {
  it("Date & Time: Word's formats per language; a field or plain text", () => {
    expect(dateFormats("de")[0]).toBe("dd.MM.yyyy");
    expect(dateFormats("en")).toContain("MMMM d, yyyy");
    expect(isTimeFormat("HH:mm")).toBe(true);
    expect(isTimeFormat("M/d/yyyy h:mm AM/PM")).toBe(false);
    const now = new Date(2026, 9, 16, 9, 5);
    expect(dateTimeCommand({ block: 1, offset: 0 }, "d.M.yyyy", false, now, "de")).toEqual({ type: "insertText", block: 1, offset: 0, text: "16.10.2026" });
    expect(dateTimeCommand({ block: 1, offset: 0 }, "HH:mm", true, now, "de")).toEqual({
      type: "insertField", block: 1, offset: 0, field: { kind: "time", value: { format: "HH:mm" } }, cached: "09:05",
    });
  });

  it("Insert Hyperlink: values ↔ links; a heading target gets a hidden bookmark", () => {
    const v = linkValues({ block: 1, from: 0, to: 3, text: "abc", link: { target: { kind: "email", value: { address: "a@b.c", subject: "Hi" } } }, textFixed: false });
    expect(v).toMatchObject({ kind: "email", email: "a@b.c", subject: "Hi" });
    expect(linkOfValues({ ...v, kind: "web", address: "" }, null)).toBeNull();
    expect(linkOfValues({ ...v, tooltip: " tip " }, null)).toEqual({ target: { kind: "email", value: { address: "a@b.c", subject: "Hi" } }, tooltip: "tip" });
    const init = { block: 2, from: 0, to: 4, text: "Text", link: null, textFixed: false };
    const cmds = linkCommands(init, { ...linkValues(init), kind: "place", place: "heading:1" }, () => 5, "_Ref100000001");
    expect(cmds).toEqual([
      { type: "setHyperlink", block: 2, from: 0, to: 4, link: { target: { kind: "bookmark", value: "_Ref100000001" } } },
      { type: "addBookmark", name: "_Ref100000001", start: { block: 1, offset: 0 }, end: { block: 1, offset: 5 } },
    ]);
  });

  it("Line and Page Breaks: Word's defaults, only changed options are sent", () => {
    const before = flowValues({ keepNext: true });
    expect(before).toMatchObject({ widowControl: true, keepNext: true, keepLines: false });
    expect(flowPatch(before, { ...before, keepNext: false, pageBreakBefore: true })).toEqual({ keepNext: false, pageBreakBefore: true });
  });

  it("File › Info: SetProperties per edited field; dates for display; the save stamp", () => {
    expect(propertyCommand({ title: "A" }, "title", " B ")).toEqual({ type: "setProperties", patch: { title: "B" } });
    expect(propertyCommand({ title: "A" }, "title", "A")).toBeNull();
    expect(propertyCommand({}, "subject", "")).toBeNull();
    expect(propertyCommand({ author: "X" }, "author", "")).toEqual({ type: "setProperties", patch: { author: "" } });
    expect(formatPropertyDate("2026-10-16T10:00:00Z", "en")).toContain("2026");
    expect(formatPropertyDate("garbage")).toBe("garbage");
    expect(stampProperties({ revision: 2 }, { modified: "2026-10-16T10:00:00Z", user: "Ann", pages: 3 })).toEqual({
      revision: 3, modified: "2026-10-16T10:00:00Z", created: "2026-10-16T10:00:00Z", lastModifiedBy: "Ann", author: "Ann", pages: 3,
    });
  });
});
