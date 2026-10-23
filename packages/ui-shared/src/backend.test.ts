import { afterEach, describe, expect, it, vi } from "vitest";

const setTitle = vi.fn(async (_title: string) => {});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, string | boolean>) => {
    switch (cmd) {
      case "ping":
        return "tauri-pong";
      case "dispatch":
        return JSON.stringify({ ok: { echo: args?.request } });
      case "open_file_dialog":
        return { path: "/tmp/a.xlsx", name: "a.xlsx", bytesBase64: "UEs=" };
      case "save_file":
        // The shell writes the document's file, or the file picked in the dialog.
        return args?.suggestedName === "cancel.xlsx" ? null : { path: "/tmp/picked.xlsx", name: "picked.xlsx" };
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
      // Mobile shells (P10-M1): document pickers, write-back / export, share sheet, Open with.
      case "open_document":
        return { path: "content://docs/1", name: "m.xlsx", bytesBase64: "UEs=" };
      case "save_document":
        if (args?.suggestedName === "cancel.xlsx") return null;
        // iOS exports the app cannot write to again come back without a handle.
        return args?.suggestedName === "unbound.xlsx"
          ? { path: "", name: "unbound.xlsx" }
          : { path: "content://docs/2", name: "saved.xlsx" };
      case "share_document":
        return null;
      // PDF (P10-M6).
      case "export_pdf":
        return args?.suggestedName === "cancel.pdf" ? null : "picked.pdf";
      case "print_pdf":
      case "share_pdf":
        return null;
      case "take_launch_document":
        return { path: "content://mail/7", name: "attachment.xlsx", bytesBase64: "UEs=" };
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
  UnsupportedError,
  capabilitiesOf,
  pdfFileName,
  isMobile,
  mobilePlatform,
  WasmBackend,
  base64ToBytes,
  bytesToBase64,
  createBackend,
  isTauri,
  savedName,
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
    expect(invoke).toHaveBeenCalledWith("open_file_dialog", { dialog: { title: "Open" } });
    const saved = await b.saveFile("out.xlsx", "UEs=");
    expect(saved).toEqual({ name: "picked.xlsx", path: "/tmp/picked.xlsx" });
    expect(savedName(saved, "out.xlsx")).toBe("picked.xlsx");
    expect(invoke).toHaveBeenCalledWith("save_file", { suggestedName: "out.xlsx", bytesBase64: "UEs=", saveAs: false, dialog: { title: "Save As" } });
    await b.saveFile("out.xlsx", "UEs=", { saveAs: true });
    expect(invoke).toHaveBeenLastCalledWith("save_file", { suggestedName: "out.xlsx", bytesBase64: "UEs=", saveAs: true, dialog: { title: "Save As" } });
    expect(await b.saveFile("cancel.xlsx", "UEs=")).toBe(false);
    expect(savedName(true, "out.xlsx")).toBe("out.xlsx");
  });

  it("prints through the shell's print_webview, falling back to window.print", async () => {
    const spy = vi.spyOn(window, "print").mockImplementation(() => {});
    vi.mocked(invoke).mockResolvedValueOnce(null);
    await new TauriBackend().print();
    expect(invoke).toHaveBeenLastCalledWith("print_webview");
    expect(spy).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no print"));
    await new TauriBackend().print();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
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

  it("web: connections and the AI assistant are desktop-app features (ADR 0009)", () => {
    const web = new WasmBackend(fake);
    expect(web.connectors).toBeUndefined();
    expect(web.ai?.available).toBe(false);
    expect(new WasmBackend(fake, { ai: false }).ai).toBeUndefined();
  });

  it("test hook: the simulated desktop platform enables both", () => {
    vi.stubGlobal("__RUSUITE_PLATFORM__", "desktop");
    try {
      const sim = new WasmBackend(fake);
      expect(sim.connectors).toBeDefined();
      expect(sim.ai?.available).toBe(true);
      expect(new WasmBackend(fake, { connectors: false }).connectors).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("mobile shells (P10-M1)", () => {
  it("detects the mobile marker of tauri-plugin-rusuite-mobile", () => {
    expect(isMobile()).toBe(false);
    expect(mobilePlatform()).toBeNull();
    vi.stubGlobal("__RUSUITE_MOBILE__", "android");
    expect(mobilePlatform()).toBe("android");
    vi.stubGlobal("__RUSUITE_MOBILE__", "ios");
    expect(isMobile()).toBe(true);
    vi.stubGlobal("__RUSUITE_MOBILE__", "windows");
    expect(isMobile()).toBe(false);
  });

  it("capabilities: desktop and web print, only mobile shares, PDFs where the shell renders them; absent = defaults", () => {
    expect(new TauriBackend().capabilities).toEqual({ print: true, saveAs: true, share: false, pdf: false });
    expect(new WasmBackend(fake, { storage: null }).capabilities).toEqual({ print: true, saveAs: true, share: false, pdf: false });
    expect(new TauriBackend(undefined, ".xlsx", { mobile: true, pdf: false }).capabilities).toEqual({
      print: false,
      saveAs: true,
      share: true,
      pdf: false,
    });
    // The shell's marker (P10-M6): Print comes back on mobile, through the PDF.
    vi.stubGlobal("__RUSUITE_PDF__", true);
    expect(new TauriBackend(undefined, ".xlsx", { mobile: true }).capabilities).toEqual({ print: true, saveAs: true, share: true, pdf: true });
    expect(new TauriBackend().capabilities.pdf).toBe(true);
    expect(capabilitiesOf({})).toEqual({ print: true, saveAs: true, share: false, pdf: false });
    expect(capabilitiesOf({ capabilities: { print: false, saveAs: true, share: true, pdf: true } }).pdf).toBe(true);
  });

  it("PDF commands (P10-M6): export everywhere, print and share on mobile", async () => {
    const paper = { widthMm: 210, heightMm: 297, landscape: false };
    const desktop = new TauriBackend(undefined, ".xlsx", { pdf: true });
    expect(await desktop.exportPdf("Book1.pdf", paper)).toBe("picked.pdf");
    expect(invoke).toHaveBeenLastCalledWith("export_pdf", { suggestedName: "Book1.pdf", paper, dialog: { title: "Export PDF" } });
    expect(await desktop.exportPdf("cancel.pdf", paper)).toBeNull();
    await expect(desktop.sharePdf("a.pdf", paper)).rejects.toBeInstanceOf(UnsupportedError);
    await expect(new TauriBackend(undefined, ".xlsx", { pdf: false }).exportPdf("a.pdf", paper)).rejects.toBeInstanceOf(UnsupportedError);
    const mobile = new TauriBackend(undefined, ".xlsx", { mobile: true, pdf: true });
    vi.stubGlobal("document", { title: "• Budget.xlsx – Rusuite Calc" });
    await mobile.print({ ...paper, widthMm: 297, heightMm: 210, landscape: true });
    expect(invoke).toHaveBeenLastCalledWith("print_pdf", { suggestedName: "Budget.pdf", paper: { widthMm: 297, heightMm: 210, landscape: true } });
    await mobile.print();
    expect(invoke).toHaveBeenLastCalledWith("print_pdf", { suggestedName: "Budget.pdf", paper });
    await mobile.sharePdf("Budget.pdf", paper);
    expect(invoke).toHaveBeenLastCalledWith("share_pdf", { suggestedName: "Budget.pdf", paper });
  });

  it("names PDFs after the document", () => {
    expect(pdfFileName("Budget.xlsx")).toBe("Budget.pdf");
    expect(pdfFileName("• Report.docx")).toBe("Report.pdf");
    expect(pdfFileName("Deck")).toBe("Deck.pdf");
    expect(pdfFileName("")).toBe("Untitled.pdf");
  });

  it("the web build exports PDFs only through the e2e hook (simulated desktop)", async () => {
    const hook = vi.fn(async () => "x.pdf");
    vi.stubGlobal("__RUSUITE_TEST_INVOKE__", hook);
    expect(new WasmBackend(fake, { storage: null }).capabilities.pdf).toBe(false);
    vi.stubGlobal("__RUSUITE_PLATFORM__", "desktop");
    const b = new WasmBackend(fake, { storage: null, ai: false, connectors: false });
    expect(b.capabilities.pdf).toBe(true);
    const paper = { widthMm: 215.9, heightMm: 279.4, landscape: false };
    expect(await b.exportPdf("a.pdf", paper)).toBe("x.pdf");
    expect(hook).toHaveBeenCalledWith("export_pdf", { suggestedName: "a.pdf", paper, dialog: { title: "Export PDF" } });
  });

  it("has neither connections nor the AI assistant (desktop-only, owner rule)", () => {
    const b = new TauriBackend(undefined, ".xlsx", { mobile: true });
    expect(b.mobile).toBe(true);
    expect(b.connectors).toBeUndefined();
    expect(b.ai).toBeUndefined();
    const desktop = new TauriBackend();
    expect(desktop.connectors).toBeDefined();
    expect(desktop.ai).toBeDefined();
  });

  it("opens through the document picker and saves back or through the save-to picker", async () => {
    const b = new TauriBackend(() => "Excel workbook", ".xlsx", { mobile: true });
    expect(await b.openFile()).toEqual({ name: "m.xlsx", bytesBase64: "UEs=" });
    expect(invoke).toHaveBeenLastCalledWith("open_document");
    expect(await b.saveFile("a.xlsx", "UEs=")).toEqual({ name: "saved.xlsx", path: "content://docs/2" });
    expect(invoke).toHaveBeenLastCalledWith("save_document", { suggestedName: "a.xlsx", bytesBase64: "UEs=", saveAs: false });
    await b.saveFile("a.xlsx", "UEs=", { saveAs: true });
    expect(invoke).toHaveBeenLastCalledWith("save_document", { suggestedName: "a.xlsx", bytesBase64: "UEs=", saveAs: true });
    expect(await b.saveFile("unbound.xlsx", "UEs=")).toEqual({ name: "unbound.xlsx" });
    expect(await b.saveFile("cancel.xlsx", "UEs=")).toBe(false);
  });

  it("shares, hands out the launch document and rejects print as unsupported (no PDF renderer)", async () => {
    const b = new TauriBackend(undefined, ".xlsx", { mobile: true, pdf: false });
    await b.share("a.xlsx", "UEs=");
    expect(invoke).toHaveBeenLastCalledWith("share_document", { suggestedName: "a.xlsx", bytesBase64: "UEs=" });
    expect(await b.takeLaunchDocument()).toEqual({ name: "attachment.xlsx", bytesBase64: "UEs=" });
    const print = vi.fn();
    vi.stubGlobal("window", { print });
    const err = await b.print().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect((err as UnsupportedError).code).toBe("unsupported");
    expect(print).not.toHaveBeenCalled();
  });

  it("titles the page instead of the window", async () => {
    setTitle.mockClear();
    vi.stubGlobal("document", { title: "" });
    await new TauriBackend(undefined, ".xlsx", { mobile: true }).setTitle("a.xlsx – Rusuite Calc");
    expect(document.title).toBe("a.xlsx – Rusuite Calc");
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("desktop shells: no launch document, no share sheet", async () => {
    vi.mocked(invoke).mockClear();
    const b = new TauriBackend();
    expect(await b.takeLaunchDocument()).toBeNull();
    await expect(b.share("a.xlsx", "UEs=")).rejects.toBeInstanceOf(UnsupportedError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("createBackend picks the mobile mode inside a mobile shell", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("__RUSUITE_MOBILE__", "ios");
    const loadWasm = vi.fn();
    const b = await createBackend(loadWasm);
    expect(b).toBeInstanceOf(TauriBackend);
    expect((b as TauriBackend).mobile).toBe(true);
    expect(b.capabilities?.print).toBe(false);
    expect(loadWasm).not.toHaveBeenCalled();
  });
});
