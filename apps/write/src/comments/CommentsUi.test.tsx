// P8-25 UI: Review tab, user name dialog, draft → comment, balloons /
// indicators / pane, reply, resolve and the pane filter, status bar count,
// context menu — through the real App on the fake backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: vi.fn() }) }));

import { bytesToBase64 } from "@rusuite/ui-shared";
import App from "../App";
import type { Block } from "../generated/Block";
import type { Document } from "../generated/Document";
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
  localStorage.clear();
  setWidth(1024);
});

function setWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  window.dispatchEvent(new Event("resize"));
}

const b64 = (v: unknown) => bytesToBase64(new TextEncoder().encode(JSON.stringify(v)));
const tab = (name: string) => screen.getByRole("tab", { name });
const applied = (backend: FakeWriteBackend): WriteCommand[] => backend.log.flatMap((r) => (r.type === "apply" ? [r.command] : []));

const commented: Partial<Document> = {
  comments: [
    { id: 1, author: "Anna Berg", initials: "AB", date: "2026-10-01T09:30:00Z", content: [para(101, "Check this")] },
    { id: 2, author: "Ben Cole", initials: "BC", date: "2026-10-02T09:30:00Z", content: [para(102, "Agreed")], parent: 1 },
    { id: 3, author: "Ben Cole", date: "2026-10-03T09:30:00Z", content: [para(103, "Done")], resolved: true },
  ],
};
const commentedBody: Block[] = [
  para(1, [run("The "), { kind: "commentStart", value: { id: 1 } }, run("quick"), { kind: "commentEnd", value: { id: 1 } }, run(" fox")]),
  para(2, [{ kind: "commentStart", value: { id: 3 } }, run("second"), { kind: "commentEnd", value: { id: 3 } }]),
];

async function mount(body: Block[] = [para(1, "hello brave world")], extra: Partial<Document> = {}) {
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

describe("Review › comments", () => {
  it("the first New Comment asks for the user name; posting adds the comment", async () => {
    const { backend } = await mount();
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "New Comment" }));
    const dialog = await screen.findByRole("dialog", { name: "User Name" }, T);
    fireEvent.change(within(dialog).getByTestId("user-name"), { target: { value: "Anna Berg" } });
    expect((within(dialog).getByTestId("user-initials") as HTMLInputElement).value).toBe("AB");
    fireEvent.click(within(dialog).getByTestId("user-ok"));
    await waitFor(() => expect(backend.log).toContainEqual({ type: "setUser", name: "Anna Berg", initials: "AB" }), T);
    expect(JSON.parse(localStorage.getItem("rusuite.write.user")!)).toEqual({ name: "Anna Berg", initials: "AB" });
    // Narrow window: the draft appears in the Comments pane.
    const draft = await screen.findByTestId("comment-draft-text", undefined, T);
    fireEvent.change(draft, { target: { value: "Is this right?" } });
    fireEvent.keyDown(draft, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "addComment", text: "Is this right?" })), T);
    const cmd = applied(backend).find((c) => c.type === "addComment") as Extract<WriteCommand, { type: "addComment" }>;
    expect(cmd.start).toEqual({ block: 1, offset: 0 });
    expect(cmd.end).toEqual({ block: 1, offset: 5 });
    expect(cmd.date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const pane = await screen.findByTestId("comments-pane", undefined, T);
    await waitFor(() => expect(within(pane).getByTestId("comment-author").textContent).toBe("Anna Berg"), T);
    expect(within(pane).getByTestId("comment-text").textContent).toBe("Is this right?");
    expect(screen.getByTestId("comment-count").textContent).toBe("1 comment");
    expect(document.querySelector("[data-comment-start]")).toBeTruthy();
  });

  it("a remembered user is sent on start; Ctrl+Alt+M opens the draft without asking", async () => {
    localStorage.setItem("rusuite.write.user", JSON.stringify({ name: "Zoe Q", initials: "ZQ" }));
    const { backend, editor } = await mount();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(editor, { key: "m", code: "KeyM", ctrlKey: true, altKey: true });
    expect(await screen.findByTestId("comment-draft", undefined, T)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "User Name" })).toBeNull();
    void backend;
  });

  it("an opened document shows its threads; reply, resolve and the pane filter", async () => {
    localStorage.setItem("rusuite.write.user", JSON.stringify({ name: "Ben Cole", initials: "BC" }));
    const { backend } = await mount(commentedBody, commented);
    const pane = await screen.findByTestId("comments-pane", undefined, T);
    await waitFor(() => expect(within(pane).getAllByTestId("comment-thread").length).toBe(2), T);
    expect(screen.getByTestId("comment-count").textContent).toBe("3 comments");
    const first = within(pane).getAllByTestId("comment-thread")[0]!;
    expect(within(first).getAllByTestId("comment-reply").length).toBe(1);
    fireEvent.pointerDown(first);
    const box = await within(first).findByTestId("comment-reply-box", undefined, T);
    fireEvent.change(box, { target: { value: "Fixed now" } });
    fireEvent.click(within(first).getByTestId("comment-reply-box-post"));
    await waitFor(() => expect(applied(backend)).toContainEqual(expect.objectContaining({ type: "replyComment", parent: 1, text: "Fixed now" })), T);
    fireEvent.click(within(first).getByTestId("comment-resolve"));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "resolveComment", id: 1 }), T);
    fireEvent.change(screen.getByTestId("comments-filter"), { target: { value: "open" } });
    await waitFor(() => expect(screen.getByTestId("comments-empty")).toBeTruthy(), T);
    fireEvent.change(screen.getByTestId("comments-filter"), { target: { value: "resolved" } });
    await waitFor(() => expect(within(screen.getByTestId("comments-pane")).getAllByTestId("comment-thread").length).toBe(2), T);
  });

  it("wide windows show balloons in the margin; Show Comments off leaves indicators", async () => {
    setWidth(1600);
    await mount(commentedBody, commented);
    const margin = await screen.findByTestId("comments-margin", undefined, T);
    await waitFor(() => expect(within(margin).getAllByTestId("comment-thread").length).toBe(2), T);
    expect(screen.queryByTestId("comments-pane")).toBeNull();
    fireEvent.click(tab("Review"));
    const show = screen.getByRole("button", { name: "Show Comments" });
    expect(show.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(show);
    await waitFor(() => expect(screen.getAllByTestId("comment-indicator").length).toBe(2), T);
    expect(screen.queryAllByTestId("comment-thread").length).toBe(0);
    fireEvent.click(screen.getAllByTestId("comment-indicator")[0]!);
    await waitFor(() => expect(screen.getAllByTestId("comment-thread").length).toBe(2), T);
    await waitFor(() => expect(document.querySelector('[data-comment-id="1"][data-active="true"]')).toBeTruthy(), T);
    // The selected comment's range is highlighted.
    await waitFor(() => expect(document.querySelector(".comment-range-active")).toBeTruthy(), T);
  });

  it("Review › Delete ▾ deletes all resolved comments; Delete deletes the selected one", async () => {
    const { backend } = await mount(commentedBody, commented);
    fireEvent.click(tab("Review"));
    fireEvent.click(screen.getByRole("button", { name: "Delete options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete All Resolved Comments" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "deleteAllComments", resolvedOnly: true }), T);
    await waitFor(() => expect(screen.getByTestId("comment-count").textContent).toBe("2 comments"), T);
    const thread = within(screen.getByTestId("comments-pane")).getAllByTestId("comment-thread")[0]!;
    fireEvent.pointerDown(thread);
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(false), T);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(applied(backend)).toContainEqual({ type: "deleteComment", id: 1 }), T);
    await waitFor(() => expect(screen.queryByTestId("comment-count")).toBeNull(), T);
  });

  it("the context menu and File › Options", async () => {
    const { editor } = await mount();
    fireEvent.contextMenu(editor, { clientX: 10, clientY: 10 });
    expect(await screen.findByRole("menuitem", { name: /New Comment/ }, T)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
    fireEvent.click(screen.getByRole("tab", { name: "File" }));
    fireEvent.click(await screen.findByRole("button", { name: "Options…" }, T));
    // File › Options (P9-W5): General › User Name… opens the user name dialog.
    const options = await screen.findByRole("dialog", { name: "Options" }, T);
    fireEvent.click(within(options).getByRole("button", { name: "User Name…" }));
    expect(await screen.findByRole("dialog", { name: "User Name" }, T)).toBeTruthy();
    await act(async () => undefined);
  });
});
