// P8-21 UI: Styles gallery (live previews, right-click menu), Styles pane
// (filters, menu, New Style, inspector), Modify Style / Create a Style
// dialogs, Apply Styles box, Navigation pane, Find with formatting —
// driven through the real App on the fake backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
import type { WriteCommand } from "../generated/WriteCommand";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { makeDoc, para, run } from "../test/fixtures";

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.getElementById("rusuite-write-styles")?.remove();
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));

async function mount(body: Block[] = [para(1, "hello world")]) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64(makeDoc(body)) });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(backend.log.some((r) => r.type === "openDocx")).toBe(true));
  await waitFor(() => expect(editor.textContent).not.toBe(""));
  backend.log.length = 0;
  (editor as HTMLElement).focus();
  return { backend, editor };
}

type Cmd = WriteCommand & { commands?: Cmd[] };
const flat = (c: Cmd): Cmd[] => (c.type === "compound" ? (c.commands ?? []).flatMap(flat) : [c]);
const applied = (backend: FakeWriteBackend): Cmd[] => backend.log.flatMap((r) => (r.type === "apply" ? flat(r.command as Cmd) : []));
const gallery = () => screen.getByRole("group", { name: "Paragraph styles" });

describe("Styles gallery", () => {
  it("shows live previews from the style sheet and installs its CSS", async () => {
    await mount();
    const h1 = within(gallery()).getByRole("button", { name: "Heading 1" });
    const sample = h1.querySelector("span")!;
    expect(sample.style.fontSize).toBe("12pt");
    expect(sample.style.color).toBe("rgb(47, 85, 151)");
    expect(document.getElementById("rusuite-write-styles")?.textContent).toContain('p[data-style="Heading1"]');
  });

  it("right-click › Update Heading 1 to Match Selection / Remove from Style Gallery", async () => {
    const { backend } = await mount();
    fireEvent.contextMenu(within(gallery()).getByRole("button", { name: "Heading 1" }), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Update Heading 1 to Match Selection" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "updateStyleFromSelection", id: "Heading1", block: 1 })));
    fireEvent.contextMenu(within(gallery()).getByRole("button", { name: "Heading 2" }), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from Style Gallery" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "updateStyle", id: "Heading2", patch: { quickFormat: false } }));
    await waitFor(() => expect(within(gallery()).queryByRole("button", { name: "Heading 2" })).toBeNull());
  });

  it("right-click › Modify… sends UpdateStyle with the changed formatting only", async () => {
    const { backend } = await mount();
    fireEvent.contextMenu(within(gallery()).getByRole("button", { name: "Title" }), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Modify…" }));
    const dlg = screen.getByRole("dialog", { name: "Modify Style" });
    expect((within(dlg).getByLabelText("Style type") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(within(dlg).getByRole("button", { name: "Bold" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Center" }));
    fireEvent.click(within(dlg).getByLabelText("Automatically update"));
    expect(within(dlg).getByTestId("style-description").textContent).toContain("Bold");
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({ type: "updateStyle", id: "Title", patch: { run: { bold: true }, paragraph: { alignment: "center" }, autoRedefine: true } }),
    );
  });

  it("More styles › Create a Style… adds the style and takes the selection's formatting", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "More styles" }));
    fireEvent.click(screen.getByRole("button", { name: "Create a Style…" }));
    const dlg = screen.getByRole("dialog", { name: "Create New Style from Formatting" });
    fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "Memo" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "addStyle", style: expect.objectContaining({ id: "Memo", name: "Memo", custom: true }) })));
    expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "updateStyleFromSelection", id: "Memo", block: 1 }));
    await waitFor(() => expect(within(gallery()).getByRole("button", { name: "Memo" })).toBeTruthy());
  });
});

describe("Styles pane", () => {
  it("opens from the ribbon; filters Recommended / In use / All; Show Preview", async () => {
    await mount([para(1, "Title text", { style: "Title" }), para(2, "body")]);
    fireEvent.click(screen.getByRole("button", { name: "Styles pane" }));
    const pane = screen.getByTestId("styles-pane");
    const names = () => within(within(pane).getByRole("listbox")).getAllByRole("option").map((o) => o.getAttribute("aria-label"));
    expect(names()).toContain("Heading 1");
    expect(names()).not.toContain("Footnote Reference");
    const show = within(pane).getByLabelText("Show");
    fireEvent.change(show, { target: { value: "inUse" } });
    expect(names()).toEqual(["Normal", "Title"]);
    fireEvent.change(show, { target: { value: "all" } });
    expect(names()).toContain("Footnote Reference");
    expect(names()).not.toContain("Heading 1 Char");
    const title = within(pane).getByRole("option", { name: "Title" }).querySelector("span")!;
    expect(title.style.fontSize).not.toBe("");
    fireEvent.click(within(pane).getByLabelText("Show Preview"));
    expect(within(pane).getByRole("option", { name: "Title" }).querySelector("span")!.style.fontSize).toBe("");
  });

  it("clicking a style applies it; the ▾ menu renames, deletes and selects all instances", async () => {
    const { backend, editor } = await mount([para(1, "one"), para(2, "two", { style: "Quote" }), para(3, "three", { style: "Quote" })]);
    fireEvent.keyDown(editor, { key: "S", code: "KeyS", ctrlKey: true, altKey: true, shiftKey: true });
    const pane = await screen.findByTestId("styles-pane");
    fireEvent.click(within(pane).getByRole("option", { name: "Subtitle" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setStyle", blocks: [1], style: "Subtitle" }));
    fireEvent.click(within(pane).getByRole("button", { name: "Style Quote" }));
    expect(screen.getByRole("menuitem", { name: /Delete "Quote"/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const ren = screen.getByRole("dialog", { name: "Rename Style" });
    fireEvent.change(within(ren).getByRole("textbox"), { target: { value: "Citation" } });
    fireEvent.submit(within(ren).getByRole("textbox").closest("form")!);
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "renameStyle", id: "Quote", name: "Citation" }));
    fireEvent.click(within(pane).getByRole("button", { name: "Style Citation" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Select All 2 Instances" }));
    await waitFor(() => expect(backend.log).toContainEqual({ type: "blocksWithStyle", id: "Quote" }));
    // Two consecutive paragraphs: they become the selection.
    await waitFor(() => expect(editor.ownerDocument.getSelection()?.toString() ?? "").toContain("two"));
  });

  it("New Style… creates a character style; Delete removes a custom style", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Styles pane" }));
    const pane = screen.getByTestId("styles-pane");
    fireEvent.click(within(pane).getByRole("button", { name: "New Style" }));
    const dlg = screen.getByRole("dialog", { name: "Create New Style from Formatting" });
    fireEvent.change(within(dlg).getByLabelText("Name"), { target: { value: "Key Term" } });
    fireEvent.change(within(dlg).getByLabelText("Style type"), { target: { value: "character" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Italic" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "addStyle", style: expect.objectContaining({ id: "KeyTerm", kind: "character", basedOn: "DefaultParagraphFont", run: { italic: true } }) })),
    );
    fireEvent.click(await within(pane).findByRole("button", { name: "Style Key Term" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete "Key Term"/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete style" })).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "deleteStyle", id: "KeyTerm", replacement: null }));
  });

  it("the Style Inspector shows the paragraph style and the direct formatting", async () => {
    const { backend } = await mount([para(1, [run("bold", { bold: true }), run(" text")], { style: "Heading2", alignment: "right" })]);
    fireEvent.click(screen.getByRole("button", { name: "Styles pane" }));
    fireEvent.click(screen.getByRole("button", { name: "Style Inspector" }));
    const insp = screen.getByTestId("style-inspector");
    expect(within(insp).getByTestId("inspector-paragraph-style").textContent).toBe("Heading 2");
    expect(within(insp).getByTestId("inspector-paragraph-direct").textContent).toContain("Align Right");
    fireEvent.click(within(insp).getByRole("button", { name: "Clear paragraph formatting" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "clearFormatting", block: 1, from: 0, to: 0, paragraph: true, keepStyle: true }));
  });
});

describe("Apply Styles box and Navigation pane", () => {
  it("Ctrl+Shift+S: typing a style name and Enter applies it", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, { key: "S", ctrlKey: true, shiftKey: true });
    const box = await screen.findByTestId("apply-styles");
    const input = within(box).getByLabelText("Style Name") as HTMLInputElement;
    expect(input.value).toBe("Normal");
    fireEvent.change(input, { target: { value: "quote" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setStyle", blocks: [1], style: "Quote" }));
    await waitFor(() => expect(screen.queryByTestId("apply-styles")).toBeNull());
  });

  it("an unknown name in the Apply Styles box creates a style from the selection", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, { key: "S", ctrlKey: true, shiftKey: true });
    const input = within(await screen.findByTestId("apply-styles")).getByLabelText("Style Name");
    fireEvent.change(input, { target: { value: "Brand New" } });
    expect(screen.getByRole("button", { name: "New Style" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "addStyle", style: expect.objectContaining({ id: "BrandNew" }) })));
  });

  it("View › Navigation Pane lists Heading 1–3; a click goes there", async () => {
    const { editor } = await mount([para(1, "Intro", { style: "Heading1" }), para(2, "text"), para(3, "Part", { style: "Heading2" }), para(4, "Small", { style: "Heading4" })]);
    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(screen.getByLabelText("Navigation Pane"));
    const nav = await screen.findByTestId("navigation-pane");
    const items = within(nav).getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Close");
    expect(items.map((b) => b.textContent)).toEqual(["Intro", "Part"]);
    fireEvent.click(items[1]!);
    await waitFor(() => expect(editor.ownerDocument.getSelection()?.anchorNode?.textContent).toBe("Part"));
  });
});

describe("Find with formatting", () => {
  it("Format › Font… Bold asks Rust for the matches and Replace all sends the format", async () => {
    const { backend, editor } = await mount([para(1, [run("fox "), run("fox", { bold: true }), run(" fox")])]);
    fireEvent.keyDown(editor, { key: "h", ctrlKey: true });
    const bar = await screen.findByTestId("find-bar");
    fireEvent.change(within(bar).getByLabelText("Find"), { target: { value: "fox" } });
    await waitFor(() => expect(editor.querySelectorAll(".find-match")).toHaveLength(3));
    fireEvent.click(within(bar).getByRole("button", { name: /^More/ }));
    fireEvent.click(within(bar).getByRole("button", { name: "Find format" }));
    fireEvent.click(within(bar).getByRole("menuitem", { name: "Font…" }));
    const font = screen.getByRole("dialog", { name: "Font" });
    fireEvent.change(within(font).getByLabelText("Bold"), { target: { value: "on" } });
    fireEvent.click(within(font).getByRole("button", { name: "OK" }));
    expect(within(bar).getByTestId("find-format").textContent).toBe("Format: Bold");
    await waitFor(() => expect(backend.log).toContainEqual({ type: "find", query: { text: "fox", matchCase: false, wholeWord: false, wildcards: false, format: { run: { bold: true } } } }));
    await waitFor(() => expect(editor.querySelectorAll(".find-match")).toHaveLength(1));
    fireEvent.click(within(bar).getByLabelText("Use wildcards"));
    expect((within(bar).getByLabelText("Match case") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(bar).getByLabelText("Use wildcards"));
    fireEvent.change(within(bar).getByLabelText("Replace with"), { target: { value: "cat" } });
    fireEvent.click(within(bar).getByRole("button", { name: "Replace format" }));
    fireEvent.click(within(bar).getByRole("menuitem", { name: "Highlight" }));
    expect(within(bar).getByTestId("replace-format").textContent).toBe("Format: Highlight");
    fireEvent.click(within(bar).getByRole("button", { name: "Replace all" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({
        type: "findReplace", find: "fox", replace: "cat", matchCase: false, wholeWord: false, all: true, format: { run: { bold: true } }, replaceFormat: { highlight: true },
      }),
    );
  });
});
