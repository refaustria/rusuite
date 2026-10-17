// P9-W3 UI on the fake backend: Manage Styles, Design › Style Sets / Set as
// Default, Reveal Formatting (Shift+F1), File › New from a template, File ›
// Info (company, statistics), Save As template, comments by the document
// author, Ctrl+B in a bold heading.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
import type { WriteCommand } from "../generated/WriteCommand";
import { FakeWriteBackend } from "../test/fakeWriteBackend";
import { makeDoc, para } from "../test/fixtures";

const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
Range.prototype.getClientRects = noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = noRects;

const T = { timeout: 5000 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.getElementById("rusuite-write-styles")?.remove();
});

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));

async function mount(body: Block[] = [para(1, "hello world")], extra: Partial<Document> = {}) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor", undefined, T);
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true), T);
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64({ ...makeDoc(body), ...extra }) });
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
const tab = (name: string) => screen.getByRole("tab", { name });

function selectText(editor: HTMLElement, text: string) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.indexOf(text);
    if (i < 0) continue;
    const range = document.createRange();
    range.setStart(n, i);
    range.setEnd(n, i + text.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return;
  }
  throw new Error(`${text} not found`);
}

describe("Manage Styles", () => {
  it("Styles pane › Manage Styles… › Set Defaults sends SetStyleDefaults", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true, altKey: true });
    const pane = await screen.findByTestId("styles-pane", undefined, T);
    fireEvent.click(within(pane).getByRole("button", { name: "Manage Styles…" }));
    const dlg = await screen.findByRole("dialog", { name: "Manage Styles" }, T);
    // Edit: hidden styles only under All.
    const list = within(dlg).getByRole("listbox", { name: "Styles" });
    expect(within(list).queryAllByRole("option").length).toBeGreaterThan(5);
    fireEvent.click(within(dlg).getByRole("tab", { name: "Set Defaults" }));
    fireEvent.change(within(dlg).getByLabelText("Font"), { target: { value: "Georgia" } });
    fireEvent.change(within(dlg).getByLabelText("Size (pt)"), { target: { value: "12" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setStyleDefaults", run: { font: { kind: "named", value: "Georgia" }, size: 1200 } }), T);
  });

  it("Recommend › Hide sends UpdateStyle hidden", async () => {
    const { backend, editor } = await mount();
    fireEvent.keyDown(editor, { key: "S", code: "KeyS", ctrlKey: true, shiftKey: true, altKey: true });
    fireEvent.click(within(await screen.findByTestId("styles-pane", undefined, T)).getByRole("button", { name: "Manage Styles…" }));
    const dlg = await screen.findByRole("dialog", { name: "Manage Styles" }, T);
    fireEvent.click(within(dlg).getByRole("tab", { name: "Recommend" }));
    const quote = within(dlg).getAllByRole("option").find((o) => o.getAttribute("data-style-id") === "Quote")!;
    fireEvent.click(quote);
    fireEvent.click(within(dlg).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "updateStyle", id: "Quote", patch: { hidden: true } }), T);
  });
});

describe("Design tab", () => {
  it("Style Sets › Shaded sends ApplyStyleSet; Set as Default makes new documents start with it", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Design"));
    const gallery = await screen.findByRole("group", { name: "Style Sets" }, T);
    const shaded = await within(gallery).findByRole("button", { name: "Shaded" }, T);
    fireEvent.click(shaded);
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "applyStyleSet", set: expect.objectContaining({ id: "shaded" }) })), T);
    // The applied set is marked.
    await waitFor(() => expect(within(gallery).getByRole("button", { name: "Shaded" }).getAttribute("aria-pressed")).toBe("true"), T);
    fireEvent.click(screen.getByRole("button", { name: "Set as Default" }));
    await waitFor(() => expect(localStorage.getItem("rusuite.write.defaultStyleSet")).toContain("allCaps"), T);
    backend.log.length = 0;
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    // The style set made the document dirty: Word asks first.
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }, T));
    await waitFor(() => expect(backend.log.find((r) => r.type === "newDocument")).toMatchObject({ styleSet: { id: "default" } }), T);
  });

  it("Paragraph Spacing › Double sets the document defaults", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Design"));
    fireEvent.click(screen.getByRole("button", { name: "Paragraph Spacing" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Double" }, T).catch(() => screen.getByRole("menuitem", { name: "Double" })));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setStyleDefaults", paragraph: { spacing: { before: 0, after: 160, line: { kind: "multiple", value: 2 } } } }), T);
  });
});

describe("Reveal Formatting and toggles", () => {
  it("Shift+F1 shows the formatting in effect; Distinguish style source names the style", async () => {
    const { editor } = await mount([para(1, "Heading text", { style: "Heading1" })]);
    selectText(editor, "Heading");
    fireEvent.keyDown(editor, { key: "F1", shiftKey: true });
    const pane = await screen.findByTestId("reveal-formatting", undefined, T);
    await waitFor(() => expect(within(pane).getByTestId("reveal-item-size").textContent).toContain("16 pt"), T);
    fireEvent.click(within(pane).getByLabelText("Distinguish style source"));
    await waitFor(() => expect(within(pane).getByTestId("reveal-item-size").textContent).toContain("Heading 1"), T);
  });

  it("Ctrl+B in a heading whose style is bold writes bold: false", async () => {
    const doc = makeDoc([para(1, "Strong head", { style: "Title" })]);
    const title = doc.styles.styles.find((x) => x.id === "Title")!;
    title.run = { ...(title.run ?? {}), bold: true };
    const { backend, editor } = await mount(doc.body, { styles: doc.styles });
    selectText(editor, "Strong");
    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
    await waitFor(() => expect(JSON.stringify(applied(backend))).toContain('"bold":false'), T);
  });
});

describe("templates, Save As and Info", () => {
  it("File › New › Memo fetches the template and sends NewFromTemplate", async () => {
    const { backend } = await mount();
    const memo = makeDoc([para(1, "MEMO")]);
    memo.properties = { title: "Memo", author: "Template author" };
    const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode(JSON.stringify(memo))));
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(tab("File"));
    fireEvent.click(await screen.findByRole("button", { name: "New" }, T));
    fireEvent.click(await screen.findByTestId("new-memo", undefined, T));
    await waitFor(() => expect(backend.log.some((r) => r.type === "newFromTemplate")).toBe(true), T);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/templates\/memo\.dotx$/);
    await waitFor(() => expect(screen.getByTestId("doc-name").textContent).toBe("Untitled"), T);
    vi.unstubAllGlobals();
  });

  it("web Save As › Word Template saves a template under .dotx", async () => {
    const { backend, editor } = await mount();
    const save = vi.spyOn(backend, "saveFile").mockResolvedValue(true);
    fireEvent.keyDown(editor, { key: "F12" });
    fireEvent.change(screen.getByLabelText("Save as type"), { target: { value: "dotx" } });
    fireEvent.change(screen.getByLabelText("File name"), { target: { value: "Letterhead" } });
    fireEvent.submit(screen.getByLabelText("File name").closest("form")!);
    await waitFor(() => expect(save).toHaveBeenCalledWith("Letterhead.dotx", expect.any(String), { saveAs: true }), T);
    expect(backend.log.find((r) => r.type === "saveDocx")).toMatchObject({ template: true });
    expect(backend.lastSavedTemplate).toBe(true);
  });

  it("File › Info edits the company and shows characters and paragraphs", async () => {
    const { backend } = await mount([para(1, "two words"), para(2, "")]);
    fireEvent.click(tab("File"));
    fireEvent.click(await screen.findByRole("button", { name: "Info" }, T));
    const panel = await screen.findByTestId("info-panel", undefined, T);
    await waitFor(() => expect(within(panel).getByTestId("info-characters").textContent).toBe("8"), T);
    expect(within(panel).getByTestId("info-characters-spaces").textContent).toBe("9");
    expect(within(panel).getByTestId("info-paragraphs").textContent).toBe("1");
    const company = within(panel).getByLabelText("Company");
    fireEvent.change(company, { target: { value: "ACME" } });
    fireEvent.blur(company);
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "setProperties", patch: { company: "ACME" } }), T);
  });

  it("without a user name, the document's author writes the comment (no name dialog)", async () => {
    const { editor } = await mount([para(1, "hello world")], { properties: { author: "Grace Hopper" } });
    selectText(editor, "hello");
    fireEvent.keyDown(editor, { key: "m", code: "KeyM", ctrlKey: true, altKey: true });
    const draft = await screen.findByTestId("comment-draft", undefined, T);
    expect(draft.textContent).toContain("Grace Hopper");
    expect(screen.queryByRole("dialog", { name: "User Name" })).toBeNull();
  });
});
