import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ribbon } from "../ribbon/Ribbon";
import { DocumentSession } from "../recent/session";
import { FakeCore, fakeBackend } from "../recent/testing";
import { Connectors, type ConnectorPlatform } from "./controller";
import { MemoryProvider } from "./fake";
import { MemoryConnectionStore } from "./store";
import { ConnectionDialog, draftOf } from "./ui/ConnectionDialog";
import { FileBrowser, saveName, visibleEntries } from "./ui/FileBrowser";

afterEach(cleanup);

function env() {
  const fs = new MemoryProvider();
  const store = new MemoryConnectionStore();
  const platform: ConnectorPlatform = { kind: "web", store, extensions: [".xlsx"], provider: () => fs };
  return { fs, store, c: new Connectors(platform) };
}

const DRAFT = {
  name: "Nextcloud",
  baseUrl: "https://cloud.example.com/dav",
  auth: { kind: "basic" as const, username: "alice", password: "pw" },
  rootPath: "/",
  allowHttp: false,
  rememberPassword: false,
};

describe("ConnectionDialog", () => {
  it("turns the fields into a connection record", () => {
    expect(draftOf({ name: " N ", url: "https://h/dav/ ", username: " u ", password: " p ", root: "", allowHttp: true, remember: true })).toEqual({
      kind: "webdav",
      name: "N",
      baseUrl: "https://h/dav",
      auth: { kind: "basic", username: "u", password: " p " },
      rootPath: "/",
      allowHttp: true,
      rememberPassword: true,
    });
  });

  it("checks the URL, tests the connection and saves it", async () => {
    const { c, fs, store } = env();
    fs.put("/a.xlsx", "x");
    fs.put("/b.docx", "x");
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<ConnectionDialog connectors={c} onClose={() => {}} onSaved={onSaved} />);
    const dlg = screen.getByRole("dialog", { name: "Add a connection" });
    const url = within(dlg).getByLabelText("Server URL");
    await user.type(url, "http://nas.local/dav");
    expect((within(dlg).getByTestId("conn-url-error")).textContent).toContain("unencrypted http://");
    expect((within(dlg).getByRole("button", { name: "Save connection" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(url);
    await user.type(url, "https://cloud.example.com/dav");
    expect((within(dlg).getByTestId("conn-contacts")).textContent).toContain("contact https://cloud.example.com directly");
    await user.type(within(dlg).getByLabelText("Name"), "Nextcloud");
    await user.type(within(dlg).getByLabelText("User name"), "alice");
    await user.type(within(dlg).getByLabelText("Password"), "pw");
    await user.click(within(dlg).getByRole("button", { name: "Test connection" }));
    expect((await within(dlg).findByRole("status")).textContent).toContain("Connected. The folder lists 2 entries.");
    await user.click(within(dlg).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Nextcloud", baseUrl: "https://cloud.example.com/dav" })));
    expect(store.data.connections).toHaveLength(1);
    expect(store.secrets.size).toBe(0);
  });
});

describe("FileBrowser", () => {
  it("filters by extension, sorts folders first, and names Save As files", () => {
    const e = (name: string, kind: "file" | "folder" = "file") => ({ name, path: `/${name}`, kind, size: null, modified: null, etag: null });
    expect(visibleEntries([e("b.xlsx"), e("Zed", "folder"), e("a.docx"), e("A.xlsx"), e("Alpha", "folder")], [".xlsx"], false).map((x) => x.name)).toEqual([
      "Alpha",
      "Zed",
      "A.xlsx",
      "b.xlsx",
    ]);
    expect(saveName("Budget", [".xlsx"])).toBe("Budget.xlsx");
    expect(saveName("Budget.XLSX", [".xlsx"])).toBe("Budget.XLSX");
    expect(saveName("  ", [".xlsx"])).toBe("");
  });

  it("browses with breadcrumbs and the keyboard, opens a file", async () => {
    const { c, fs } = env();
    const conn = await c.saveConnection(DRAFT);
    fs.put("/Docs/Q3 Budget.xlsx", "x");
    fs.put("/Docs/notes.docx", "x");
    fs.put("/top.xlsx", "x");
    const onOpen = vi.fn();
    render(<FileBrowser connectors={c} connection={conn} mode="open" onOpen={onOpen} />);
    const list = await screen.findByRole("listbox", { name: "Files" });
    await waitFor(() => expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Docs"), expect.stringContaining("top.xlsx")]));
    list.focus();
    fireEvent.keyDown(list, { key: "Enter" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
    expect(within(screen.getByTestId("breadcrumbs")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Nextcloud", "Docs"]);
    fireEvent.click(screen.getByLabelText("Show all files"));
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("/Docs/Q3 Budget.xlsx");
    fireEvent.keyDown(list, { key: "Backspace" });
    await waitFor(() => expect(within(screen.getByTestId("breadcrumbs")).getAllByRole("button")).toHaveLength(1));
    // 32 px rows.
    expect(within(list).getAllByRole("option")[0]!.className).toContain("h-8");
  });

  it("creates, renames and deletes (after confirming), and warns before replacing on Save As", async () => {
    const { c, fs } = env();
    const conn = await c.saveConnection(DRAFT);
    fs.put("/old.xlsx", "x");
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FileBrowser connectors={c} connection={conn} mode="save" defaultName="old.xlsx" onSave={onSave} />);
    const list = await screen.findByRole("listbox", { name: "Files" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "New folder" }));
    const folder = screen.getByLabelText("Name of the new folder");
    await user.clear(folder);
    await user.type(folder, "Reports{Enter}");
    await waitFor(() => expect(fs.nodes.get("/Reports")?.kind).toBe("folder"));

    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "F2" });
    const rename = screen.getByLabelText("New name for old.xlsx");
    await user.clear(rename);
    await user.type(rename, "new.xlsx{Enter}");
    await waitFor(() => expect(fs.nodes.has("/new.xlsx")).toBe(true));

    await user.clear(screen.getByLabelText("File name"));
    await user.type(screen.getByLabelText("File name"), "new");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const ask = await screen.findByRole("dialog", { name: "Replace file" });
    expect((ask).textContent).toContain('"new.xlsx" already exists on Nextcloud');
    await user.click(within(ask).getByRole("button", { name: "Replace" }));
    expect(onSave).toHaveBeenCalledWith("/new.xlsx");

    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Delete" });
    const del = await screen.findByRole("dialog", { name: "Delete" });
    await user.click(within(del).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fs.nodes.has("/new.xlsx")).toBe(false));
  });
});

describe("Backstage Open / Save As with connections", () => {
  function app() {
    const e = env();
    const backend = { ...fakeBackend(new FakeCore()), connectors: e.c };
    const session = new DocumentSession(backend, { target: null, locks: null });
    const openFile = vi.fn(async (file: { name: string; bytesBase64: string }) => {
      await session.backend.dispatch({ type: "openXlsx", name: file.name, bytesBase64: file.bytesBase64 });
    });
    session.attach({ restore: async () => true, openFile, saveAs: async () => true });
    const onOpen = vi.fn();
    const onSaveAs = vi.fn();
    render(<Ribbon tabs={[]} appName="Rusuite Calc" documentTitle="Book1.xlsx •" backstage={{ session, onOpen, onSaveAs, onSave: () => {} }} />);
    return { ...e, session, openFile, onOpen, onSaveAs };
  }

  it("File › Open shows This device and the connections; a remote file opens and closes the backstage", async () => {
    const { c, fs, onOpen, openFile } = app();
    const user = userEvent.setup();
    await c.saveConnection(DRAFT);
    fs.put("/a.xlsx", "x");
    await user.click(screen.getByRole("tab", { name: "File" }));
    await user.click(within(screen.getByTestId("backstage")).getByRole("button", { name: /^Open/ }));
    const page = screen.getByTestId("open-page");
    await user.click(within(page).getByRole("button", { name: /This device/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("tab", { name: "File" }));
    await user.click(within(screen.getByTestId("backstage")).getByRole("button", { name: /^Open/ }));
    await user.click(within(screen.getByTestId("connection-list")).getByRole("button", { name: /Nextcloud/ }));
    const row = await screen.findByRole("option", { name: /a\.xlsx/ });
    await user.dblClick(row);
    await waitFor(() => expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ name: "a.xlsx" })));
    await waitFor(() => expect(screen.queryByTestId("backstage")).toBeNull());
    expect(c.getState().location?.path).toBe("/a.xlsx");
  });

  it("Save As offers the connections with the document's name; Privacy can forget them", async () => {
    const { c, store } = app();
    const user = userEvent.setup();
    await c.saveConnection({ ...DRAFT, rememberPassword: true });
    await user.click(screen.getByRole("tab", { name: "File" }));
    await user.click(within(screen.getByTestId("backstage")).getByRole("button", { name: /^Save As/ }));
    await user.click(within(screen.getByTestId("connection-list")).getByRole("button", { name: /Nextcloud/ }));
    expect(((await screen.findByLabelText("File name")) as HTMLInputElement).value).toBe("Book1.xlsx");
    await user.click(within(screen.getByTestId("backstage")).getByRole("button", { name: "Home" }));
    await user.click(screen.getByRole("button", { name: "Forget all connections" }));
    expect(await screen.findByTestId("privacy-forgotten")).toBeTruthy();
    expect(store.data.connections).toEqual([]);
    expect(store.secrets.size).toBe(0);
  });
});
