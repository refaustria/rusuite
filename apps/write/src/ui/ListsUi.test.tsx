// P9-W1 UI: Home › Bullets ▾ / Numbering ▾ / Multilevel List ▾ galleries, Define New Number Format / Bullet, Set
// Numbering Value (context menu), heading numbering in the TOC, the Paragraph dialog's outline level — driven
// through the real App on the fake backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
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

async function mount(body: Block[]) {
  const backend = new FakeWriteBackend();
  render(<App backend={backend} />);
  const editor = await screen.findByTestId("editor");
  await waitFor(() => expect(backend.log.some((r) => r.type === "newDocument")).toBe(true));
  vi.spyOn(backend, "openFile").mockResolvedValue({ name: "t.docx", bytesBase64: b64(makeDoc(body)) });
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

describe("list galleries", () => {
  it("Numbering ▾ › I. II. III. applies the preset to the whole list at the caret", async () => {
    const { backend, editor } = await mount([li(1, "one", 2, 0), li(2, "two", 2, 0)]);
    fireEvent.click(screen.getByRole("button", { name: "Numbering library" }));
    const gallery = screen.getByTestId("numbering-gallery");
    fireEvent.click(within(gallery).getByRole("button", { name: "Numbering I. II. III." }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "applyNumbering", preset: "upperRoman", items: [[1, 0], [2, 0]] }));
    await waitFor(() => expect(Array.from(editor.querySelectorAll("[data-label]"), (e) => e.getAttribute("data-label"))).toEqual(["I.", "II."]));
  });

  it("Bullets ▾ › ➢ makes a bulleted list; None removes the numbering", async () => {
    const { backend, editor } = await mount([para(1, "plain")]);
    fireEvent.click(screen.getByRole("button", { name: "Bullet library" }));
    fireEvent.click(within(screen.getByTestId("bullet-gallery")).getByRole("button", { name: "Bullet ➢" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "applyNumbering", preset: "bulletArrow", items: [[1, 0]] }));
    await waitFor(() => expect(editor.querySelector("[data-label]")?.getAttribute("data-label")).toBe("➢"));
    fireEvent.click(screen.getByRole("button", { name: "Bullet library" }));
    fireEvent.click(within(screen.getByTestId("bullet-gallery")).getByRole("button", { name: "None" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "applyList", kind: "none" })));
  });

  it("Define New Number Format… sends the format with the level's token", async () => {
    const { backend } = await mount([li(1, "one", 2, 0)]);
    fireEvent.click(screen.getByRole("button", { name: "Numbering library" }));
    fireEvent.click(within(screen.getByTestId("numbering-gallery")).getByRole("button", { name: "Define New Number Format…" }));
    const dialog = screen.getByRole("dialog", { name: "Define New Number Format…" });
    fireEvent.change(within(dialog).getByLabelText("Number style"), { target: { value: "upperLetter" } });
    fireEvent.change(within(dialog).getByLabelText("Number format"), { target: { value: "Part %1:" } });
    fireEvent.change(within(dialog).getByLabelText("Alignment"), { target: { value: "center" } });
    expect(within(dialog).getByTestId("number-format-preview").textContent).toContain("Part A:");
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({ type: "applyNumbering", format: { kind: "upperLetter", text: "Part %1:", start: 1, alignment: "center" }, items: [[1, 0]] }),
    );
  });

  it("Define New Number Format… without %1 cannot be confirmed", async () => {
    await mount([li(1, "one", 2, 0)]);
    fireEvent.click(screen.getByRole("button", { name: "Numbering library" }));
    fireEvent.click(within(screen.getByTestId("numbering-gallery")).getByRole("button", { name: "Define New Number Format…" }));
    const dialog = screen.getByRole("dialog", { name: "Define New Number Format…" });
    fireEvent.change(within(dialog).getByLabelText("Number format"), { target: { value: "Part" } });
    expect((within(dialog).getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Define New Bullet… picks a symbol and a font", async () => {
    const { backend } = await mount([para(1, "plain")]);
    fireEvent.click(screen.getByRole("button", { name: "Bullet library" }));
    fireEvent.click(within(screen.getByTestId("bullet-gallery")).getByRole("button", { name: "Define New Bullet…" }));
    const dialog = screen.getByRole("dialog", { name: "Define New Bullet…" });
    fireEvent.click(within(dialog).getByRole("button", { name: "★" }));
    fireEvent.change(within(dialog).getByLabelText("Font"), { target: { value: "Arial" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(applied(backend)).toContainEqual({ type: "applyNumbering", format: { kind: "bullet", text: "★", start: 1, font: { kind: "named", value: "Arial" } }, items: [[1, 0]] }),
    );
  });

  it("context menu › Set Numbering Value… restarts the list at the value", async () => {
    const { backend, editor } = await mount([li(1, "one", 2, 0), li(2, "two", 2, 0)]);
    fireEvent.contextMenu(editor.querySelectorAll("li p")[1]!);
    fireEvent.click(within(screen.getByRole("menu", { name: "Editor" })).getByRole("menuitem", { name: "Set Numbering Value…" }));
    const dialog = await screen.findByRole("dialog", { name: "Set Numbering Value…" });
    fireEvent.change(within(dialog).getByLabelText("Set value to"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "restartList", start: 5 })));
  });

  it("Multilevel ▾ › 1 / 1.1 (headings) numbers the headings and the TOC shows the numbers", async () => {
    const { backend, editor } = await mount([
      para(1, "Intro", { style: "Heading1" }),
      para(2, "Scope", { style: "Heading2" }),
      para(3, "Body"),
      para(4, "Terms", { style: "Heading2" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Multilevel list" }));
    fireEvent.click(within(screen.getByTestId("multilevel-gallery")).getByRole("button", { name: "1 / 1.1 / 1.1.1 (headings)" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "applyNumbering", preset: "headingDecimal" })));
    await waitFor(() => expect(Array.from(editor.querySelectorAll("[data-label]"), (e) => e.getAttribute("data-label"))).toEqual(["1", "1.1", "1.2"]));
    // The headings stay headings (numbered through their styles).
    expect(editor.querySelectorAll("li")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: "References" }));
    fireEvent.click(screen.getByRole("button", { name: "Table of contents" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Automatic table (3 levels)" }));
    await waitFor(() => expect(Array.from(editor.querySelectorAll(".toc-entry .toc-text"), (e) => e.textContent)).toEqual(["1 Intro", "1.1 Scope", "1.2 Terms"]));
  });
});

describe("Paragraph dialog › Outline level", () => {
  it("sets a direct outline level", async () => {
    const { backend } = await mount([para(1, "Summary")]);
    fireEvent.click(screen.getByRole("button", { name: "Paragraph settings" }));
    const dialog = screen.getByRole("dialog", { name: "Paragraph" });
    const select = within(dialog).getByLabelText("Outline level") as HTMLSelectElement;
    expect(select.value).toBe("9");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "setParagraphProps", patch: { outlineLevel: 1 } })));
  });
});
