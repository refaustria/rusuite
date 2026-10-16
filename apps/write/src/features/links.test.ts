// P8-27: links (resolution, following, the dialog's start values and
// commands) and bookmarks (list, names, commands, Go To) on headless editors.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Extension, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Hyperlink } from "../generated/Hyperlink";
import type { Inline } from "../generated/Inline";
import { makeDoc, para, run } from "../test/fixtures";
import { makeEditor, posOf, select, Tagger } from "../test/harness";
import {
  addBookmarkCommand, addressOf, bookmarkList, followLink, freshRefName, goToBookmark, headingsOf, hyperlinkCommand, linkAt, linkDialogInit,
  linksPlugin, parseAddress, removeLinkCommand, resolveLink, validBookmarkName,
} from "./links";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const WEB: Hyperlink = { target: { kind: "url", value: "https://rusuite.example/" }, tooltip: "Home" };
const linked = (text: string, link: Hyperlink): Inline => ({ kind: "run", value: { text, style: "Hyperlink", link } });
const bm = (id: number, name: string): Inline => ({ kind: "bookmarkStart", value: { id, name } });
const bmEnd = (id: number): Inline => ({ kind: "bookmarkEnd", value: { id } });

function open(extra: Extension[] = []): Editor {
  const doc = makeDoc([
    para(1, [run("Visit "), linked("our site", WEB), run(" now")]),
    para(2, [bm(1, "Results"), run("Results here"), bmEnd(1)]),
    { kind: "paragraph", value: { id: 3, props: { style: "Heading1" }, inlines: [run("Intro")] } },
    para(4, [bm(2, "_Ref123456789"), run("hidden"), bmEnd(2), bm(3, "alpha"), run("a"), bmEnd(3)]),
  ]);
  return (editor = makeEditor(doc, [Tagger, ...extra]));
}

describe("addresses", () => {
  it("parseAddress: web, www, e-mail, mailto with subject, #bookmark, empty", () => {
    expect(parseAddress("https://a.at/x")).toEqual({ kind: "url", value: "https://a.at/x" });
    expect(parseAddress("www.rusuite.at")).toEqual({ kind: "url", value: "https://www.rusuite.at" });
    expect(parseAddress("ann@example.com")).toEqual({ kind: "email", value: { address: "ann@example.com" } });
    expect(parseAddress("mailto:ann@example.com?subject=Hi%20there")).toEqual({ kind: "email", value: { address: "ann@example.com", subject: "Hi there" } });
    expect(parseAddress("#intro")).toEqual({ kind: "bookmark", value: "intro" });
    expect(parseAddress("  ")).toBeNull();
    expect(parseAddress("#")).toBeNull();
  });

  it("addressOf shows the URL, the address or the bookmark name", () => {
    expect(addressOf(WEB.target)).toBe("https://rusuite.example/");
    expect(addressOf({ kind: "email", value: { address: "a@b.c" } })).toBe("a@b.c");
    expect(addressOf({ kind: "bookmark", value: "x" })).toBe("x");
  });
});

describe("links at the caret", () => {
  it("linkAt finds the whole link from inside it and at its end", () => {
    const e = open();
    const inside = linkAt(e.state, posOf(e, 1, 8));
    expect(inside).toMatchObject({ block: 1, fromOffset: 6, toOffset: 14, text: "our site" });
    expect(linkAt(e.state, posOf(e, 1, 14))?.text).toBe("our site");
    expect(linkAt(e.state, posOf(e, 1, 2))).toBeNull();
  });

  it("linkDialogInit: an existing link, a selection, a caret, a selection over paragraphs", () => {
    const e = open();
    select(e, 1, 9);
    expect(linkDialogInit(e.state)).toMatchObject({ block: 1, from: 6, to: 14, text: "our site", link: WEB, textFixed: false });
    select(e, 1, 0, 1, 5);
    expect(linkDialogInit(e.state)).toMatchObject({ from: 0, to: 5, text: "Visit", link: null });
    select(e, 3, 2);
    expect(linkDialogInit(e.state)).toMatchObject({ block: 3, from: 2, to: 2, text: "" });
    select(e, 1, 0, 3, 2);
    expect(linkDialogInit(e.state)?.textFixed).toBe(true);
  });

  it("hyperlinkCommand: the text only when it changed or nothing was selected; Remove Link", () => {
    const e = open();
    select(e, 1, 0, 1, 5);
    const init = linkDialogInit(e.state)!;
    expect(hyperlinkCommand(init, WEB, "Visit")).toEqual({ type: "setHyperlink", block: 1, from: 0, to: 5, link: WEB });
    expect(hyperlinkCommand(init, WEB, "Go")).toMatchObject({ text: "Go" });
    select(e, 3, 5);
    expect(hyperlinkCommand(linkDialogInit(e.state)!, WEB, "")).toMatchObject({ from: 5, to: 5, text: "https://rusuite.example/" });
    select(e, 1, 7);
    expect(removeLinkCommand(e.state)).toEqual({ type: "removeHyperlink", block: 1, from: 6, to: 14 });
    select(e, 3, 2);
    expect(removeLinkCommand(e.state)).toBeNull();
  });
});

describe("following links", () => {
  it("resolveLink: bookmarks case-insensitively, _top, missing ones, external hrefs", () => {
    const e = open();
    const r = resolveLink(e.state.doc, { target: { kind: "bookmark", value: "results" } });
    expect(r.kind).toBe("internal");
    expect(resolveLink(e.state.doc, { target: { kind: "bookmark", value: "_top" } })).toEqual({ kind: "internal", pos: 0 });
    expect(resolveLink(e.state.doc, { target: { kind: "bookmark", value: "nope" } })).toEqual({ kind: "missing" });
    expect(resolveLink(e.state.doc, { target: { kind: "email", value: { address: "a@b.c", subject: "x y" } } })).toEqual({ kind: "external", href: "mailto:a@b.c?subject=x%20y" });
  });

  it("followLink: internal moves the caret to the bookmark; external goes through the opener, not window.open", () => {
    const e = open();
    const spy = vi.spyOn(window, "open").mockImplementation(() => null);
    const opened: string[] = [];
    followLink(e.view, { target: { kind: "bookmark", value: "RESULTS" } }, (h) => opened.push(h));
    expect(e.state.selection.$from.parent.attrs.id).toBe(2);
    followLink(e.view, WEB, (h) => opened.push(h));
    expect(opened).toEqual(["https://rusuite.example/"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Ctrl+click on a link follows it, a plain click does not", () => {
    const opened: string[] = [];
    const e = open([Extension.create({ name: "links", addProseMirrorPlugins: () => [linksPlugin((h) => opened.push(h))] })]);
    const pos = posOf(e, 1, 8);
    const click = (ctrlKey: boolean) => e.view.someProp("handleClick", (f) => f(e.view, pos, new MouseEvent("click", { ctrlKey })));
    expect(click(false)).toBeFalsy();
    expect(opened).toEqual([]);
    expect(click(true)).toBe(true);
    expect(opened).toEqual(["https://rusuite.example/"]);
  });

  it("the link mark renders an anchor with Word's tooltip", () => {
    const e = open();
    const a = e.view.dom.querySelector("a.doc-link") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://rusuite.example/");
    expect(a.title).toContain("Home");
    expect(a.title).toContain("Ctrl+Click to follow link");
  });
});

describe("bookmarks", () => {
  it("bookmarkList: by name or location, hidden ones only on request", () => {
    const e = open();
    expect(bookmarkList(e.state.doc, "name", false).map((b) => b.name)).toEqual(["alpha", "Results"]);
    expect(bookmarkList(e.state.doc, "location", false).map((b) => b.name)).toEqual(["Results", "alpha"]);
    expect(bookmarkList(e.state.doc, "location", true).map((b) => b.name)).toEqual(["Results", "_Ref123456789", "alpha"]);
  });

  it("validBookmarkName: Word's rules", () => {
    expect(validBookmarkName("Intro_2")).toBe(true);
    expect(validBookmarkName("Überblick")).toBe(true);
    expect(validBookmarkName("_hidden")).toBe(true);
    expect(validBookmarkName("2nd")).toBe(false);
    expect(validBookmarkName("two words")).toBe(false);
    expect(validBookmarkName("x".repeat(41))).toBe(false);
  });

  it("addBookmarkCommand: the selection's points; invalid names give nothing", () => {
    const e = open();
    select(e, 1, 2, 3, 3);
    expect(addBookmarkCommand(e.state, "span")).toEqual({ type: "addBookmark", name: "span", start: { block: 1, offset: 2 }, end: { block: 3, offset: 3 } });
    expect(addBookmarkCommand(e.state, "bad name")).toBeNull();
  });

  it("freshRefName is unused; goToBookmark selects the bookmarked text; headingsOf lists headings", () => {
    const e = open();
    const name = freshRefName(e.state.doc);
    expect(name).toMatch(/^_Ref\d{9}$/);
    expect(bookmarkList(e.state.doc, "name", true).some((b) => b.name === name)).toBe(false);
    expect(goToBookmark(e.view, "results")).toBe(true);
    const { from, to } = e.state.selection;
    expect(e.state.doc.textBetween(from, to)).toBe("Results here");
    expect(goToBookmark(e.view, "missing")).toBe(false);
    expect(headingsOf(e.state.doc).map((h) => [h.id, h.text, h.level])).toEqual([[3, "Intro", 1]]);
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 1)));
  });
});
