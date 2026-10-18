// P8-37: Write's AI actions map to ordinary edits – the selection's text, Replace / Insert as one transaction, drafts
// and tables as one `insertBlocks` command (one undo step).
import { describe, expect, it } from "vitest";
import { change, makeEditor, select } from "../test/harness";
import { FIXTURES, PNG_1PX, makeDoc, para } from "../test/fixtures";
import { NodeSelection } from "@tiptap/pm/state";
import type { SyncController } from "../sync/SyncPlugin";
import { cleanAltText, draftNodes, insertBlocks, paragraphNodes, replaceRange, selectionRange, tableNode, writeAiAdapter, type WriteAnchor } from "./writeAi";
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

// P9-A1: "Describe picture → alt text" writes through the image's alt attribute (SetImageAlt).
describe("Write AI pictures", () => {
  const ctl = { media: { resolve: async () => `data:image/png;base64,${PNG_1PX}` }, getState: () => ({ name: "Doc.docx" }) } as unknown as SyncController;
  const imagePos = (editor: ReturnType<typeof makeEditor>) => {
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === "image") pos = p;
    });
    return pos;
  };

  it("cleanAltText: one line, no preface or quotes", () => {
    expect(cleanAltText('Alt text: "A red bar chart\nof sales."')).toBe("A red bar chart of sales.");
    expect(cleanAltText("„Ein Logo“")).toBe("Ein Logo");
  });

  it("the action and the attach button need a selected picture; Set as alt text writes it", async () => {
    const editor = makeEditor(FIXTURES.image!);
    const ai = writeAiAdapter(editor, ctl);
    const alt = ai.actions().find((a) => a.id === "alt")!;
    expect(alt.unavailable?.()).toBe("Select a picture first.");
    expect(ai.attachSources?.[0]?.unavailable()).toBe("Select a picture first.");
    const pos = imagePos(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
    expect(alt.unavailable?.()).toBeNull();
    expect(ai.selectionLabel()).toBe("selected picture");
    const anchor = ai.anchor!() as WriteAnchor;
    expect(anchor.image).toEqual({ pos, media: 1 });
    const r = change(editor, () => alt.apply[0]!.run("Alt text: The company logo.", { anchor } as never));
    expect(editor.state.doc.nodeAt(pos)!.attrs.alt).toBe("The company logo.");
    expect(JSON.stringify(r?.command)).toContain("The company logo.");
  });
});
