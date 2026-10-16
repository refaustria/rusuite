import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeDoc, para, run } from "../test/fixtures";
import { makeEditor, posOf } from "../test/harness";
import { plainLines, plainTextSlice } from "./plainPaste";
import { TextSelection } from "@tiptap/pm/state";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function paste(e: Editor, text: string) {
  const { state } = e;
  const slice = plainTextSlice(text, state.selection.$from, state.schema);
  e.view.dispatch(state.tr.replaceSelection(slice));
}

describe("plain text paste (W-06)", () => {
  it("keeps empty lines; a final line break adds none", () => {
    expect(plainLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(plainLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(plainLines("")).toEqual([""]);
  });

  it("one paragraph per line, the destination's style kept", () => {
    editor = makeEditor(makeDoc([para(1, [run("Start end")], { style: "Quote" })]));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor, 1, 6))));
    paste(editor, "one\n\ntwo ");
    const ps: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "paragraph") ps.push(`${n.attrs.style}:${n.textContent}`);
    });
    expect(ps).toEqual(["Quote:Start one", "Quote:", "Quote:two end"]);
  });

  it("inside a list every line is a list item", () => {
    const numbering = { numId: 1, level: 0 };
    editor = makeEditor(makeDoc([para(1, [run("item")], { numbering })]));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor, 1, 4))));
    paste(editor, " A\nB\nC");
    const items: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "listItem") items.push(`${n.childCount}:${n.textContent}`);
    });
    expect(items).toEqual(["1:item A", "1:B", "1:C"]);
  });
});
