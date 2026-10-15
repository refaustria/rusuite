// The transport-agnostic backend (ADR 0005 §4): UI code talks to the Rust
// core only through `Backend`; it never imports `@tauri-apps/api` itself.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DispatchError } from "./generated/DispatchError";

export type { DispatchError };

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
  /** Lets the user save a file; `false` when cancelled. */
  saveFile(suggestedName: string, bytesBase64: string): Promise<boolean>;
  /** Sets the window (Tauri) or document (web) title. */
  setTitle(title: string): Promise<void>;
}

/** Standard base64 of `bytes` (chunked: large files exceed the argument limit). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decodes standard base64. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** MIME type of `.xlsx` files. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** MIME type of `.docx` files. */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** File types of the web shell (default: `.xlsx`, as Calc). */
export interface WasmFileOptions {
  /** `accept` of the file input. */
  accept?: string;
  /** MIME type of downloads whose name ends with the extension of `accept`'s first entry. */
  mime?: string;
}

/** Desktop shell: the Tauri commands of `apps/<app>/src-tauri`. */
export class TauriBackend<Req = unknown, Body = unknown> implements Backend<Req, Body> {
  readonly kind = "tauri" as const;

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
    } | null>("open_file_dialog");
    return picked ? { name: picked.name, bytesBase64: picked.bytesBase64 } : null;
  }

  async saveFile(suggestedName: string, bytesBase64: string): Promise<boolean> {
    const path = await invoke<string | null>("save_file_dialog", {
      suggestedName,
      bytesBase64,
    });
    return path !== null;
  }

  setTitle(title: string): Promise<void> {
    return getCurrentWindow().setTitle(title);
  }
}

/** Web shell: the app's wasm module plus browser file handling. */
export class WasmBackend<Req = unknown, Body = unknown> implements Backend<Req, Body> {
  readonly kind = "wasm" as const;

  private readonly accept: string;
  private readonly mime: string;
  private readonly ext: string;

  constructor(
    private readonly module: WasmModule,
    /** File types (default: `.xlsx`); a plain string is the input's `accept`. */
    options: WasmFileOptions | string = {},
  ) {
    const o = typeof options === "string" ? { accept: options } : options;
    this.accept = o.accept ?? `.xlsx,${XLSX_MIME}`;
    this.mime = o.mime ?? XLSX_MIME;
    this.ext = (this.accept.split(",")[0] ?? "").trim().toLowerCase();
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

  /** Downloads the file via `<a download>`; always `true` (the browser owns the rest). */
  async saveFile(suggestedName: string, bytesBase64: string): Promise<boolean> {
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

  async setTitle(title: string): Promise<void> {
    document.title = title;
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
  if (isTauri()) return new TauriBackend<Req, Body>();
  return new WasmBackend<Req, Body>(await loadWasm(), options);
}
