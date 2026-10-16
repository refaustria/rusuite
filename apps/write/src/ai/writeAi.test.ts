// P8-37: Write's AI actions map to ordinary edits – the selection's text, Replace / Insert as one transaction, drafts
// and tables as one `insertBlocks` command (one undo step).
import { describe, expect, it } from "vitest";
import { change, makeEditor, select } from "../test/harness";
import { makeDoc, para } from "../test/fixtures";
import { draftNodes, insertBlocks, paragraphNodes, replaceRange, selectionRange, tableNode } from "./writeAi";
import type { WriteCommand } from "../generated/WriteCommand";

const doc = () => makeDoc([para(1, "Teh report are late."), para(2, "Second paragraph.")]);

describe("Write AI", () => {
  it("context: the selection, else the caret's paragraph", () => {
    const editor = makeEditor(doc());
    select(editor, 1, 4, 1, 10);
    expect(selectionRange(editor)).toMatchObject({ text: "report", whole: false });
    select(editor, 2, 3);
    expect(selectionRange(editor)).toMatchObject({ text: "Second paragraph.", whole: true });
    select(editor, 1, 0, 2, 6);
    expect(selectionRange(editor).text).toBe("Teh report are late.\n\nSecond");
  });

  it("Replace selection: one text replacement in the paragraph", () => {
    const editor = makeEditor(doc());
    select(editor, 1, 0, 1, 20);
    const anchor = selectionRange(editor);
    const r = change(editor, () => replaceRange(editor, anchor, "The report is late."));
    expect(editor.state.doc.child(0).textContent).toBe("The report is late.");
    expect(r?.command.type).toMatch(/replaceText|insertText|replaceBlocks|compound/);
  });

  it("Replace keeps working on the selection if the anchored text changed", () => {
    const editor = makeEditor(doc());
    select(editor, 2, 0, 2, 6);
    replaceRange(editor, { from: 1, to: 4, text: "not there" }, "First");
    expect(editor.state.doc.child(1).textContent).toBe("First paragraph.");
  });

  it("multi-paragraph answers become paragraphs; Markdown is stripped", () => {
    expect(paragraphNodes("**One**\n\nTwo")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "One" }] },
      { type: "paragraph", content: [{ type: "text", text: "Two" }] },
    ]);
  });

  it("Draft: headings and paragraphs after the caret's block as one insertBlocks", () => {
    const editor = makeEditor(doc());
    select(editor, 1, 3);
    const r = change(editor, () => insertBlocks(editor, draftNodes([{ kind: "heading", level: 2, text: "Plan" }, { kind: "paragraph", text: "Body." }])));
    const cmd = r!.command as Extract<WriteCommand, { type: "insertBlocks" }>;
    expect(cmd.type).toBe("insertBlocks");
    expect(cmd.after).toBe(1);
    expect(cmd.blocks).toHaveLength(2);
    expect(cmd.blocks[0]).toMatchObject({ kind: "paragraph", value: { props: { style: "Heading2" } } });
    expect(editor.state.doc.child(1).textContent).toBe("Plan");
  });

  it("Table from text: one insertBlocks with a table, header row bold", () => {
    const editor = makeEditor(doc());
    select(editor, 2, 0);
    const r = change(editor, () => insertBlocks(editor, [tableNode({ header: true, rows: [["Name", "Age"], ["Ann", "31"]] })]));
    const cmd = r!.command as Extract<WriteCommand, { type: "insertBlocks" }>;
    expect(cmd.type).toBe("insertBlocks");
    expect(cmd.after).toBe(2);
    const table = cmd.blocks[0]!;
    expect(table.kind).toBe("table");
    if (table.kind !== "table") return;
    expect(table.value.rows).toHaveLength(2);
    expect(JSON.stringify(table.value.rows[0])).toContain('"bold":true');
    expect(JSON.stringify(table.value.rows[1])).toContain("Ann");
  });
});
