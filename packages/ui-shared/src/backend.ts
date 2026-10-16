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

export type { DispatchError };
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
   * Opens the system print dialog for the current page (the user picks a
   * printer or "Save as PDF"). Web: `window.print()`. Desktop: the shell's
   * `print_webview` command (`WebviewWindow::print`: the native WebKitGTK /
   * WKWebView print operation, `window.print()` in WebView2), falling back
   * to `window.print()` if the command fails.
   */
  print(): Promise<void>;
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
}

/** Desktop shell: the Tauri commands of `apps/<app>/src-tauri`. */
export class TauriBackend<Req = unknown, Body = unknown> implements Backend<Req, Body> {
  readonly kind = "tauri" as const;
  readonly storage: DocStorage = new TauriDocStorage();
  readonly connectors: Connectors;
  private title = new TitleDecorator((title) => getCurrentWindow().setTitle(title));

  /**
   * `fileTypeLabel`: the localized filter name of the native file dialogs (read when a dialog opens);
   * `accept`: the app's file types (`.xlsx,…`, default `.xlsx`) for the connections' file browser.
   */
  constructor(
    private readonly fileTypeLabel?: () => string,
    accept = ".xlsx",
  ) {
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

  async openFile(): Promise<OpenedFile | null> {
    const picked = await invoke<{
      path: string;
      name: string;
      bytesBase64: string;
    } | null>("open_file_dialog", this.dialogText(t("dialog.open.title")));
    return picked ? { name: picked.name, bytesBase64: picked.bytesBase64 } : null;
  }

  /** The shell's `save_file`: it keeps the document's file (`DocPath`) and asks only when needed. */
  async saveFile(suggestedName: string, bytesBase64: string, options: SaveOptions = {}): Promise<SaveResult> {
    const remote = await this.connectors.trySave(suggestedName, bytesBase64, options);
    if (remote !== undefined) return remote;
    const saved = await invoke<{ path: string; name: string } | null>("save_file", {
      suggestedName,
      bytesBase64,
      saveAs: options.saveAs === true,
      ...this.dialogText(t("dialog.saveAs.title")),
    });
    if (!saved) return false;
    this.connectors.localSaved();
    return { name: saved.name, path: saved.path };
  }

  setTitle(title: string): Promise<void> {
    return this.title.set(title);
  }

  async print(): Promise<void> {
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
  private title = new TitleDecorator(async (title) => {
    document.title = title;
  });

  constructor(
    private readonly module: WasmModule,
    /** File types (default: `.xlsx`); a plain string is the input's `accept`. */
    options: WasmFileOptions | string = {},
  ) {
    const o = typeof options === "string" ? { accept: options } : options;
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
    if (o.connectors !== false) {
      this.connectors = new Connectors(webConnectorPlatform(extensionsOf(this.accept)));
      this.title.follow(this.connectors);
    }
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
