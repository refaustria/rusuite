// The Notes backend (ADR 0005 §4, like ui-shared's `Backend`): the UI reaches notes-core only through this
// interface. The web implementation wraps `app-notes-wasm` in-process; the Tauri shell (P11-N7) will implement the
// same calls over IPC. JSON commands go through `dispatch`, bytes through the binary calls (docs/notes-format.md §5).

import { base64ToBytes, bytesToBase64, WasmBackend, type BackendCapabilities, type PdfPaper, type ReportHost } from "@rusuite/ui-shared";
import { LazyConverter, type ConvertLoader } from "./convert/loader";
import { decodeEffects, frameRecords, splitRecords, type PersistEffect } from "./effects";
import type { Request } from "./generated/Request";
import type { Response } from "./generated/Response";
import type { ResponseBody } from "./generated/ResponseBody";

/** A request with the UI clock (the core has none). */
export type NotesRequest = Request & { now?: number };

/** The reply body of type `K`. */
export type Body<K extends ResponseBody["type"]> = Extract<ResponseBody, { type: K }>;

/** An error reply of the core (`{err: {code, message}}`). */
export class CoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/** The body of an `ok` reply; throws `CoreError` for `err`. */
export function unwrap(reply: Response): ResponseBody {
  if ("err" in reply) throw new CoreError(reply.err.code, reply.err.message);
  return reply.ok;
}

export interface NotesBackend extends ReportHost {
  readonly kind: "wasm" | "tauri";
  /** `"Rusuite Notes <version>"`. */
  ping(): Promise<string>;
  dispatch(request: NotesRequest): Promise<Response>;
  /** A stored document before `openNotebook`; `log` in `.log` framing. */
  loadDoc(notebook: string, doc: string, snapshot: Uint8Array, log: Uint8Array): Promise<Response>;
  importUpdates(doc: string, bytes: Uint8Array): Promise<Response>;
  /** The device got its sharing id: peers recorded for `from` are recorded for `to` (P11-N5b). */
  rebindDevice(from: string, to: string): Promise<void>;
  /** Relay bytes into `doc` of open notebook `notebook` (P11-N5b) → whether anything changed. */
  importRemote(notebook: string, doc: string, bytes: Uint8Array): Promise<boolean>;
  /** Updates missing from `vv` (`VersionVector.encode()`, empty = all). */
  exportUpdates(doc: string, vv: Uint8Array): Promise<Uint8Array>;
  versionVector(doc: string): Promise<Uint8Array>;
  /** `exportUpdates` in parts of at most `maxBytes` (a first share of a large page; the relay's envelope limit). */
  exportUpdateChunks(doc: string, vv: Uint8Array, maxBytes: number): Promise<Uint8Array[]>;
  takePersistEffects(): Promise<PersistEffect[]>;
  exportBackup(notebook: string, blobs: readonly Uint8Array[]): Promise<Uint8Array>;
  importBackup(bytes: Uint8Array): Promise<Response>;
  pageGenesis(): Promise<Uint8Array>;
  blobId(bytes: Uint8Array): Promise<string>;
  /** Stores an image / attachment of `notebook` (a Blob persist effect) → its id (SHA-256 hex). */
  putBlob(notebook: string, bytes: Uint8Array): Promise<string>;
  /** Applies an import plan frame of the converters to its target (an `import*` request) → `fileImported`. */
  applyImport(request: NotesRequest, frame: Uint8Array): Promise<Response>;
  /** The converters (P11-N6b; web: a second wasm module loaded on first use). */
  readonly converter: LazyConverter;
  /** Print (ui-shared's print pipeline): the system print dialog for the mounted print root. */
  print(paper?: PdfPaper): Promise<void>;
  /** Export PDF without a dialog where the shell renders PDFs (`capabilities.pdf`). */
  exportPdf?(suggestedName: string, paper: PdfPaper): Promise<string | null>;
  readonly capabilities?: BackendCapabilities;
  /** Lets the user pick a file (`.rnotes` backups); `null` when cancelled. */
  openFile(): Promise<{ name: string; bytes: Uint8Array } | null>;
  /** Web: a download. */
  saveFile(name: string, bytes: Uint8Array): Promise<boolean>;
  setTitle(title: string): Promise<void>;
}

/** The exports of `app-notes-wasm` (wasm-pack, `--target web`). */
export interface NotesWasmModule {
  ping(): string;
  dispatch(request: string): string;
  load_doc(notebook: string, doc: string, snapshot: Uint8Array, log: Uint8Array): string;
  import_updates(doc: string, bytes: Uint8Array): string;
  import_remote(notebook: string, doc: string, bytes: Uint8Array): boolean;
  rebind_device(from: string, to: string): void;
  export_updates(doc: string, vv: Uint8Array): Uint8Array;
  export_update_chunks(doc: string, vv: Uint8Array, max_bytes: number): Uint8Array;
  version_vector(doc: string): Uint8Array;
  take_persist_effects(): Uint8Array;
  page_genesis(): Uint8Array;
  export_backup(notebook: string, blobs: Uint8Array): Uint8Array;
  import_backup(bytes: Uint8Array): string;
  blob_id(bytes: Uint8Array): string;
  put_blob(notebook: string, bytes: Uint8Array): string;
  apply_import(request: string, plan: Uint8Array): string;
}

export const BACKUP_EXT = ".rnotes";
const BACKUP_MIME = "application/zip";

/** Thrown JSON error replies of the binary calls → `CoreError`. */
export function rethrow(e: unknown): never {
  if (typeof e === "string") {
    try {
      const r = JSON.parse(e) as Response;
      unwrap(r);
    } catch (inner) {
      if (inner instanceof CoreError) throw inner;
    }
    throw new CoreError("error", e);
  }
  throw e;
}

/** The web shell: the wasm core in this page, browser file handling from ui-shared's `WasmBackend`. */
export class WebNotesBackend implements NotesBackend {
  readonly kind = "wasm" as const;
  private readonly files: WasmBackend;
  readonly converter: LazyConverter;

  constructor(
    private readonly m: NotesWasmModule,
    loadConverter: ConvertLoader = () => Promise.reject(new Error("no converter module")),
  ) {
    this.converter = new LazyConverter(loadConverter);
    this.files = new WasmBackend(m, { accept: `${BACKUP_EXT},${BACKUP_MIME}`, mime: BACKUP_MIME, storage: null, connectors: false, ai: false });
  }

  async ping(): Promise<string> {
    return this.m.ping();
  }
  async dispatch(request: NotesRequest): Promise<Response> {
    return JSON.parse(this.m.dispatch(JSON.stringify(request))) as Response;
  }
  async loadDoc(notebook: string, doc: string, snapshot: Uint8Array, log: Uint8Array): Promise<Response> {
    return JSON.parse(this.m.load_doc(notebook, doc, snapshot, log)) as Response;
  }
  async importUpdates(doc: string, bytes: Uint8Array): Promise<Response> {
    return JSON.parse(this.m.import_updates(doc, bytes)) as Response;
  }
  async rebindDevice(from: string, to: string): Promise<void> {
    try {
      this.m.rebind_device(from, to);
    } catch (e) {
      rethrow(e);
    }
  }
  async importRemote(notebook: string, doc: string, bytes: Uint8Array): Promise<boolean> {
    try {
      return this.m.import_remote(notebook, doc, bytes);
    } catch (e) {
      rethrow(e);
    }
  }
  async exportUpdates(doc: string, vv: Uint8Array): Promise<Uint8Array> {
    try {
      return this.m.export_updates(doc, vv);
    } catch (e) {
      rethrow(e);
    }
  }
  async exportUpdateChunks(doc: string, vv: Uint8Array, maxBytes: number): Promise<Uint8Array[]> {
    try {
      return splitRecords(this.m.export_update_chunks(doc, vv, maxBytes));
    } catch (e) {
      rethrow(e);
    }
  }
  async versionVector(doc: string): Promise<Uint8Array> {
    try {
      return this.m.version_vector(doc);
    } catch (e) {
      rethrow(e);
    }
  }
  async takePersistEffects(): Promise<PersistEffect[]> {
    return decodeEffects(this.m.take_persist_effects());
  }
  async exportBackup(notebook: string, blobs: readonly Uint8Array[]): Promise<Uint8Array> {
    try {
      return this.m.export_backup(notebook, frameRecords(blobs));
    } catch (e) {
      rethrow(e);
    }
  }
  async importBackup(bytes: Uint8Array): Promise<Response> {
    return JSON.parse(this.m.import_backup(bytes)) as Response;
  }
  async pageGenesis(): Promise<Uint8Array> {
    return this.m.page_genesis();
  }
  async blobId(bytes: Uint8Array): Promise<string> {
    return this.m.blob_id(bytes);
  }
  async putBlob(notebook: string, bytes: Uint8Array): Promise<string> {
    try {
      return this.m.put_blob(notebook, bytes);
    } catch (e) {
      rethrow(e);
    }
  }
  async applyImport(request: NotesRequest, frame: Uint8Array): Promise<Response> {
    return JSON.parse(this.m.apply_import(JSON.stringify(request), frame)) as Response;
  }
  get capabilities(): BackendCapabilities {
    return this.files.capabilities;
  }
  print(): Promise<void> {
    return this.files.print();
  }
  async openFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
    const f = await this.files.openFile();
    return f && { name: f.name, bytes: base64ToBytes(f.bytesBase64) };
  }
  async saveFile(name: string, bytes: Uint8Array): Promise<boolean> {
    return (await this.files.saveFile(name, bytesToBase64(bytes))) !== false;
  }
  setTitle(title: string): Promise<void> {
    return this.files.setTitle(title);
  }
}
