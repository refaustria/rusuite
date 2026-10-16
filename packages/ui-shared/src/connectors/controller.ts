// The per-window connections controller (`Backend.connectors`, reached from the UI as `session.connectors`):
// the configured connections, their secrets for this page, the remote file the open document is bound to, and the
// questions the UI renders (password, save conflict) plus error notices.
//
// Saving: the backends hand every `saveFile` to `trySave` first. A document opened from (or saved to) a connection
// is written back there with `If-Match` on a plain Save; a conflict asks Overwrite / Save a copy / Reload theirs.
// Save As to a connection arms `pendingSave` and runs the app's own save flow, whose `saveFile` then lands here.
// Any other save (local Save As, download) unbinds the document. Autosave copies stay local (unchanged).

import type { OpenedFile, SaveOptions, SaveResult } from "../backend";
import { base64ToBytes, bytesToBase64 } from "../base64";
import { t } from "../i18n/locale";
import type { Connection, ConnectorTarget, Entry, FileProvider } from "./provider";
import { ConflictError, ConnectorError, secretOf, targetOf, toConnectorError, withoutSecret } from "./provider";
import { baseName, copyName, hasExtension, joinPath, originOf, parentPath } from "./paths";
import { REMOTE_RECENT_LIMIT, type ConnectionStore, type RemoteRecent, type StoredData } from "./store";

/** What a platform provides: where connections are stored and how a server is reached. */
export interface ConnectorPlatform {
  readonly kind: "web" | "desktop";
  readonly store: ConnectionStore;
  provider(target: ConnectorTarget): FileProvider;
  /** The app's file extensions (`[".xlsx"]`): the browser's filter and the recent list. */
  readonly extensions: readonly string[];
}

/** The remote file a document is bound to. */
export interface RemoteLocation {
  connectionId: string;
  path: string;
  /** Entity tag of the version opened or last saved (`If-Match` of the next Save). */
  etag: string | null;
}

/** A connection as edited in the dialog (with its secret). */
export type ConnectionDraft = Omit<Connection, "id" | "kind"> & { kind?: Connection["kind"] };

export type ConflictChoice = "overwrite" | "copy" | "reload" | "cancel";

export type ConnectorPrompt =
  | { kind: "password"; connection: Connection; error: string | null }
  | { kind: "conflict"; name: string; connection: string };

export interface ConnectorNotice {
  id: number;
  tone: "error" | "info";
  text: string;
  /** A help link (CORS / CSP explanations). */
  help?: string;
}

export interface ConnectorsState {
  loaded: boolean;
  connections: Connection[];
  /** Connections this page cannot reach because of the site's CSP (id → message). */
  blocked: Record<string, string>;
  location: RemoteLocation | null;
  prompt: ConnectorPrompt | null;
  notice: ConnectorNotice | null;
  /** Remote recent files of this app, newest first. */
  recent: RemoteRecent[];
}

/** Hooks of the window's `DocumentSession`. */
export interface ConnectorSessionHooks {
  /** Opens fetched contents without asking (after "Reload theirs"); `loc` becomes the binding. */
  reopen(file: OpenedFile, loc: RemoteLocation): Promise<unknown>;
}

/** Where the UI's help links point (the portal's privacy page explains CORS and the CSP decision). */
export const CONNECTIONS_HELP_URL = "/privacy.html#connections";

let nextNotice = 1;

const newId = (): string => {
  const c = globalThis.crypto;
  const raw = c && typeof c.randomUUID === "function" ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `c-${raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
};

export class Connectors {
  private state: ConnectorsState = { loaded: false, connections: [], blocked: {}, location: null, prompt: null, notice: null, recent: [] };
  private listeners = new Set<() => void>();
  private data: StoredData | null = null;
  private loading: Promise<void> | null = null;
  /** Secrets for this page (never stored unless remembered). */
  private readonly secrets = new Map<string, string>();
  private settlePrompt: ((v: unknown) => void) | null = null;
  private session: ConnectorSessionHooks | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by `DocumentSession.openRemote` while the app opens the fetched bytes. */
  pendingOpen: RemoteLocation | null = null;
  /** Set by `DocumentSession.saveRemote` while the app's Save As flow runs. */
  pendingSave: { connectionId: string; path: string } | null = null;

  constructor(readonly platform: ConnectorPlatform) {}

  // --- store plumbing -------------------------------------------------------

  getState = (): ConnectorsState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(partial: Partial<ConnectorsState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn();
  }

  attachSession(hooks: ConnectorSessionHooks): void {
    this.session = hooks;
  }

  get extensions(): readonly string[] {
    return this.platform.extensions;
  }

  connection(id: string): Connection | undefined {
    return this.state.connections.find((c) => c.id === id);
  }

  /** Reads the stored connections (once; `force` re-reads). Never touches the network. */
  load(force = false): Promise<void> {
    if (this.loading && !force) return this.loading;
    this.loading = this.platform.store
      .load()
      .then((data) => {
        this.data = data;
        this.publish();
      })
      .catch((e) => {
        this.data = { version: 1, connections: [], recent: [] };
        this.set({ loaded: true });
        this.notify("error", this.describe(e));
      });
    return this.loading;
  }

  private async stored(): Promise<StoredData> {
    if (!this.data) await this.load();
    return this.data ?? { version: 1, connections: [], recent: [] };
  }

  private publish(): void {
    const data = this.data;
    if (!data) return;
    const ids = new Set(data.connections.map((c) => c.id));
    this.set({
      loaded: true,
      connections: data.connections,
      recent: data.recent.filter((r) => ids.has(r.connectionId) && hasExtension(r.name, this.extensions)),
    });
  }

  private async persist(data: StoredData): Promise<void> {
    this.data = data;
    this.publish();
    await this.platform.store.save(data);
  }

  // --- connections ------------------------------------------------------------

  /** Adds (`id` absent) or updates a connection; the secret is remembered only when asked to. */
  async saveConnection(draft: ConnectionDraft, id?: string): Promise<Connection> {
    const data = await this.stored();
    const old = id ? data.connections.find((c) => c.id === id) : undefined;
    const conn: Connection = {
      id: old?.id ?? newId(),
      kind: draft.kind ?? "webdav",
      name: draft.name.trim() || originOf(draft.baseUrl).replace(/^https?:\/\//, ""),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
      auth: draft.auth,
      rootPath: draft.rootPath.trim() || "/",
      allowHttp: draft.allowHttp,
      rememberPassword: draft.rememberPassword,
    };
    // An edit with an empty password keeps the known one.
    const secret = secretOf(conn.auth) || (old ? (this.secrets.get(old.id) ?? null) : null);
    if (secret) this.secrets.set(conn.id, secret);
    const connections = old ? data.connections.map((c) => (c.id === conn.id ? withoutSecret(conn) : c)) : [...data.connections, withoutSecret(conn)];
    await this.persist({ ...data, connections });
    if (conn.rememberPassword && secret) {
      try {
        await this.platform.store.setSecret(conn.id, secret);
      } catch (e) {
        this.notify("error", t("conn.err.keyring", { detail: toConnectorError(e).message }));
      }
    } else if (!conn.rememberPassword) {
      await this.platform.store.deleteSecret(conn.id).catch(() => undefined);
    }
    const blocked = { ...this.state.blocked };
    delete blocked[conn.id];
    this.set({ blocked });
    return withoutSecret(conn);
  }

  /** Removes a connection, its secret and its recent entries. */
  async removeConnection(id: string): Promise<void> {
    const data = await this.stored();
    this.secrets.delete(id);
    await this.platform.store.deleteSecret(id).catch(() => undefined);
    await this.persist({
      ...data,
      connections: data.connections.filter((c) => c.id !== id),
      recent: data.recent.filter((r) => r.connectionId !== id),
    });
    if (this.state.location?.connectionId === id) this.bind(null);
  }

  /** "Forget all connections": records, secrets and remote recent files leave this device. */
  async forgetAll(): Promise<void> {
    this.secrets.clear();
    await this.platform.store.clear();
    this.data = { version: 1, connections: [], recent: [] };
    this.set({ connections: [], recent: [], blocked: {}, location: null, loaded: true });
  }

  /** Clears the remote recent files of every app ("Remove local copies"). */
  async clearRecent(): Promise<void> {
    const data = await this.stored();
    if (data.recent.length === 0) return;
    await this.persist({ ...data, recent: [] });
  }

  async rememberRecent(loc: Pick<RemoteLocation, "connectionId" | "path">, name: string, now = Date.now()): Promise<void> {
    const data = await this.stored();
    const rest = data.recent.filter((r) => !(r.connectionId === loc.connectionId && r.path === loc.path));
    await this.persist({ ...data, recent: [{ connectionId: loc.connectionId, path: loc.path, name, openedAt: now }, ...rest].slice(0, REMOTE_RECENT_LIMIT) });
  }

  // --- reaching a server --------------------------------------------------------

  /** Whether a connection needs a secret that this page does not have yet. */
  private needsSecret(c: Connection): boolean {
    return c.auth.kind === "bearer" || c.auth.username !== "";
  }

  private async secretFor(c: Connection): Promise<string | null> {
    const known = this.secrets.get(c.id);
    if (known !== undefined) return known;
    if (c.rememberPassword) {
      const stored = await this.platform.store.getSecret(c.id).catch(() => null);
      if (stored) {
        this.secrets.set(c.id, stored);
        return stored;
      }
    }
    if (!this.needsSecret(c)) return null;
    const answer = await this.askPassword(c, null);
    if (!answer) throw new ConnectorError("cancelled", t("conn.err.cancelled"));
    this.secrets.set(c.id, answer.secret);
    if (answer.remember && !c.rememberPassword) await this.saveConnection({ ...c, auth: withSecret(c, answer.secret), rememberPassword: true }, c.id);
    else if (answer.remember) await this.platform.store.setSecret(c.id, answer.secret).catch(() => undefined);
    return answer.secret;
  }

  /** A provider for a stored connection (asks for the password when needed). */
  async provider(id: string): Promise<FileProvider> {
    const c = this.connection(id) ?? (await this.stored()).connections.find((x) => x.id === id);
    if (!c) throw new ConnectorError("notFound", t("conn.err.gone"));
    if (this.state.blocked[id]) throw new ConnectorError("csp", this.state.blocked[id]!);
    return this.platform.provider(targetOf(c, await this.secretFor(c)));
  }

  /** Runs `fn` against a connection; a rejected password is forgotten, a CSP block remembered. */
  async run<T>(id: string, fn: (p: FileProvider) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.provider(id));
    } catch (raw) {
      const e = toConnectorError(raw);
      if (e.kind === "auth") {
        this.secrets.delete(id);
        const c = this.connection(id);
        if (c?.rememberPassword) await this.platform.store.deleteSecret(id).catch(() => undefined);
      }
      if (e.kind === "csp") this.set({ blocked: { ...this.state.blocked, [id]: this.describe(e) } });
      throw e;
    }
  }

  list(id: string, path: string): Promise<Entry[]> {
    return this.run(id, (p) => p.list(path));
  }

  /** "Test connection": lists the root folder with the draft's settings → the number of entries. */
  async test(draft: ConnectionDraft): Promise<number> {
    let secret = secretOf(draft.auth);
    const existing = this.state.connections.find((c) => c.baseUrl === draft.baseUrl.trim().replace(/\/+$/, "") && c.rootPath === (draft.rootPath || "/"));
    if (!secret && existing) secret = this.secrets.get(existing.id) ?? "";
    const provider = this.platform.provider(targetOf({ ...draft, rootPath: draft.rootPath || "/" }, secret || null));
    return (await provider.list("/")).length;
  }

  /** A free name in `folder`: `name`, else "name (copy)", "name (copy 2)", … */
  async freeName(provider: FileProvider, folder: string, name: string): Promise<string> {
    const taken = new Set((await provider.list(folder)).map((e) => e.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 1; n < 1000; n++) {
      const candidate = copyName(name, n);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return copyName(name, Date.now());
  }

  // --- the document's binding ---------------------------------------------------

  /** Binds the open document to a remote file (or unbinds it). */
  bind(loc: RemoteLocation | null): void {
    const cur = this.state.location;
    if (cur === loc || (cur && loc && cur.connectionId === loc.connectionId && cur.path === loc.path && cur.etag === loc.etag)) return;
    this.set({ location: loc });
  }

  /** `DocumentSession`: the document was replaced (`opening`: by an open request). */
  documentReplaced(opening: boolean): void {
    this.bind(opening ? this.pendingOpen : null);
    this.pendingOpen = null;
  }

  /** The window title with the connection's name: "Budget.xlsx – Nextcloud – Rusuite Calc". */
  decorateTitle(title: string): string {
    const loc = this.state.location;
    const c = loc && this.connection(loc.connectionId);
    if (!c) return title;
    const i = title.lastIndexOf(" – Rusuite");
    return i >= 0 ? `${title.slice(0, i)} – ${c.name}${title.slice(i)}` : `${title} – ${c.name}`;
  }

  /**
   * The backends' `saveFile` hook: writes to the pending Save As target or, for a plain Save of a bound
   * document, back to its file. `undefined` = not a remote save (the backend saves locally, then calls
   * `localSaved`).
   */
  async trySave(_suggestedName: string, bytesBase64: string, options: SaveOptions = {}): Promise<SaveResult | undefined> {
    const target = this.pendingSave;
    if (target) {
      this.pendingSave = null;
      return this.writeRemote({ connectionId: target.connectionId, path: target.path, etag: null }, bytesBase64, false);
    }
    const loc = this.state.location;
    if (loc && !options.saveAs) return this.writeRemote(loc, bytesBase64, true);
    return undefined;
  }

  /** A local save (download, file dialog) succeeded: the document no longer belongs to the remote file. */
  localSaved(): void {
    this.bind(null);
  }

  private async writeRemote(loc: RemoteLocation, bytesBase64: string, conditional: boolean): Promise<SaveResult> {
    const c = this.connection(loc.connectionId);
    if (!c) {
      this.bind(null);
      this.notify("error", t("conn.err.gone"));
      return false;
    }
    const bytes = base64ToBytes(bytesBase64);
    try {
      return await this.run(c.id, async (p) => {
        try {
          const etag = await p.write(loc.path, bytes, conditional && loc.etag ? { ifMatch: loc.etag } : {});
          this.bind({ connectionId: c.id, path: loc.path, etag });
          return { name: baseName(loc.path) };
        } catch (e) {
          if (!(e instanceof ConflictError) || !conditional) throw e;
          const choice = await this.askConflict(baseName(loc.path), c.name);
          if (choice === "overwrite") {
            const etag = await p.write(loc.path, bytes);
            this.bind({ connectionId: c.id, path: loc.path, etag });
            return { name: baseName(loc.path) };
          }
          if (choice === "copy") {
            const folder = parentPath(loc.path);
            const name = await this.freeName(p, folder, copyName(baseName(loc.path)));
            const path = joinPath(folder, name);
            const etag = await p.write(path, bytes, { ifNoneMatch: true });
            this.bind({ connectionId: c.id, path, etag });
            this.notify("info", t("conn.savedCopy", { name, connection: c.name }));
            return { name };
          }
          if (choice === "reload") {
            // After the app's save flow has finished (it holds its own queue).
            setTimeout(() => void this.reload(c.id, loc.path), 0);
          }
          return false;
        }
      });
    } catch (e) {
      const err = toConnectorError(e);
      if (err.kind !== "cancelled") this.notify("error", t("conn.err.save", { name: baseName(loc.path), detail: this.describe(err) }), helpFor(err));
      return false;
    }
  }

  /** "Reload theirs": opens the server's version, discarding the local changes (the user chose it). */
  async reload(id: string, path: string): Promise<void> {
    try {
      const { bytes, etag } = await this.run(id, (p) => p.read(path));
      await this.session?.reopen({ name: baseName(path), bytesBase64: bytesToBase64(bytes) }, { connectionId: id, path, etag });
    } catch (e) {
      this.notify("error", this.describe(e));
    }
  }

  // --- questions --------------------------------------------------------------

  private ask<T>(prompt: ConnectorPrompt, cancelled: T): Promise<T> {
    this.settlePrompt?.(this.state.prompt?.kind === "conflict" ? "cancel" : null);
    this.set({ prompt });
    return new Promise<T>((resolve) => {
      this.settlePrompt = (v) => {
        this.settlePrompt = null;
        this.set({ prompt: null });
        resolve((v ?? cancelled) as T);
      };
    });
  }

  askPassword(connection: Connection, error: string | null): Promise<{ secret: string; remember: boolean } | null> {
    return this.ask({ kind: "password", connection, error }, null);
  }

  askConflict(name: string, connection: string): Promise<ConflictChoice> {
    return this.ask<ConflictChoice>({ kind: "conflict", name, connection }, "cancel");
  }

  /** Answers the open question (the dialogs' buttons); `null` cancels. */
  answer(value: { secret: string; remember: boolean } | ConflictChoice | null): void {
    this.settlePrompt?.(value);
  }

  // --- notices ------------------------------------------------------------------

  notify(tone: ConnectorNotice["tone"], text: string, help?: string): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.set({ notice: { id: nextNotice++, tone, text, ...(help ? { help } : {}) } });
    this.noticeTimer = setTimeout(() => this.dismissNotice(), tone === "error" ? 12_000 : 6_000);
  }

  dismissNotice(): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    if (this.state.notice) this.set({ notice: null });
  }

  /** A localized explanation of a connector failure. */
  describe(e: unknown): string {
    const err = toConnectorError(e);
    const site = typeof location === "undefined" ? "" : location.origin;
    switch (err.kind) {
      case "auth":
        return t("conn.err.auth");
      case "forbidden":
        return t("conn.err.forbidden");
      case "notFound":
        return t("conn.err.notFound");
      case "conflict":
        return t("conn.err.conflict");
      case "insecure":
        return t("conn.err.insecure");
      case "csp":
        return t("conn.err.csp");
      case "cors":
        return t("conn.err.cors", { origin: site, detail: err.message });
      case "network":
        return t("conn.err.network", { detail: err.message });
      case "cancelled":
        return t("conn.err.cancelled");
      case "invalid":
      case "storage":
      case "http":
      default:
        return t("conn.err.other", { detail: err.message });
    }
  }
}

/** The help link of an error, when there is one. */
export function helpFor(e: ConnectorError): string | undefined {
  return e.kind === "cors" || e.kind === "csp" ? CONNECTIONS_HELP_URL : undefined;
}

function withSecret(c: Connection, secret: string): Connection["auth"] {
  return c.auth.kind === "bearer" ? { kind: "bearer", token: secret } : { ...c.auth, password: secret };
}
