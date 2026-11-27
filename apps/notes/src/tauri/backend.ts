// The desktop shell's side of Notes (P11-N7): the same `NotesBackend` and `NotesStore` as the web, over the
// Tauri commands of `apps/notes/src-tauri` (its `lib.rs` documents each command's arguments and reply).
//
// Bytes travel as raw IPC bodies: `json_len:u32 LE` + the JSON arguments + the payload (`frameArgs`); byte
// replies arrive as an `ArrayBuffer`. A command's error is a string: core errors are the core's JSON error reply,
// which `rethrow` turns into a `CoreError` like the web's.

import { base64ToBytes, bytesToBase64, isTauri, shellRendersPdf, type BackendCapabilities, type PdfPaper } from "@rusuite/ui-shared";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { CoreError, rethrow, type LaunchFiles, type NotesBackend, type NotesRequest } from "../backend";
import { LazyConverter, type ImportFileRequest } from "../convert/loader";
import type { ExportFormat } from "../generated/ExportFormat";
import type { ExportSource } from "../generated/ExportSource";
import type { ImportContextData } from "../generated/ImportContextData";
import type { LoadWarning } from "../generated/LoadWarning";
import { decodeEffects, encodeEffects, frameRecords, splitRecords, type PersistEffect } from "../effects";
import type { Response } from "../generated/Response";
import type { NotesStore, StoredDoc } from "../store";
import { t } from "../i18n";

/** `invoke` of `@tauri-apps/api/core` (injectable: the tests pass a fake). */
export type Invoke = (cmd: string, args?: InvokeArgs) => Promise<unknown>;

/** The real `invoke`, loaded on first use (the web build never touches `@tauri-apps/api`). */
export const tauriInvoke: Invoke = async (cmd, args) => (await import("@tauri-apps/api/core")).invoke(cmd, args);

/** `listen` of `@tauri-apps/api/event` (injectable like `Invoke`). */
export type Listen = (event: string, fn: () => void) => Promise<() => void>;

/** The real `listen`, loaded on first use. */
export const tauriListen: Listen = async (event, fn) => (await import("@tauri-apps/api/event")).listen(event, () => fn());

/** Emitted by the shell when OS files wait (`apps/notes/src-tauri/src/launch.rs`). */
export const OPEN_DOCUMENT_EVENT = "rusuite://open-document";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A raw IPC body: `json_len:u32 LE` + `JSON.stringify(args)` + `payload`. */
export function frameArgs(args: object, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const json = enc.encode(JSON.stringify(args));
  const out = new Uint8Array(4 + json.length + payload.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(payload, 4 + json.length);
  return out;
}

/** A byte reply (an `ArrayBuffer`; a plain array from older shells or fakes). */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error("expected bytes from the shell");
}

/** Reads `len:u32` + bytes at `at` → the record and the offset after it. */
function record(b: Uint8Array, at: number): [Uint8Array, number] {
  if (at + 4 > b.length) throw new Error("short reply from the shell");
  const len = new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true);
  if (at + 4 + len > b.length) throw new Error("short reply from the shell");
  return [b.subarray(at + 4, at + 4 + len), at + 4 + len];
}

/** `len:u32` + `a` + `b` (the shell's `load_doc` payload). */
function pair(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + a.length + b.length);
  new DataView(out.buffer).setUint32(0, a.length, true);
  out.set(a, 4);
  out.set(b, 4 + a.length);
  return out;
}

const parse = (s: unknown) => JSON.parse(s as string) as Response;

/** The native converters (`notes_core::plan::convert`; the web loads them as a second wasm module). */
export class TauriConverter extends LazyConverter {
  constructor(private readonly invoke: Invoke) {
    super(() => Promise.reject(new Error("the desktop converts natively")));
    this.loaded = true;
  }
  /** Native conversions run to the end (no Cancel). */
  override get cancellable(): boolean {
    return false;
  }
  override cancel(): void {}
  private async call(cmd: string, args: InvokeArgs): Promise<Uint8Array> {
    try {
      return toBytes(await this.invoke(cmd, args));
    } catch (e) {
      rethrow(e);
    }
  }
  override importFile(request: ImportFileRequest, bytes: Uint8Array): Promise<Uint8Array> {
    return this.call("convert_import", frameArgs({ request: JSON.stringify(request) }, bytes));
  }
  override exportFile(format: ExportFormat, source: ExportSource, blobs: Uint8Array): Promise<Uint8Array> {
    return this.call("convert_export", frameArgs({ request: JSON.stringify({ format, source }) }, blobs));
  }
  override pasteHtml(html: string, context?: ImportContextData): Promise<Uint8Array> {
    return this.call("convert_paste_html", { request: JSON.stringify({ html, ...(context ? { context } : {}) }) });
  }
}

/** The `dialog` argument of the shell's native dialogs (localized title). */
const dialog = (title: string, filterName?: string) => ({ dialog: { title, ...(filterName ? { filterName } : {}) } });

export class TauriNotesBackend implements NotesBackend {
  readonly kind = "tauri" as const;
  readonly converter: LazyConverter;
  /** Desktop: printing is the webview's print dialog. Export PDF goes straight to a file where the shell renders
   *  PDFs itself (Linux, as Calc/Write/Show: `export_pdf`); elsewhere it is the print dialog's "Save as PDF". */
  readonly capabilities: BackendCapabilities = { print: true, pdf: shellRendersPdf(), saveAs: true, share: false };

  /** Desktop (P11-D1): the files the OS handed the shell (`take_launch_files`, the `open-document` event). */
  readonly launchFiles: LaunchFiles;

  constructor(
    private readonly invoke: Invoke = tauriInvoke,
    listen: Listen = tauriListen,
  ) {
    this.converter = new TauriConverter(invoke);
    this.launchFiles = {
      take: async () => {
        const [head, ...bytes] = splitRecords(await this.raw("take_launch_files", {}));
        const r = JSON.parse(dec.decode(head)) as { files: string[]; unsupported: string[]; failed: string[] };
        return { files: r.files.map((name, i) => ({ name, bytes: bytes[i] ?? new Uint8Array() })), unsupported: r.unsupported, failed: r.failed };
      },
      subscribe(fn) {
        let stopped = false;
        let unlisten: (() => void) | null = null;
        void listen(OPEN_DOCUMENT_EVENT, fn)
          .then((u) => (stopped ? u() : (unlisten = u)))
          .catch(() => undefined);
        return () => {
          stopped = true;
          unlisten?.();
        };
      },
    };
  }

  private async raw(cmd: string, args: InvokeArgs): Promise<Uint8Array> {
    try {
      return toBytes(await this.invoke(cmd, args));
    } catch (e) {
      rethrow(e);
    }
  }
  private async call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
    try {
      return (await this.invoke(cmd, args)) as T;
    } catch (e) {
      rethrow(e);
    }
  }

  /** A fresh core (a reloaded window must not see the previous page's open notebooks). */
  reset(): Promise<void> {
    return this.call("notes_reset");
  }
  ping(): Promise<string> {
    return this.call("ping");
  }
  async dispatch(request: NotesRequest): Promise<Response> {
    return parse(await this.call("dispatch", { request: JSON.stringify(request) }));
  }
  async loadDoc(notebook: string, doc: string, snapshot: Uint8Array, log: Uint8Array): Promise<Response> {
    return parse(await this.call("load_doc", frameArgs({ notebook, doc }, pair(snapshot, log))));
  }
  async importUpdates(doc: string, bytes: Uint8Array): Promise<Response> {
    return parse(await this.call("import_updates", frameArgs({ doc }, bytes)));
  }
  rebindDevice(from: string, to: string): Promise<void> {
    return this.call("rebind_device", { from, to });
  }
  importRemote(notebook: string, doc: string, bytes: Uint8Array): Promise<boolean> {
    return this.call("import_remote", frameArgs({ notebook, doc }, bytes));
  }
  exportUpdates(doc: string, vv: Uint8Array): Promise<Uint8Array> {
    return this.raw("export_updates", frameArgs({ doc }, vv));
  }
  async exportUpdateChunks(doc: string, vv: Uint8Array, maxBytes: number): Promise<Uint8Array[]> {
    return splitRecords(await this.raw("export_update_chunks", frameArgs({ doc, maxBytes }, vv)));
  }
  versionVector(doc: string): Promise<Uint8Array> {
    return this.raw("version_vector", { doc });
  }
  async takePersistEffects(): Promise<PersistEffect[]> {
    return decodeEffects(await this.raw("take_persist_effects", {}));
  }
  exportBackup(notebook: string, blobs: readonly Uint8Array[]): Promise<Uint8Array> {
    return this.raw("export_backup", frameArgs({ notebook }, frameRecords(blobs)));
  }
  async importBackup(bytes: Uint8Array): Promise<Response> {
    return parse(await this.call("import_backup", frameArgs({}, bytes)));
  }
  pageGenesis(): Promise<Uint8Array> {
    return this.raw("page_genesis", {});
  }
  blobId(bytes: Uint8Array): Promise<string> {
    return this.call("blob_id", frameArgs({}, bytes));
  }
  putBlob(notebook: string, bytes: Uint8Array): Promise<string> {
    return this.call("put_blob", frameArgs({ notebook }, bytes));
  }
  async applyImport(request: NotesRequest, frame: Uint8Array): Promise<Response> {
    return parse(await this.call("apply_import", frameArgs({ request: JSON.stringify(request) }, frame)));
  }
  async print(_paper?: PdfPaper): Promise<void> {
    try {
      await this.invoke("print_webview");
    } catch {
      window.print();
    }
  }
  /** File › Export PDF… (`capabilities.pdf`): the native save dialog, then the shell's PDF of the print root. */
  exportPdf(suggestedName: string, paper: PdfPaper): Promise<string | null> {
    return this.call("export_pdf", { suggestedName, paper, dialog: { title: t("dialog.exportPdf.title") } });
  }
  /** A native open dialog for backups (`.rnotes`). */
  async openFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
    const filters = [{ name: t("notes.desktop.backupFilter"), extensions: ["rnotes"] }];
    const b = await this.raw("open_file", frameArgs({ ...dialog(t("notes.backup.openDots")), filters }));
    if (b.length === 0) return null;
    const [json, at] = record(b, 0);
    const { name } = JSON.parse(dec.decode(json)) as { name: string };
    return { name, bytes: b.slice(at) };
  }
  /** A native save dialog → whether the file was saved. */
  async saveFile(name: string, bytes: Uint8Array): Promise<boolean> {
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toUpperCase() : undefined;
    const saved = await this.call<string | null>("save_file", frameArgs({ suggestedName: name, ...dialog(t("dialog.saveAs.title"), ext) }, bytes));
    return saved !== null;
  }
  async setTitle(title: string): Promise<void> {
    document.title = title;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    } catch {
      // Not in the shell (tests).
    }
  }
}

/** A notebook folder the shell opened or recorded. */
export interface OpenedFolder {
  id: string;
  name: string;
  path: string;
}

/** An entry of the desktop's recent list (`app_common::session::RecentEntry`). */
export interface RecentFolder {
  name: string;
  path: string;
  opened_at?: number;
}

/** The relay the window was created with (`relay_get`). */
export interface RelayInfo {
  url: string;
  allowHttp: boolean;
  wsUrl: string;
  /** Where invite and page links point (`<relay>/notes/`). */
  webBase: string;
  defaultUrl: string;
}

/** Desktop-only calls: notebook folders, the relay setting, device-key storage, the close handshake. */
export class TauriDesktop {
  constructor(private readonly invoke: Invoke = tauriInvoke) {}
  private async call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
    try {
      return (await this.invoke(cmd, args)) as T;
    } catch (e) {
      rethrow(e);
    }
  }
  /** File › New notebook in folder…: the next new notebook goes into the picked folder → whether one was picked. */
  pickLocation(): Promise<boolean> {
    return this.call("notebook_pick_location", dialog(t("notes.desktop.pickLocation")));
  }
  /** File › Open notebook folder… (`null`: cancelled). */
  openFolder(): Promise<OpenedFolder | null> {
    return this.call("notebook_open_folder", dialog(t("notes.desktop.openFolderTitle")));
  }
  openRecent(path: string): Promise<OpenedFolder> {
    return this.call("notebook_open_recent", { path });
  }
  /** Records an open notebook in the recent list → its folder (`null`: it has none yet). */
  touch(notebook: string, name: string): Promise<string | null> {
    return this.call("notebook_touch", { notebook, name });
  }
  path(notebook: string): Promise<string | null> {
    return this.call("notebook_path", { notebook });
  }
  recent(): Promise<RecentFolder[]> {
    return this.call("recent_list");
  }
  relay(): Promise<RelayInfo> {
    return this.call("relay_get");
  }
  /** Checks and stores a relay (a `CoreError`-free string error when it is refused); it applies after `restart`. */
  async setRelay(url: string, allowHttp: boolean): Promise<RelayInfo> {
    return (await this.invoke("relay_set", { url, allowHttp })) as RelayInfo;
  }
  restart(): Promise<void> {
    return this.call("restart");
  }
  /** Whether the device keys are in a file of the app data directory (no OS keyring). */
  async keysInFile(): Promise<boolean> {
    return (await this.call<{ inFile: boolean }>("device_keys_info")).inFile;
  }
  /** The known notebooks' folders ("Remove local data" offers to delete them). */
  folders(): Promise<string[]> {
    return this.call("store_folders");
  }
  /** Settings › AI changed: the custom endpoint's origin for the window policy → whether a restart applies it. */
  setAiHost(origin: string | null): Promise<boolean> {
    return this.call("ai_host_set", { origin });
  }
  /** Whether the AI key is in a file of the app data directory (no OS keyring). */
  async aiKeyInFile(): Promise<boolean> {
    return (await this.call<{ inFile: boolean }>("ai_key_info")).inFile;
  }
  closeNow(): Promise<void> {
    return this.call("close_now");
  }
  /** Calls `fn` when the window is about to close (the shell waits up to 5 s for `closeNow`). */
  async onCloseRequested(fn: () => void): Promise<void> {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("rusuite://close-requested", fn);
  }
}

/** The meta key of the device keys (`sync/manager.ts`): they go to the OS keyring, not a file. */
const DEVICE_KEYS = "sync:deviceKeys";

/** JSON with bytes as `{"$bytes": base64}` (meta values hold `Uint8Array`s: the sharing book and state). */
export function metaToJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Uint8Array ? { $bytes: bytesToBase64(v) } : v));
}
export function metaFromJson<T>(json: string): T {
  return JSON.parse(json, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "$bytes" && typeof (v as { $bytes: unknown }).$bytes === "string") return base64ToBytes((v as { $bytes: string }).$bytes);
    }
    return v;
  }) as T;
}

/** The notebook folders (docs/notes-format.md §2) and the app's settings, kept by the shell. */
export class TauriNotesStore implements NotesStore {
  private warnings: LoadWarning[] = [];

  constructor(private readonly invoke: Invoke = tauriInvoke) {}

  private async call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
    try {
      return (await this.invoke(cmd, args)) as T;
    } catch (e) {
      if (e instanceof CoreError) throw e;
      rethrow(e);
    }
  }
  private async raw(cmd: string, args?: InvokeArgs): Promise<Uint8Array> {
    return toBytes(await this.call(cmd, args));
  }

  async apply(effects: readonly PersistEffect[]): Promise<void> {
    if (effects.length) await this.call("store_apply", frameArgs({}, encodeEffects(effects)));
  }
  async loadNotebook(notebook: string): Promise<StoredDoc[]> {
    const b = await this.raw("store_load", { notebook });
    let [json, at] = record(b, 0);
    const head = JSON.parse(dec.decode(json)) as { docs: string[]; warnings: LoadWarning[] };
    this.warnings.push(...head.warnings);
    const out: StoredDoc[] = [];
    for (const doc of head.docs) {
      let snapshot: Uint8Array, log: Uint8Array;
      [snapshot, at] = record(b, at);
      [log, at] = record(b, at);
      out.push({ doc, snapshot: snapshot.slice(), log: log.slice(), records: splitRecords(log).length });
    }
    return out;
  }
  /** What loading found and skipped (a torn log tail after a crash), since the last call. */
  takeWarnings(): LoadWarning[] {
    const w = this.warnings;
    this.warnings = [];
    return w;
  }
  async blobs(notebook: string): Promise<Uint8Array[]> {
    return splitRecords(await this.raw("store_blobs", { notebook })).map((r) => r.slice());
  }
  async getBlob(notebook: string, sha: string): Promise<Uint8Array | undefined> {
    const b = await this.raw("store_get_blob", { notebook, sha });
    return b.length ? b : undefined;
  }
  /** Desktop: the notebook leaves the app; its folder stays on disk. */
  deleteNotebook(notebook: string): Promise<void> {
    return this.call("store_forget", { notebook });
  }
  async getMeta<T>(key: string): Promise<T | undefined> {
    if (key === DEVICE_KEYS) {
      const b = await this.raw("device_keys_get");
      return (b.length ? b : undefined) as T | undefined;
    }
    const json = await this.call<string | null>("meta_get", { key });
    return json == null ? undefined : metaFromJson<T>(json);
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    if (key === DEVICE_KEYS) {
      await this.call("device_keys_set", frameArgs({}, value instanceof Uint8Array ? value : new Uint8Array()));
      return;
    }
    await this.call("meta_set", { key, json: value == null ? null : metaToJson(value) });
  }
  /** "Remove local data": the app forgets every folder, its settings and the device keys; the folders stay unless
   *  `deleteFolders` (the user confirmed the listed paths). */
  clearAll(opts?: { deleteFolders?: boolean }): Promise<void> {
    return this.call("store_clear", { deleteFolders: opts?.deleteFolders === true });
  }
}

export { isTauri };
