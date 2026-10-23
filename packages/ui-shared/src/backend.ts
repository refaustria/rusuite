// The transport-agnostic backend (ADR 0005 §4): UI code talks to the Rust
// core only through `Backend`; it never imports `@tauri-apps/api` itself.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DispatchError } from "./generated/DispatchError";
import { IdbDocStorage, dbNameFromPing } from "./recent/idb";
import type { DocStorage } from "./recent/storage";
import { TauriDocStorage } from "./recent/tauri";
import { t } from "./i18n/locale";
import { Connectors } from "./connectors/controller";
import { extensionsOf, tauriConnectorPlatform, webConnectorPlatform } from "./connectors/platform";
import { Assistant } from "./ai/controller";
import { BrowserAiStore, TauriAiStore } from "./ai/settings";
import { isMobile } from "./mobile/platform";

export * from "./mobile/platform";

export type { DispatchError };

/**
 * Test hook: the e2e suite pretends the web build is a desktop app (`window.__RUSUITE_PLATFORM__ = "desktop"`, set
 * with `addInitScript`) to exercise connections and the AI assistant against local servers. It is read from the
 * production bundle too, but it only reveals UI: the site's CSP (`connect-src 'self'`) still blocks every other host.
 */
export function simulatedDesktop(): boolean {
  return (globalThis as { __RUSUITE_PLATFORM__?: unknown }).__RUSUITE_PLATFORM__ === "desktop";
}
/**
 * Whether the shell renders PDFs with the webview's own renderer (P10-M6): its `tauri-plugin-rusuite-mobile` marks
 * the page with `window.__RUSUITE_PDF__` (Android, iOS, the Linux desktop), before any app code runs.
 */
export function shellRendersPdf(): boolean {
  return (globalThis as { __RUSUITE_PDF__?: unknown }).__RUSUITE_PDF__ === true;
}

/**
 * e2e hook (P10-M6): with `simulatedDesktop()`, a page function `window.__RUSUITE_TEST_INVOKE__(cmd, args)` stands
 * in for the shell's PDF commands, so the web build shows the shell's Export PDF path (`capabilities.pdf`). Nothing
 * else reads it.
 */
function testInvoke(): ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null {
  if (!simulatedDesktop()) return null;
  const f = (globalThis as { __RUSUITE_TEST_INVOKE__?: unknown }).__RUSUITE_TEST_INVOKE__;
  return typeof f === "function" ? (f as (cmd: string, args: Record<string, unknown>) => Promise<unknown>) : null;
}

/** The sheet size of a PDF's pages (the print document's `@page` size as laid out: landscape = wider than high). */
export interface PdfPaper {
  widthMm: number;
  heightMm: number;
  landscape: boolean;
}

/** A4 portrait, when a print gives no paper. */
export const DEFAULT_PDF_PAPER: PdfPaper = { widthMm: 210, heightMm: 297, landscape: false };

// Recent files, autosave and crash recovery (P5-3).
export * from "./recent";

/**
 * The reply of every app core's `dispatch` (ADR 0002 amendment):
 * `{ ok: body }` or `{ err: DispatchError }`. With an app's generated
 * `ResponseBody` as `T` this is exactly that app's generated `Response`.
 */
export type Response<T = unknown> = { ok: T } | { err: DispatchError };

/** A file picked by the user, as standard base64. */
export interface OpenedFile {
  name: string;
  bytesBase64: string;
}

/** Options of `Backend.saveFile`. */
export interface SaveOptions {
  /**
   * Save As: always ask where to save (desktop: the native dialog), even
   * when the document is bound to a file. Default: a plain Save, which on
   * the desktop writes to the document's file without a dialog.
   */
  saveAs?: boolean;
}

/** A file written by the desktop shell. */
export interface SavedFile {
  /** The file name without the directory (the user may have changed it in the dialog). */
  name: string;
  path?: string;
}

/**
 * Result of `Backend.saveFile`: `false` = cancelled; `true` = written under
 * the suggested name (web download); a `SavedFile` = written as that file.
 */
export type SaveResult = boolean | SavedFile;

/** The name a `saveFile` result was written under (`suggested` for a plain `true`). */
export function savedName(result: SaveResult, suggested: string): string {
  return typeof result === "object" ? result.name : suggested;
}

/**
 * What the platform offers beyond the core file commands (P10-M1). The UI hides a command whose capability is
 * `false`; an absent `capabilities` (test fakes) means everything is available.
 */
export interface BackendCapabilities {
  /**
   * `Backend.print` prints (desktop and web: the print dialog; mobile shells: the system print service with the
   * page's PDF, P10-M6).
   */
  print: boolean;
  /**
   * `Backend.exportPdf` writes a PDF without a print dialog, through the webview's own PDF renderer (P10-M6:
   * Android, iOS, the Linux desktop). `false`: File › Export PDF… opens the print dialog ("Save as PDF").
   */
  pdf: boolean;
  /** Save As can pick a new name and place (desktop dialog, mobile "save to" picker, web download name). */
  saveAs: boolean;
  /** `Backend.share` hands a copy to the system share sheet (mobile shells only). */
  share: boolean;
}

/** `Backend.capabilities` with the defaults of an absent object (everything but `share` and `pdf`). */
export function capabilitiesOf(backend: Pick<Backend, "capabilities">): BackendCapabilities {
  return { print: true, saveAs: true, share: false, pdf: false, ...backend.capabilities };
}

/** A platform feature the backend does not have (`Backend.print` in the mobile shells). */
export class UnsupportedError extends Error {
  readonly code = "unsupported" as const;
  constructor(readonly feature: string) {
    super(`${feature} is not supported on this platform`);
    this.name = "UnsupportedError";
  }
}

/** The exports of an app's `wasm-pack` package. */
export interface WasmModule {
  ping(): string;
  dispatch(json: string): string;
}

/**
 * One instance per window. `Req`/`Body` are the app's generated
 * `Request`/`ResponseBody` types (e.g. `Backend<Request, ResponseBody>` in
 * Calc); the defaults keep app-agnostic code untyped.
 */
export interface Backend<Req = unknown, Body = unknown> {
  readonly kind: "tauri" | "wasm";
  /** Health check: `"Rusuite Calc <version>"`. */
  ping(): Promise<string>;
  /** Sends one request to the app core and returns its parsed reply. */
  dispatch<T = Body>(request: Req): Promise<Response<T>>;
  /** Lets the user pick a file; `null` when cancelled. */
  openFile(): Promise<OpenedFile | null>;
  /**
   * Saves the document's bytes; `false` when cancelled. Desktop: a plain
   * Save of a document opened from or saved to a file writes that file
   * without asking; otherwise (untitled, or `saveAs`) the native save
   * dialog asks and the shell remembers the chosen file. Web: a download
   * named `suggestedName`.
   */
  saveFile(suggestedName: string, bytesBase64: string, options?: SaveOptions): Promise<SaveResult>;
  /** Sets the window (Tauri) or document (web) title. */
  setTitle(title: string): Promise<void>;
  /**
   * Recent files and crash-recovery entries (Tauri: JSON files in the app
   * data directory; web: IndexedDB). Absent where nothing can be stored.
   */
  readonly storage?: DocStorage;
  /**
   * Cloud connections (P8-36): opt-in WebDAV servers the user configured.
   * `saveFile` of a document opened from one writes back there; absent in
   * test fakes.
   */
  readonly connectors?: Connectors;
  /**
   * The AI assistant (P8-37): off by default; requests go from this page / webview straight to the provider the
   * user configured, only when the user runs an AI action. Absent in test fakes.
   */
  readonly ai?: Assistant;
  /**
   * Opens the system print dialog for the current page (the user picks a
   * printer or "Save as PDF"). Web: `window.print()`. Desktop: the shell's
   * `print_webview` command (`WebviewWindow::print`: the native WebKitGTK /
   * WKWebView print operation, `window.print()` in WebView2), falling back
   * to `window.print()` if the command fails. Mobile shells (P10-M6): the page's PDF on `paper` (the mounted
   * print root's) handed to the system print service (`print_pdf`).
   */
  print(paper?: PdfPaper): Promise<void>;
  /**
   * `capabilities.pdf` (P10-M6): renders the mounted print root to a PDF on `paper` with the webview's own
   * renderer and lets the user pick where it goes (desktop: the save dialog first; mobile: the system "save to"
   * picker). The chosen file name, `null` when cancelled.
   */
  exportPdf?(suggestedName: string, paper: PdfPaper): Promise<string | null>;
  /** Mobile shells (`capabilities.pdf` and `share`): the same PDF handed to the system share sheet. */
  sharePdf?(suggestedName: string, paper: PdfPaper): Promise<void>;
  /** What the platform offers (P10-M1); absent in test fakes (= `capabilitiesOf`'s defaults). */
  readonly capabilities?: BackendCapabilities;
  /** Mobile shells: hands a copy of the document to the system share sheet (`capabilities.share`). */
  share?(suggestedName: string, bytesBase64: string): Promise<void>;
  /**
   * Mobile shells: the document the app was opened with ("Open with", a tap in Files), once; `null` when there is
   * none. The session asks on start and whenever the page becomes visible again.
   */
  takeLaunchDocument?(): Promise<OpenedFile | null>;
}

export { bytesToBase64, base64ToBytes } from "./base64";
import { bytesToBase64, base64ToBytes } from "./base64";

/** MIME type of `.xlsx` files. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** MIME type of `.docx` files. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** MIME type of `.pptx` files. */
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** File types of the web shell (default: `.xlsx`, as Calc). */
export interface WasmFileOptions {
  /** `accept` of the file input. */
  accept?: string;
  /** MIME type of downloads whose name ends with the extension of `accept`'s first entry. */
  mime?: string;
  /** Recent/recovery storage; default IndexedDB (`rusuite-<app>` from `ping()`), `null` = none. */
  storage?: DocStorage | null;
  /** Desktop: the localized name of the file-type filter of the native dialogs ("Excel workbook"). */
  fileTypeLabel?: () => string;
  /** Cloud connections (P8-36; default on – nothing is contacted until the user adds one). */
  connectors?: boolean;
  /** The AI assistant (P8-37; default available – off until the user enables it in Settings › AI). */
  ai?: boolean;
}

/** The Tauri shells' file results (`open_file_dialog`, `open_document`, …). */
interface ShellFile {
  path: string;
  name: string;
  bytesBase64: string;
}

/**
 * The Tauri shells (`apps/<app>/src-tauri`). Desktop: native file dialogs, print, connections and the AI assistant.
 * Mobile (`mobile`, default `isMobile()`; P10-M1): the system document pickers through the shell's
 * `open_document` / `save_document` / `share_document` / `take_launch_document` commands, no print, and – owner
 * rule – neither connections nor the AI assistant (`connectors` / `ai` absent, so their settings never appear).
 * Recent files and crash recovery stay in the app data directory on both.
 */
export class TauriBackend<Req = unknown, Body = unknown> implements Backend<Req, Body> {
  readonly kind = "tauri" as const;
  readonly storage: DocStorage = new TauriDocStorage();
  readonly connectors?: Connectors;
  readonly ai?: Assistant;
  readonly capabilities: BackendCapabilities;
  readonly mobile: boolean;
  private title: TitleDecorator;

  /**
   * `fileTypeLabel`: the localized filter name of the native file dialogs (read when a dialog opens);
   * `accept`: the app's file types (`.xlsx,…`, default `.xlsx`) for the connections' file browser.
   */
  constructor(
    private readonly fileTypeLabel?: () => string,
    accept = ".xlsx",
    options: { mobile?: boolean; pdf?: boolean } = {},
  ) {
    this.mobile = options.mobile ?? isMobile();
    const pdf = options.pdf ?? shellRendersPdf();
    this.capabilities = { print: !this.mobile || pdf, saveAs: true, share: this.mobile, pdf };
    // Mobile windows have no title bar: the page title is enough (and needs no window permission).
    this.title = new TitleDecorator(
      this.mobile
        ? async (title) => {
            document.title = title;
          }
        : (title) => getCurrentWindow().setTitle(title),
    );
    if (this.mobile) return;
    this.ai = new Assistant({ store: new TauriAiStore() });
    this.connectors = new Connectors(tauriConnectorPlatform(extensionsOf(accept)));
    this.title.follow(this.connectors);
  }

  /** The shell's `dialog` argument: localized title and filter name of its native dialogs (English filter name when absent). */
  private dialogText(title: string): { dialog: { title: string; filterName?: string } } {
    return { dialog: { title, ...(this.fileTypeLabel && { filterName: this.fileTypeLabel() }) } };
  }

  ping(): Promise<string> {
    return invoke<string>("ping");
  }

  async dispatch<T = Body>(request: Req): Promise<Response<T>> {
    const reply = await invoke<string>("dispatch", {
      request: JSON.stringify(request),
    });
    return JSON.parse(reply) as Response<T>;
  }

  /** Desktop: the native open dialog; mobile: the system document picker (`open_document`). */
  async openFile(): Promise<OpenedFile | null> {
    const picked = this.mobile
      ? await invoke<ShellFile | null>("open_document")
      : await invoke<ShellFile | null>("open_file_dialog", this.dialogText(t("dialog.open.title")));
    return picked ? { name: picked.name, bytesBase64: picked.bytesBase64 } : null;
  }

  /**
   * The shell's `save_file` (desktop) / `save_document` (mobile): it keeps the document's file or picked document
   * (`DocPath`) and asks only when needed – mobile writes back to the picked document and otherwise (untitled,
   * Save As, a read-only "Open with" document) shows the system "save to" picker.
   */
  async saveFile(suggestedName: string, bytesBase64: string, options: SaveOptions = {}): Promise<SaveResult> {
    const remote = await this.connectors?.trySave(suggestedName, bytesBase64, options);
    if (remote !== undefined) return remote;
    const saveAs = options.saveAs === true;
    const saved = this.mobile
      ? await invoke<{ path: string; name: string } | null>("save_document", { suggestedName, bytesBase64, saveAs })
      : await invoke<{ path: string; name: string } | null>("save_file", {
          suggestedName,
          bytesBase64,
          saveAs,
          ...this.dialogText(t("dialog.saveAs.title")),
        });
    if (!saved) return false;
    this.connectors?.localSaved();
    return saved.path ? { name: saved.name, path: saved.path } : { name: saved.name };
  }

  /** Mobile: the system share sheet with a copy (`share_document`); the desktop shells have none. */
  async share(suggestedName: string, bytesBase64: string): Promise<void> {
    if (!this.mobile) throw new UnsupportedError("share");
    await invoke("share_document", { suggestedName, bytesBase64 });
  }

  /** The shell's `export_pdf` (`capabilities.pdf`): desktop asks for the path in the native save dialog first. */
  async exportPdf(suggestedName: string, paper: PdfPaper): Promise<string | null> {
    if (!this.capabilities.pdf) throw new UnsupportedError("pdf");
    return invoke<string | null>("export_pdf", { suggestedName, paper, dialog: { title: t("dialog.exportPdf.title") } });
  }

  /** Mobile: the page's PDF to the share sheet (`share_pdf`). */
  async sharePdf(suggestedName: string, paper: PdfPaper): Promise<void> {
    if (!this.mobile || !this.capabilities.pdf) throw new UnsupportedError("share");
    await invoke("share_pdf", { suggestedName, paper });
  }

  /** Mobile: the "Open with" document, once (`take_launch_document`); the desktop shells: always `null`. */
  async takeLaunchDocument(): Promise<OpenedFile | null> {
    if (!this.mobile) return null;
    const file = await invoke<ShellFile | null>("take_launch_document");
    return file ? { name: file.name, bytesBase64: file.bytesBase64 } : null;
  }

  setTitle(title: string): Promise<void> {
    return this.title.set(title);
  }

  async print(paper?: PdfPaper): Promise<void> {
    if (this.mobile) {
      if (!this.capabilities.pdf) throw new UnsupportedError("print");
      await invoke("print_pdf", { suggestedName: pdfJobName(), paper: paper ?? DEFAULT_PDF_PAPER });
      return;
    }
    try {
      await invoke("print_webview");
    } catch {
      window.print();
    }
  }
}

/** Web shell: the app's wasm module plus browser file handling. */
export class WasmBackend<Req = unknown, Body = unknown> implements Backend<Req, Body> {
  readonly kind = "wasm" as const;

  private readonly accept: string;
  private readonly mime: string;
  private readonly ext: string;
  readonly storage?: DocStorage;
  readonly connectors?: Connectors;
  readonly ai?: Assistant;
  readonly capabilities: BackendCapabilities;
  /** The e2e stand-in for the shell's PDF commands (`testInvoke`); `null` in real browsers. */
  private readonly pdfInvoke = testInvoke();
  private title = new TitleDecorator(async (title) => {
    document.title = title;
  });

  constructor(
    private readonly module: WasmModule,
    /** File types (default: `.xlsx`); a plain string is the input's `accept`. */
    options: WasmFileOptions | string = {},
  ) {
    const o = typeof options === "string" ? { accept: options } : options;
    this.capabilities = { print: true, saveAs: true, share: false, pdf: this.pdfInvoke !== null };
    this.accept = o.accept ?? `.xlsx,${XLSX_MIME}`;
    this.mime = o.mime ?? XLSX_MIME;
    this.ext = (this.accept.split(",")[0] ?? "").trim().toLowerCase();
    const storage =
      o.storage !== undefined
        ? o.storage
        : IdbDocStorage.available()
          ? new IdbDocStorage(() => dbNameFromPing(this.module.ping()))
          : null;
    if (storage) this.storage = storage;
    // ADR 0009 (owner decision 2026-10-16): the web CSP stays `connect-src 'self'`, so connections and the AI
    // assistant are desktop-app features; the web build keeps only a note in File › Options….
    const desktop = simulatedDesktop();
    if (o.connectors !== false && desktop) {
      this.connectors = new Connectors(webConnectorPlatform(extensionsOf(this.accept)));
      this.title.follow(this.connectors);
    }
    if (o.ai !== false) this.ai = new Assistant({ store: new BrowserAiStore(), available: desktop });
  }

  async ping(): Promise<string> {
    return this.module.ping();
  }

  async dispatch<T = Body>(request: Req): Promise<Response<T>> {
    return JSON.parse(this.module.dispatch(JSON.stringify(request))) as Response<T>;
  }

  /** A hidden `<input type=file>`; resolves `null` on cancel. */
  openFile(): Promise<OpenedFile | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = this.accept;
      input.style.display = "none";
      input.addEventListener("cancel", () => {
        input.remove();
        resolve(null);
      });
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () =>
          resolve({
            name: file.name,
            bytesBase64: bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)),
          });
        reader.onerror = () => reject(reader.error ?? new Error("cannot read file"));
        reader.readAsArrayBuffer(file);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Downloads the file via `<a download>`; always `true` (the browser owns the rest). A document of a
   * connection is written back there instead (`Connectors.trySave`).
   */
  async saveFile(suggestedName: string, bytesBase64: string, options: SaveOptions = {}): Promise<SaveResult> {
    const remote = await this.connectors?.trySave(suggestedName, bytesBase64, options);
    if (remote !== undefined) return remote;
    this.connectors?.localSaved();
    const type = this.ext.startsWith(".") && suggestedName.toLowerCase().endsWith(this.ext)
      ? this.mime
      : "application/octet-stream";
    const blob = new Blob([base64ToBytes(bytesBase64) as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke once the click has been handled.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  }

  setTitle(title: string): Promise<void> {
    return this.title.set(title);
  }

  async print(): Promise<void> {
    window.print();
  }

  /** Only with the e2e hook (`capabilities.pdf`): the browser itself has no dialog-free PDF path. */
  async exportPdf(suggestedName: string, paper: PdfPaper): Promise<string | null> {
    if (!this.pdfInvoke) throw new UnsupportedError("pdf");
    return (await this.pdfInvoke("export_pdf", { suggestedName, paper, dialog: { title: t("dialog.exportPdf.title") } })) as string | null;
  }
}

/** `<document name>.pdf`: the name without its extension (`Budget.xlsx` → `Budget.pdf`); untitled when empty. */
export function pdfFileName(documentName: string): string {
  const name = documentName.replace(/^\s*•\s*|\s*•\s*$/g, "").trim().replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return `${name || t("doc.untitled")}.pdf`;
}

/** The print job's name: the page title without the app name and the unsaved mark. */
function pdfJobName(): string {
  return pdfFileName((typeof document === "undefined" ? "" : document.title).split(/\s+[–-]\s+/)[0]!);
}

/** Applies window titles with the remote connection's name (re-applied when the binding changes). */
class TitleDecorator {
  private raw: string | null = null;
  private shown: string | null = null;
  private connectors: Connectors | null = null;

  constructor(private readonly apply: (title: string) => Promise<void>) {}

  follow(connectors: Connectors): void {
    this.connectors = connectors;
    connectors.subscribe(() => {
      if (this.raw !== null && connectors.decorateTitle(this.raw) !== this.shown) void this.set(this.raw).catch(() => undefined);
    });
  }

  set(title: string): Promise<void> {
    this.raw = title;
    this.shown = this.connectors ? this.connectors.decorateTitle(title) : title;
    return this.apply(this.shown);
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Picks the Tauri backend inside the desktop shell, else loads WASM. */
export async function createBackend<Req = unknown, Body = unknown>(
  loadWasm: () => Promise<WasmModule>,
  options: WasmFileOptions = {},
): Promise<Backend<Req, Body>> {
  if (isTauri()) return new TauriBackend<Req, Body>(options.fileTypeLabel, options.accept);
  return new WasmBackend<Req, Body>(await loadWasm(), options);
}
