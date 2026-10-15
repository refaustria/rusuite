import { afterEach, describe, expect, it, vi } from "vitest";

const setTitle = vi.fn(async (_title: string) => {});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, string>) => {
    switch (cmd) {
      case "ping":
        return "tauri-pong";
      case "dispatch":
        return JSON.stringify({ ok: { echo: args?.request } });
      case "open_file_dialog":
        return { path: "/tmp/a.xlsx", name: "a.xlsx", bytesBase64: "UEs=" };
      case "save_file_dialog":
        return args?.suggestedName === "cancel.xlsx" ? null : "/tmp/out.xlsx";
      case "recent_list":
        return [{ name: "a.xlsx", path: "/tmp/a.xlsx", blobId: null, openedAt: 1 }];
      case "recent_open":
        return { path: args?.path, name: "a.xlsx", bytesBase64: "UEs=" };
      case "recovery_list":
      case "recovery_put":
      case "recovery_remove":
        return cmd === "recovery_list" ? [] : null;
      case "recovery_get":
        return null;
      default:
        throw new Error(`unknown command ${cmd}`);
    }
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle }),
}));

import {
  DOCX_MIME,
  TauriBackend,
  WasmBackend,
  base64ToBytes,
  bytesToBase64,
  createBackend,
  isTauri,
  type Response,
  type WasmModule,
} from "./backend";
import { invoke } from "@tauri-apps/api/core";

const fake: WasmModule = {
  ping: () => "wasm-pong",
  dispatch: (json) => JSON.stringify({ ok: { got: JSON.parse(json) } }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("base64", () => {
  it("roundtrips all byte values and large inputs", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
    expect(bytesToBase64(new TextEncoder().encode("PK\u0003"))).toBe("UEsD");
    const big = new Uint8Array(40_000).map((_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});

describe("isTauri", () => {
  it("is false in a plain browser", () => {
    expect(isTauri()).toBe(false);
  });
  it("detects __TAURI_INTERNALS__", () => {
    vi.stubGlobal("window", {});
    expect(isTauri()).toBe(false);
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
  });
});

describe("WasmBackend", () => {
  it("pings and roundtrips JSON", async () => {
    const b = new WasmBackend<{ type: string }, { got: unknown }>(fake);
    expect(b.kind).toBe("wasm");
    expect(await b.ping()).toBe("wasm-pong");
    const r: Response<{ got: unknown }> = await b.dispatch({ type: "info" });
    expect(r).toEqual({ ok: { got: { type: "info" } } });
  });

  it("sets the document title", async () => {
    await new WasmBackend(fake).setTitle("a.xlsx • – Rusuite Calc");
    expect(document.title).toBe("a.xlsx • – Rusuite Calc");
  });

  it("opens a file through a hidden input", async () => {
    let picked: HTMLInputElement | undefined;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      picked = this;
    });
    const pending = new WasmBackend(fake).openFile();
    expect(picked?.type).toBe("file");
    expect(picked?.accept).toContain(".xlsx");
    expect(picked?.isConnected).toBe(true);
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "book.xlsx");
    Object.defineProperty(picked, "files", { value: [file] });
    picked!.dispatchEvent(new Event("change"));
    expect(await pending).toEqual({ name: "book.xlsx", bytesBase64: "UEsDBA==" });
    expect(picked?.isConnected).toBe(false);
  });

  it("resolves null when the picker is cancelled", async () => {
    let picked: HTMLInputElement | undefined;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      picked = this;
    });
    const pending = new WasmBackend(fake).openFile();
    picked!.dispatchEvent(new Event("cancel"));
    expect(await pending).toBeNull();
    expect(picked?.isConnected).toBe(false);
  });

  it("saves a file as a download", async () => {
    const createObjectURL = vi.fn((_: Blob) => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = this;
    });
    expect(await new WasmBackend(fake).saveFile("out.xlsx", "UEsDBA==")).toBe(true);
    expect(clicked?.download).toBe("out.xlsx");
    expect(clicked?.href).toBe("blob:test");
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain("spreadsheetml");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 3, 4]),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("uses the file options (Write: .docx)", async () => {
    let picked: HTMLInputElement | undefined;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      picked = this;
    });
    const b = new WasmBackend(fake, { accept: `.docx,${DOCX_MIME}`, mime: DOCX_MIME });
    const pending = b.openFile();
    expect(picked?.accept).toBe(`.docx,${DOCX_MIME}`);
    picked!.dispatchEvent(new Event("cancel"));
    await pending;
    const createObjectURL = vi.fn((_: Blob) => "blob:docx");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await b.saveFile("report.docx", "UEsDBA==")).toBe(true);
    expect(createObjectURL.mock.calls[0][0].type).toBe(DOCX_MIME);
    await b.saveFile("other.bin", "UEsDBA==");
    expect(createObjectURL.mock.calls[1][0].type).toBe("application/octet-stream");
  });
});

describe("TauriBackend", () => {
  it("invokes ping and dispatch", async () => {
    const b = new TauriBackend();
    expect(b.kind).toBe("tauri");
    expect(await b.ping()).toBe("tauri-pong");
    const r = await b.dispatch<{ echo: string }>({ type: "info" });
    expect(r).toEqual({ ok: { echo: '{"type":"info"}' } });
    expect(invoke).toHaveBeenCalledWith("dispatch", { request: '{"type":"info"}' });
  });

  it("opens and saves through the native dialogs", async () => {
    const b = new TauriBackend();
    expect(await b.openFile()).toEqual({ name: "a.xlsx", bytesBase64: "UEs=" });
    expect(invoke).toHaveBeenCalledWith("open_file_dialog");
    expect(await b.saveFile("out.xlsx", "UEs=")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("save_file_dialog", {
      suggestedName: "out.xlsx",
      bytesBase64: "UEs=",
    });
    expect(await b.saveFile("cancel.xlsx", "UEs=")).toBe(false);
  });

  it("sets the window title", async () => {
    await new TauriBackend().setTitle("x – Rusuite Calc");
    expect(setTitle).toHaveBeenCalledWith("x – Rusuite Calc");
  });
});

describe("createBackend", () => {
  it("uses wasm outside Tauri", async () => {
    const load = vi.fn(async () => fake);
    expect((await createBackend(load)).kind).toBe("wasm");
    expect(load).toHaveBeenCalled();
  });
  it("uses tauri inside Tauri without loading wasm", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const load = vi.fn(async () => fake);
    expect((await createBackend(load)).kind).toBe("tauri");
    expect(load).not.toHaveBeenCalled();
  });
});

describe("Backend.storage", () => {
  it("Tauri: session commands of the shell", async () => {
    const storage = new TauriBackend().storage;
    expect(storage.kind).toBe("fs");
    const recent = await storage.listRecent();
    expect(await storage.rememberRecent("ignored", null)).toEqual(recent);
    expect(await storage.openRecent(recent[0]!)).toEqual({ file: { name: "a.xlsx", bytesBase64: "UEs=" } });
    expect(invoke).toHaveBeenCalledWith("recent_open", { path: "/tmp/a.xlsx" });
    const entry = { id: "d1", name: null, savedAt: 1, revision: 1, json: "{}" };
    await storage.putRecovery(entry);
    expect(invoke).toHaveBeenCalledWith("recovery_put", { entry });
    await storage.removeRecovery("d1");
    expect(invoke).toHaveBeenCalledWith("recovery_remove", { id: "d1" });
    expect(await storage.getRecovery("d1")).toBeNull();
    expect(await storage.listRecovery()).toEqual([]);
  });

  it("web: IndexedDB when available, else none; overridable", async () => {
    expect(new WasmBackend(fake).storage).toBeUndefined(); // jsdom has no IndexedDB
    const { IDBFactory } = await import("fake-indexeddb");
    vi.stubGlobal("indexedDB", new IDBFactory());
    const web = new WasmBackend(fake);
    expect(web.storage?.kind).toBe("browser");
    await web.storage!.putRecovery({ id: "x", name: null, savedAt: 1, revision: 1, json: "{}" });
    expect((await web.storage!.listRecovery()).map((e) => e.id)).toEqual(["x"]);
    expect(new WasmBackend(fake, { storage: null }).storage).toBeUndefined();
  });
});
