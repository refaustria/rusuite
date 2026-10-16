// P8-10 UI: References tab, footnotes/endnotes, fields, TOC, section breaks
// and section page setup, header/footer and page number dialogs, multilevel
// lists and list restart — driven through the real App on the fake backend.
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
import { li, makeDoc, para } from "../test/fixtures";

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));
const tab = (name: string) => screen.getByRole("tab", { name });
const A4 = { width: 11906, height: 16838, orientation: "portrait" as const, margins: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } };
const sectionsOf = (ids: number[]): Section[] => ids.map((id) => ({ id, page: structuredClone(A4), kind: "nextPage", titlePage: false }));

async function mount(body: Block[] = [para(1, "hello world")], extra: Partial<Document> = {}) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64({ ...makeDoc(body), ...extra }) });
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  await waitFor(() => expect(backend.log.some((r) => r.type === "openDocx")).toBe(true));
  await waitFor(() => expect(editor.textContent).toContain((body[0]?.value as { inlines?: { value: { text?: string } }[] }).inlines?.[0]?.value.text ?? ""));
  backend.log.length = 0;
  (editor as HTMLElement).focus();
  return { backend, editor };
}

type Cmd = WriteCommand & { commands?: Cmd[] };
const flat = (c: Cmd): Cmd[] => (c.type === "compound" ? (c.commands ?? []).flatMap(flat) : [c]);
const applied = (backend: FakeWriteBackend): Cmd[] => backend.log.flatMap((r) => (r.type === "apply" ? flat(r.command as Cmd) : []));
const menuItem = (name: string | RegExp) => screen.getByRole("menuitem", { name });

describe("References tab and notes", () => {
  it("Insert › Insert footnote adds the reference and the note; the caret moves into the note", async () => {
    const { backend, editor } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Insert footnote" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertFootnote", block: 1, kind: "foot" })));
    await waitFor(() => expect(editor.querySelector(".notes-area .note")).toBeTruthy());
    expect(editor.querySelector("sup.note-ref")!.getAttribute("data-n")).toBe("1");
    await waitFor(() => expect(window.getSelection()?.anchorNode && editor.querySelector(".note")!.contains(window.getSelection()!.anchorNode)).toBe(true));
  });

  it("Ctrl+Alt+D inserts an endnote (numbered i)", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, { key: "d", code: "KeyD", ctrlKey: true, altKey: true });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertFootnote", kind: "end" })));
    await waitFor(() => expect(editor.querySelector("sup.note-ref")?.getAttribute("data-n")).toBe("i"));
  });

  it("References › Table of contents inserts a TOC; Update table sends updateToc", async () => {
    const { backend, editor } = await mount([para(1, "Intro", { style: "Heading1" }), para(2, "Body"), para(3, "More", { style: "Heading2" })]);
    fireEvent.click(tab("References"));
    fireEvent.click(screen.getByRole("button", { name: "Table of contents" }));
    fireEvent.click(menuItem("Automatic table (3 levels)"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertToc", fromLevel: 1, toLevel: 3, title: "Contents" })));
    await waitFor(() => expect(Array.from(editor.querySelectorAll(".toc-entry .toc-text"), (e) => e.textContent)).toEqual(["Intro", "More"]));
    fireEvent.click(screen.getByRole("button", { name: "Update table" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "updateToc" })));
  });

  it("Next / Previous footnote buttons exist on the References tab", async () => {
    await mount();
    fireEvent.click(tab("References"));
    expect(screen.getByRole("button", { name: "Next footnote" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous footnote" })).toBeTruthy();
  });
});

describe("fields", () => {
  it("Insert › Field › Date inserts a date field with today's value", async () => {
    const { backend, editor } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Field" }));
    fireEvent.click(menuItem("Date"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertField", field: { kind: "date", value: { format: "M/d/yyyy" } } })));
    await waitFor(() => expect(editor.querySelector(".field[data-field=date]")).toBeTruthy());
  });

  it("Insert › Page number › Current position inserts a page field", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Page number" }));
    fireEvent.click(menuItem("Current position"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "insertField", field: { kind: "page" } })));
  });

  it("saving sends updateFields when a live value differs from the cached one", async () => {
    const { backend } = await mount([para(1, [{ kind: "run", value: { text: "x " } }, { kind: "field", value: { kind: { kind: "fileName" }, cached: "old.docx" } }])]);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "updateFields", values: [[1, 2, "t.docx"]] }));
  });
});

describe("sections", () => {
  const twoSections = () => mount([para(1, "first", { sectionEnd: 1 }), para(2, "second")], { sections: sectionsOf([1, 2]) });

  it("a section end shows the section-break marker", async () => {
    const { editor } = await twoSections();
    await waitFor(() => expect(editor.querySelector("[data-section-end='1']")!.getAttribute("data-section-label")).toBe("Section break (Next page)"));
  });

  it("Layout › Breaks › Next page splits the paragraph and inserts a section break", async () => {
    const { backend, editor } = await mount();
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Breaks" }));
    fireEvent.click(menuItem("Next page"));
    await waitFor(() => expect(applied(backend).map((c) => c.type)).toEqual(["splitParagraph", "insertSectionBreak"]));
    await waitFor(() => expect(editor.querySelector("[data-section-label]")).toBeTruthy());
  });

  it("W-17: after Breaks › Next page the caret is in the new section: Orientation changes that one", async () => {
    const { backend } = await mount([para(1, "first second")]);
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Breaks" }));
    fireEvent.click(menuItem("Next page"));
    await waitFor(() => expect(applied(backend).map((c) => c.type)).toEqual(["splitParagraph", "insertSectionBreak"]));
    const doc = await backend.dispatch({ type: "getDocument" }) as { ok: { doc: Document } };
    const sections = doc.ok.doc.sections ?? [];
    expect(sections.length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Orientation" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Landscape" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setSection", section: sections[1]!.id, patch: { page: { orientation: "landscape" } } }));
  });

  it("Layout › Orientation acts on the caret's section (setSection)", async () => {
    const { backend } = await twoSections();
    fireEvent.click(tab("Layout"));
    fireEvent.click(screen.getByRole("button", { name: "Orientation" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Landscape" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setSection", section: 1, patch: { page: { orientation: "landscape" } } }));
  });

  it("header & footer dialog: different first page stores rich blocks per slot", async () => {
    const { backend } = await twoSections();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Header" }));
    const dialog = screen.getByRole("dialog", { name: "Header and footer" });
    fireEvent.click(within(dialog).getByLabelText("Different first page"));
    fireEvent.change(within(dialog).getByLabelText("First page header"), { target: { value: "Cover" } });
    fireEvent.change(within(dialog).getByLabelText("Footer"), { target: { value: "Page {PAGE}" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setSection", section: 1, patch: { titlePage: true } }));
    const cmds = applied(backend);
    const footer = cmds.find((c) => c.type === "setHeaderFooter" && c.footer && c.slot === "default") as Extract<WriteCommand, { type: "setHeaderFooter" }>;
    expect(footer.blocks![0]!.kind).toBe("paragraph");
    expect(JSON.stringify(footer.blocks)).toContain('"kind":"field"');
    expect(cmds).toContainEqual(expect.objectContaining({ type: "setHeaderFooter", footer: false, slot: "first" }));
  });

  it("page numbers dialog sets the format and the restart", async () => {
    const { backend } = await twoSections();
    fireEvent.click(tab("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Page number" }));
    fireEvent.click(menuItem("Format page numbers…"));
    const dialog = screen.getByRole("dialog", { name: "Format page numbers…" });
    fireEvent.change(within(dialog).getByLabelText("Number format"), { target: { value: "lowerRoman" } });
    fireEvent.click(within(dialog).getAllByRole("radio")[1]!);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Start at" }), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setSection", section: 1, patch: { pageNumberFormat: "lowerRoman", pageNumberStart: 3 } }));
  });
});

describe("lists", () => {
  it("Home › Multilevel list creates a list definition and numbers the paragraph", async () => {
    const { backend, editor } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Multilevel list" }));
    fireEvent.click(menuItem(/Numbered outline/));
    // P8-34: one ApplyNumbering (the core allocates the list), no numbering table from the UI.
    await waitFor(() => expect(applied(backend).map((c) => c.type)).toEqual(["applyNumbering"]));
    await waitFor(() => expect(editor.querySelector("[data-label]")?.getAttribute("data-label")).toBe("1."));
  });

  it("W-27: with the caret in a list, Multilevel list renumbers the whole list (levels kept)", async () => {
    const { backend } = await mount([li(1, "one", 2, 0), li(2, "sub", 2, 1), li(3, "two", 2, 0), para(4, "after")]);
    fireEvent.click(screen.getByRole("button", { name: "Multilevel list" }));
    fireEvent.click(menuItem(/Numbered outline/));
    await waitFor(() => expect(applied(backend).map((c) => c.type)).toEqual(["applyNumbering"]));
    const cmd = applied(backend)[0] as Extract<WriteCommand, { type: "applyNumbering" }>;
    expect(cmd.items).toEqual([[1, 0], [2, 1], [3, 0]]);
  });

  it("context menu: Restart at 1 / Continue numbering in a list", async () => {
    const { backend, editor } = await mount([li(1, "one", 2, 0), para(2, "gap"), li(3, "two", 2, 0)]);
    const item = editor.querySelectorAll("li p")[1]!;
    fireEvent.contextMenu(item);
    const menu = screen.getByRole("menu", { name: "Editor" });
    expect(within(menu).getByRole("menuitem", { name: "Continue numbering" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Restart at 1" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "restartList", start: 1 })));
  });
});
