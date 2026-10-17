// P9-W4 item 3: links on pictures and shapes (Insert › Link, Remove Link
// keeps the object, Ctrl+click follows), HYPERLINK field links stay fields
// when edited, Mark as decorative → SetImageAlt.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Drawing } from "../generated/Drawing";
import type { Hyperlink } from "../generated/Hyperlink";
import type { Inline } from "../generated/Inline";
import { makeDoc, para, run } from "../test/fixtures";
import { change, makeEditor, select, Tagger } from "../test/harness";
import { setImageAttrs } from "./images";
import { hyperlinkCommand, linkDialogInit, linksPlugin, objectLink, objectLinkOf, removeLinkCommand } from "./links";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const WEB: Hyperlink = { target: { kind: "url", value: "https://rusuite.example/" }, tooltip: "Home" };
const shape: Drawing = { id: 20, width: 952500, height: 952500, preset: "heart", link: WEB };
const img: Inline = { kind: "image", value: { media: 3, width: 952500, height: 952500, link: WEB } };

function open(opener?: (href: string) => void): Editor {
  const doc = makeDoc([
    para(1, [run("A "), img, run(" and "), { kind: "drawing", value: shape }]),
    para(2, [run("Field "), { kind: "run", value: { text: "link", style: "Hyperlink", link: { ...WEB, field: true } } }]),
  ]);
  const ext = opener ? [Extension.create({ name: "linksTest", addProseMirrorPlugins: () => [linksPlugin(opener)] })] : [];
  return (editor = makeEditor(doc, [Tagger, ...ext]));
}

function selectNode(e: Editor, type: string) {
  let at = -1;
  e.state.doc.descendants((n, p) => {
    if (at < 0 && n.type.name === type) at = p;
    return at < 0;
  });
  e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, at)));
  return at;
}

describe("links on pictures and shapes", () => {
  it("Insert › Link on a selected shape edits the shape's link (SetDrawingProps without its text)", () => {
    const e = open();
    selectNode(e, "drawing");
    const init = linkDialogInit(e.state)!;
    expect(init).toMatchObject({ block: 1, from: 8, to: 9, textFixed: true, link: WEB });
    expect(init.drawing?.id).toBe(20);
    const next: Hyperlink = { target: { kind: "bookmark", value: "intro" } };
    expect(hyperlinkCommand(init, next, "")).toEqual({ type: "setDrawingProps", block: 1, offset: 8, drawing: { id: 20, width: 952500, height: 952500, preset: "heart", link: next } });
  });

  it("Remove Link keeps the picture and the shape", () => {
    const e = open();
    selectNode(e, "image");
    expect(removeLinkCommand(e.state)).toEqual({ type: "setImageLink", block: 1, offset: 2, link: null });
    selectNode(e, "drawing");
    expect(removeLinkCommand(e.state)).toEqual({ type: "setDrawingProps", block: 1, offset: 8, drawing: { id: 20, width: 952500, height: 952500, preset: "heart" } });
    expect(objectLink(e.state)?.link).toEqual(WEB);
    expect(objectLinkOf(e.state.doc.nodeAt(e.state.selection.from))).toEqual(WEB);
  });

  it("Ctrl+click on a picture or shape follows its link; a plain click does not", () => {
    const opened = vi.fn();
    const e = open(opened);
    const wrap = e.view.dom.querySelector(".inline-image-wrap")!;
    wrap.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
    wrap.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(opened).toHaveBeenCalledWith("https://rusuite.example/");
    e.view.dom.querySelector(".drawing-wrap")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("an edited HYPERLINK field link stays a field", () => {
    const e = open();
    select(e, 2, 7);
    const init = linkDialogInit(e.state)!;
    expect(init.link?.field).toBe(true);
    const cmd = hyperlinkCommand(init, { target: { kind: "url", value: "https://other.example/" } }, "link");
    expect(cmd).toMatchObject({ type: "setHyperlink", link: { target: { value: "https://other.example/" }, field: true } });
  });

  it("Mark as decorative → SetImageAlt with the flag", () => {
    const e = open();
    const pos = selectNode(e, "image");
    const r = change(e, () => setImageAttrs(e.view, pos, { alt: null, decorative: true }));
    expect(r?.command).toEqual({ type: "setImageAlt", block: 1, offset: 2, alt: null, decorative: true });
  });
});
