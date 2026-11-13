// The converters (OneNote, Markdown, HTML, .docx import; Markdown/HTML/.docx export; the HTML paste sanitiser) are a
// second wasm module, `app-notes-convert-wasm` (P11-N6b), loaded with a dynamic `import()` the first time one is
// used – a normal page open never fetches it. Its results are frames (`notes_core::plan`): `json_len: u32 LE`, the
// JSON, then the blobs as `{len: u32 LE, bytes}*`.

import { CoreError, rethrow } from "../backend";
import type { ExportFormat } from "../generated/ExportFormat";
import type { ExportSource } from "../generated/ExportSource";
import type { ImportContextData } from "../generated/ImportContextData";
import type { ImportKind } from "../generated/ImportKind";
import { t } from "../i18n";

/** The exports of `app-notes-convert-wasm` (wasm-pack, `--target web`). */
export interface ConvertWasmModule {
  ping(): string;
  import_file(request: string, bytes: Uint8Array): Uint8Array;
  export_file(request: string, blobs: Uint8Array): Uint8Array;
  paste_html(request: string): Uint8Array;
}

export type ConvertLoader = () => Promise<ConvertWasmModule>;

/** The converter module could not be loaded (offline, a failed deploy …). */
export class ConvertLoadError extends Error {
  constructor(cause: unknown) {
    super(t("notes.convert.loadFailed", { message: cause instanceof Error ? cause.message : String(cause) }));
    this.name = "ConvertLoadError";
  }
}

export interface ImportFileRequest {
  kind: ImportKind;
  fileName: string;
  /** Random below 2^53: seeds the page doc ids of OneNote imports. */
  seed?: number;
  context?: ImportContextData;
}

/** A decoded frame. */
export interface Frame {
  json: string;
  blobs: Uint8Array[];
}

export function encodeFrame(json: string, blobs: readonly Uint8Array[]): Uint8Array {
  const text = new TextEncoder().encode(json);
  const out = new Uint8Array(4 + text.length + blobs.reduce((n, b) => n + 4 + b.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, text.length, true);
  out.set(text, 4);
  let at = 4 + text.length;
  for (const b of blobs) {
    view.setUint32(at, b.length, true);
    out.set(b, at + 4);
    at += 4 + b.length;
  }
  return out;
}

export function decodeFrame(bytes: Uint8Array): Frame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => new CoreError("bad_request", "truncated frame");
  if (bytes.length < 4) throw bad();
  const len = view.getUint32(0, true);
  if (4 + len > bytes.length) throw bad();
  const json = new TextDecoder().decode(bytes.subarray(4, 4 + len));
  const blobs: Uint8Array[] = [];
  let at = 4 + len;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw bad();
    const n = view.getUint32(at, true);
    if (at + 4 + n > bytes.length) throw bad();
    blobs.push(bytes.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return { json, blobs };
}

/** Only the JSON of a frame (the plan; its blobs stay in the bytes for `apply_import`). */
export function frameJson(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new CoreError("bad_request", "truncated frame");
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + len > bytes.length) throw new CoreError("bad_request", "truncated frame");
  return new TextDecoder().decode(bytes.subarray(4, 4 + len));
}

/** The converter module behind a lazy load (loads once; a failed load can be retried). */
export class LazyConverter {
  private pending: Promise<ConvertWasmModule> | null = null;
  /** The module is loaded (the e2e suite and the status check this). */
  loaded = false;
  /** Called with `true` when a load starts and `false` when it ends. */
  onLoading?: (loading: boolean) => void;

  constructor(private readonly load: ConvertLoader) {}

  module(): Promise<ConvertWasmModule> {
    if (!this.pending) {
      this.onLoading?.(true);
      this.pending = this.load().then(
        (m) => {
          this.loaded = true;
          this.onLoading?.(false);
          return m;
        },
        (e: unknown) => {
          this.pending = null;
          this.onLoading?.(false);
          throw new ConvertLoadError(e);
        },
      );
    }
    return this.pending;
  }

  /** A file → an import plan frame for the main module's `apply_import`. */
  async importFile(request: ImportFileRequest, bytes: Uint8Array): Promise<Uint8Array> {
    const m = await this.module();
    try {
      return m.import_file(JSON.stringify(request), bytes);
    } catch (e) {
      rethrow(e);
    }
  }

  /** An export source (+ the bytes of its blobs) → the file. */
  async exportFile(format: ExportFormat, source: ExportSource, blobs: Uint8Array): Promise<Uint8Array> {
    const m = await this.module();
    try {
      return m.export_file(JSON.stringify({ format, source }), blobs);
    } catch (e) {
      rethrow(e);
    }
  }

  /** Pasted HTML → a frame: `{content, warnings}` and the blobs of its `data:` images. */
  async pasteHtml(html: string, context?: ImportContextData): Promise<Uint8Array> {
    const m = await this.module();
    try {
      return m.paste_html(JSON.stringify({ html, ...(context ? { context } : {}) }));
    } catch (e) {
      rethrow(e);
    }
  }
}
