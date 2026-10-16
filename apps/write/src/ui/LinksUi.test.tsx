// P8-27 UI: Insert › Link / Bookmark / Cross-reference / Symbol / Date &
// Time, References › Insert Caption / Table of Figures, Layout › Columns /
// Breaks / Hyphenation, the Paragraph dialog's Line and Page Breaks, File ›
// Info, Go To and the font box — through the real App on the fake backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { Section } from "../generated/Section";
import type { WriteCommand } from "../generated/WriteCommand";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { makeDoc, para, run } from "../test/fixtures";

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

const T = { timeout: 5000 };
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));
const tab = (name: string) => screen.getByRole("tab", { name });
const A4 = { width: 11906, height: 16838, orientation: "portrait" as const, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } };
const sectionsOf = (ids: number[]): Section[] => ids.map((id) => ({ id, page: structuredClone(A4), kind: "nextPage", titlePage: false }));

async function mount(body: Block[] = [para(1, "hello world")], extra: Partial<Document> = {}) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor", undefined, T);
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true), T);
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64({ ...makeDoc(body), sections: sectionsOf([1]), ...extra }) });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(backend.log.some((r) => r.type === "openDocx")).toBe(true), T);
  await waitFor(() => expect(editor.textContent?.length).toBeGreaterThan(0), T);
  backend.log.length = 0;
  (editor as HTMLElement).focus();
  return { backend, editor };
}

type Cmd = WriteCommand & { commands?: Cmd[] };
const flat = (c: Cmd): Cmd[] => (c.type === "compound" ? (c.commands ?? []).flatMap(flat) : [c]);
const applied = (backend: FakeWriteBackend): Cmd[] => backend.log.flatMap((r) => (r.type === "apply" ? flat(r.command as Cmd) : []));
const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const radioItem = (name: string | RegExp) => screen.getByRole("menuitemradio", { name });

/** Puts the caret at char `offset` of the paragraph with text `text` (by selecting through the DOM). */
function caretIn(editor: HTMLElement, text: string, offset: number) {
  const p = Array.from(editor.querySelectorAll("p, h1, h2")).find((x) => x.textContent?.includes(text))!;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node = walker.nextNode();
  while (node && left > (node.textContent?.length ?? 0)) {
    left -= node.textContent!.length;
    node = walker.nextNode();
  }
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.setStart(node ?? p, node ? left : 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  fireEvent(document, new Event("selectionchange"));
}

describe("Insert › Link and bookmarks", () => {
  it("Ctrl+K opens Insert Hyperlink; OK sends setHyperlink with the typed address and ScreenTip", async () => {
    const { backend, editor } = await mount();
    caretIn(editor, "hello", 3);
    fireEvent.keyDown(editor, { key: "k", code: "KeyK", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Insert Hyperlink" }, T);
    fireEvent.change(within(dialog).getByLabelText("Text to display"), { target: { value: "Rusuite" } });
    fireEvent.change(within(dialog).getByLabelText("Address"), { target: { value: "www.rusuite.example" } });
    fireEvent.change(within(dialog).getByLabelText("ScreenTip"), { target: { value: "Home page" } });
    fireEvent.click(within(dialog).getByTestId("link-ok"));
    await waitFor(
      () =>
        expect(applied(backend)).toContainEqual(
          expect.objectContaining({ type: "setHyperlink", link: { target: { kind: "url", value: "https://www.rusuite.example" }, tooltip: "Home page" }, text: "Rusuite" }),
        ),
      T,
    );
    await waitFor(() => expect(editor.querySelector("a.doc-link")?.textContent).toBe("Rusuite"), T);
  });

  it("an e-mail link with a subject; editing a link offers Remove Link", async () => {
    const { backend, editor } = await mount([para(1, [run("mail "), { kind: "run", value: { text: "us", style: "Hyperlink", link: { target: { kind: "url", value: "https://x.at" } } } }])]);
    caretIn(editor, "mail", 6);
    fireEvent.keyDown(editor, { key: "k", code: "KeyK", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Insert Hyperlink" }, T);
    expect((within(dialog).getByLabelText("Address") as HTMLInputElement).value).toBe("https://x.at");
    fireEvent.click(within(dialog).getByRole("radio", { name: "E-mail address" }));
    fireEvent.change(within(dialog).getAllByLabelText("E-mail address").find((x) => x.getAttribute("type") !== "radio")!, { target: { value: "info@rusuite.example" } });
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "Hello" } });
    fireEvent.click(within(dialog).getByTestId("link-ok"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setHyperlink", from: 5, to: 7, link: { target: { kind: "email", value: { address: "info@rusuite.example", subject: "Hello" } } } })), T);
    fireEvent.keyDown(editor, { key: "k", code: "KeyK", ctrlKey: true });
    const again = await screen.findByRole("dialog", { name: "Insert Hyperlink" }, T);
    fireEvent.click(within(again).getByRole("button", { name: "Remove Link" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "removeHyperlink", block: 1, from: 5, to: 7 }), T);
  });

  it("Insert › Bookmark adds, lists and deletes bookmarks", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Bookmark" }));
    const dialog = await screen.findByRole("dialog", { name: "Bookmark" }, T);
    fireEvent.change(within(dialog).getByLabelText("Bookmark name"), { target: { value: "bad name" } });
    expect((within(dialog).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Bookmark name"), { target: { value: "Start" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "addBookmark", name: "Start" })), T);
    fireEvent.click(screen.getByRole("button", { name: "Bookmark" }));
    const again = await screen.findByRole("dialog", { name: "Bookmark" }, T);
    fireEvent.click(await within(again).findByRole("option", { name: "Start" }, T));
    fireEvent.click(within(again).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "deleteBookmark", name: "Start" }), T);
  });

  it("Go To (Ctrl+G): a heading; an unknown page is reported", async () => {
    const { editor } = await mount([para(1, "body text"), para(2, "Chapter", { style: "Heading1" })]);
    fireEvent.keyDown(editor, { key: "g", code: "KeyG", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Go To" }, T);
    fireEvent.change(within(dialog).getByLabelText("Go to what"), { target: { value: "heading" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Go To" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Go To" })).toBeNull(), T);
    fireEvent.keyDown(editor, { key: "F5", code: "F5" });
    const again = await screen.findByRole("dialog", { name: "Go To" }, T);
    // The dialog remembers the last choice (Word).
    expect((within(again).getByLabelText("Go to what") as HTMLSelectElement).value).toBe("heading");
    fireEvent.change(within(again).getByLabelText("Go to what"), { target: { value: "page" } });
    fireEvent.change(within(again).getByLabelText("Enter page number"), { target: { value: "9" } });
    fireEvent.click(within(again).getByRole("button", { name: "Go To" }));
    expect((await within(again).findByRole("alert", undefined, T)).textContent).toContain("no page 9");
  });
});

describe("captions and cross-references", () => {
  it("References › Insert Caption sends insertCaption with the label, position and text", async () => {
    const { backend, editor } = await mount();
    caretIn(editor, "hello", 2);
    fireEvent.click(tab("References"));
    fireEvent.click(screen.getByRole("button", { name: "Insert Caption" }));
    const dialog = await screen.findByRole("dialog", { name: "Caption" }, T);
    expect(within(dialog).getByTestId("caption-prefix").textContent).toBe("Figure 1");
    // Word: no separator of its own (W-22); the user types it.
    expect((within(dialog).getByLabelText("Caption") as HTMLInputElement).value).toBe("");
    fireEvent.change(within(dialog).getByLabelText("Caption"), { target: { value: ": A cat" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Table" } });
    fireEvent.change(within(dialog).getByLabelText("Position"), { target: { value: "above" } });
    fireEvent.click(within(dialog).getByTestId("caption-ok"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertCaption", anchor: 1, below: false, label: "Table", text: ": A cat" })), T);
    await waitFor(() => expect(editor.textContent).toContain("Table 1: A cat"), T);
  });

  it("Insert Caption without text gives exactly \"Figure 1\" (W-22)", async () => {
    const { backend, editor } = await mount();
    caretIn(editor, "hello", 2);
    fireEvent.click(tab("References"));
    fireEvent.click(screen.getByRole("button", { name: "Insert Caption" }));
    const dialog = await screen.findByRole("dialog", { name: "Caption" }, T);
    fireEvent.click(within(dialog).getByTestId("caption-ok"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertCaption", label: "Figure", text: "" })), T);
  });

  it("Insert › Cross-reference to a heading as its page number", async () => {
    const { backend, editor } = await mount([para(1, "See "), para(2, "Results", { style: "Heading1" })]);
    caretIn(editor, "See", 4);
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Cross-reference" }));
    const dialog = await screen.findByRole("dialog", { name: "Cross-reference" }, T);
    fireEvent.change(within(dialog).getByLabelText("Insert reference to"), { target: { value: "page" } });
    fireEvent.click(within(dialog).getByRole("option", { name: "Results" }));
    fireEvent.click(within(dialog).getByTestId("xref-insert"));
    await waitFor(
      () => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertCrossReference", block: 1, target: { kind: "paragraph", value: 2 }, show: "page", hyperlink: true })),
      T,
    );
  });

  it("Insert Table of Figures › Figure sends insertToc with the caption label", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("References"));
    fireEvent.click(screen.getByRole("button", { name: "Insert Table of Figures" }));
    fireEvent.click(menuItem("Figure"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertToc", caption: "Figure" })), T);
  });

  it("F9 updates the selection's fields through the core (refresh)", async () => {
    const { backend, editor } = await mount();
    caretIn(editor, "hello", 1);
    fireEvent.keyDown(editor, { key: "F9", code: "F9" });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "updateFields", refresh: expect.objectContaining({ blocks: [1] }) })), T);
  });
});

describe("Layout", () => {
  it("Columns › Two sets the section's columns; the box renders with CSS columns", async () => {
    const { backend, editor } = await mount();
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(radioItem("Two"));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setSection", section: 1, patch: { columns: { count: 2, equal: true } } }), T);
    await waitFor(() => expect(editor.querySelector(".section-columns")?.getAttribute("style")).toContain("column-count: 2"), T);
  });

  it("a two-column section: the ruler has a scale per column; the status bar counts the words in the columns", async () => {
    const twoCols = { ...sectionsOf([1])[0]!, columns: { count: 2, equal: true } };
    const { editor } = await mount([para(1, "alpha beta gamma"), para(2, "delta epsilon")], { sections: [twoCols] });
    await waitFor(() => expect(editor.querySelector(".section-columns")).toBeTruthy(), T);
    await waitFor(() => expect(screen.getByTestId("words").textContent).toBe("5 words"), T);
    caretIn(editor, "alpha", 2);
    await waitFor(() => expect(screen.getAllByTestId("ruler-segment")).toHaveLength(2), T);
    for (const seg of screen.getAllByTestId("ruler-segment")) {
      // Each column's scale starts at its own left edge: 1, 2, 3 … cm.
      expect(within(seg).getAllByTestId("ruler-number")[0]!.textContent).toBe("1");
    }
    expect(screen.getAllByTestId("ruler-column-gap")).toHaveLength(1);
  });

  it("More Columns…: three columns with a line between, for the whole document", async () => {
    const { backend } = await mount([para(1, "a", { sectionEnd: 1 }), para(2, "b")], { sections: sectionsOf([1, 2]) });
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(menuItem("More Columns…"));
    const dialog = await screen.findByRole("dialog", { name: "Columns" }, T);
    fireEvent.change(within(dialog).getByLabelText("Number of columns"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Line between" }));
    fireEvent.change(within(dialog).getByLabelText("Apply to"), { target: { value: "whole" } });
    fireEvent.click(within(dialog).getByTestId("columns-ok"));
    await waitFor(() => {
      const sets = applied(backend).filter((c) => c.type === "setSection");
      expect(sets.map((c) => (c as { section: number }).section)).toEqual([1, 2]);
      expect(sets[0]).toMatchObject({ patch: { columns: { count: 3, equal: true, separator: true, spacing: 720 } } });
    }, T);
  });

  it("Breaks › Column inserts a column break; Hyphenation › Automatic sets the setting", async () => {
    const { backend, editor } = await mount();
    caretIn(editor, "hello", 5);
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Breaks" }));
    fireEvent.click(menuItem("Column"));
    await waitFor(() => expect(editor.querySelector(".column-break")).toBeTruthy(), T);
    fireEvent.click(screen.getByRole("button", { name: "Hyphenation" }));
    fireEvent.click(radioItem("Automatic"));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setSettings", settings: { autoHyphenation: true } }), T);
    await waitFor(() => expect(editor.getAttribute("data-hyphenate")).toBe("auto"), T);
  });

  it("Paragraph › Line and Page Breaks: Keep with next and Page break before", async () => {
    const { backend } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Paragraph settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Paragraph" }, T);
    fireEvent.click(within(dialog).getByRole("tab", { name: "Line and Page Breaks" }));
    expect((within(dialog).getByRole("checkbox", { name: "Widow/Orphan control" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Keep with next" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Page break before" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setParagraphProps", patch: { keepNext: true, pageBreakBefore: true } })), T);
  });
});

describe("symbols, date and time, properties, font box", () => {
  it("Insert › Symbol: the gallery inserts at once; More Symbols… searches by name and by code", async () => {
    const { editor } = await mount();
    caretIn(editor, "hello", 5);
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Symbol" }));
    const gallery = await screen.findByTestId("symbol-gallery", undefined, T);
    fireEvent.click(within(gallery).getByRole("button", { name: "€" }));
    await waitFor(() => expect(editor.textContent).toContain("hello€"), T);
    fireEvent.click(screen.getByRole("button", { name: "Symbol" }));
    fireEvent.click(await screen.findByRole("button", { name: "More Symbols…" }, T));
    const dialog = await screen.findByRole("dialog", { name: "Symbol" }, T);
    fireEvent.change(within(dialog).getByLabelText("Search by name"), { target: { value: "omega" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "greek capital letter omega" }));
    expect((within(dialog).getByLabelText("Character code") as HTMLInputElement).value).toBe("03A9");
    fireEvent.click(within(dialog).getByTestId("symbol-insert"));
    await waitFor(() => expect(editor.textContent).toContain("Ω"), T);
    fireEvent.click(within(dialog).getByRole("tab", { name: "Special Characters" }));
    fireEvent.click(within(dialog).getByRole("option", { name: /Em Dash/ }));
    fireEvent.click(within(dialog).getByTestId("symbol-insert"));
    await waitFor(() => expect(editor.textContent).toContain("—"), T);
  });

  it("Insert › Date & Time: Update automatically inserts a DATE field", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Date & Time" }));
    const dialog = await screen.findByRole("dialog", { name: "Date and Time" }, T);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Update automatically" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertField", field: { kind: "date", value: { format: "M/d/yyyy" } } })), T);
  });

  it("File › Info edits the title (SetProperties) and shows the statistics", async () => {
    const { backend } = await mount([para(1, "three little words")], { properties: { author: "Ann" } });
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(await screen.findByRole("button", { name: "Info" }, T));
    const panel = await screen.findByTestId("info-panel", undefined, T);
    expect((within(panel).getByLabelText("Author") as HTMLInputElement).value).toBe("Ann");
    expect(within(panel).getByTestId("info-words").textContent).toBe("3");
    const title = within(panel).getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Quarterly report" } });
    fireEvent.blur(title);
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setProperties", patch: { title: "Quarterly report" } }), T);
  });

  it("the font box shows the style's font and size when nothing is set directly", async () => {
    const { editor } = await mount([para(1, "Heading text", { style: "Heading1" }), para(2, "body")]);
    caretIn(editor, "Heading", 2);
    await waitFor(() => expect((screen.getByLabelText("Font family") as HTMLSelectElement).value).toBe("Calibri Light"), T);
    expect((screen.getByLabelText("Font size") as HTMLInputElement).value).toBe("16");
    caretIn(editor, "body", 2);
    await waitFor(() => expect((screen.getByLabelText("Font family") as HTMLSelectElement).value).toBe("Calibri"), T);
    expect((screen.getByLabelText("Font size") as HTMLInputElement).value).toBe("11");
  });
});
