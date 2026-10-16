// Cloud connectors (P8-36, ADR 0009 amendment): one `FileProvider` interface for every remote store the user
// configures. Generic and opt-in: Rusuite offers no cloud service and registers no provider apps; a connection is
// a server URL plus the user's own credentials, stored only on this device. v1 implements WebDAV (Nextcloud,
// ownCloud, Synology, most self-hosted and many commercial drives) with two transports: `fetch` in the browser
// (`webdav-fetch.ts`) and the desktop shells' Rust client (`tauri-provider.ts` → `app_common::webdav`).
//
// Paths are relative to the connection's root folder: `/`-separated, starting with `/` (`/` is the root).

import type { ConnectorAuth } from "../generated/ConnectorAuth";
import type { ConnectorEntry } from "../generated/ConnectorEntry";
import type { ConnectorErrorKind as WireErrorKind } from "../generated/ConnectorErrorKind";
import type { ConnectorTarget } from "../generated/ConnectorTarget";
import type { EntryKind } from "../generated/EntryKind";

export type { ConnectorAuth, ConnectorEntry, ConnectorTarget, EntryKind };

/** A file or folder of a listing. */
export type Entry = ConnectorEntry;

export interface ReadResult {
  bytes: Uint8Array;
  /** Entity tag of the version read (`null` when the server sends none). */
  etag: string | null;
}

export interface WriteOptions {
  /** Write only if the server's version still has this entity tag (else `ConflictError`). */
  ifMatch?: string | null;
  /** Write only if the file does not exist yet (else `ConflictError`). */
  ifNoneMatch?: boolean;
}

/** A remote store. Every method rejects with a `ConnectorError`. */
export interface FileProvider {
  /** The entries of a folder (the folder itself excluded). */
  list(path: string): Promise<Entry[]>;
  /** One file or folder. */
  stat(path: string): Promise<Entry>;
  read(path: string): Promise<ReadResult>;
  /** Writes a file; resolves with its new entity tag. 409/412 → `ConflictError`. */
  write(path: string, bytes: Uint8Array, options?: WriteOptions): Promise<string | null>;
  mkdir(path: string): Promise<void>;
  /** Deletes a file or a folder with its contents. */
  delete(path: string): Promise<void>;
  /** Renames or moves; refuses an existing target unless `overwrite`. */
  rename(from: string, to: string, options?: { overwrite?: boolean }): Promise<void>;
}

/** Kinds of connection (later: "s3", "oauth-generic"). */
export type ConnectionKind = "webdav";

/** Credentials of a connection as the user entered them. */
export type ConnectionAuth =
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string };

/** A user-configured connection. Stored on this device only, never synced. */
export interface Connection {
  id: string;
  kind: ConnectionKind;
  /** The user's label ("Nextcloud", "Office NAS"). */
  name: string;
  /** Server URL: `https://cloud.example.com/remote.php/dav/files/alice`. */
  baseUrl: string;
  auth: ConnectionAuth;
  /** Folder under `baseUrl` shown as the top (`/` = `baseUrl`). */
  rootPath: string;
  /** Plain `http://` allowed (LAN servers). */
  allowHttp: boolean;
  /** "Remember password on this device": the secret is stored (desktop: OS keyring; web: IndexedDB). */
  rememberPassword: boolean;
}

/** Why a connector call failed; the wire kinds plus the browser-only ones. */
export type ConnectorErrorKind =
  | WireErrorKind
  /** The browser blocked the response: the server does not allow this site's origin (CORS). */
  | "cors"
  /** This site's Content-Security-Policy does not allow connections to other servers. */
  | "csp"
  /** The user cancelled (e.g. the password prompt). */
  | "cancelled";

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** The file changed on the server since it was read (or exists when it must not). */
export class ConflictError extends ConnectorError {
  constructor(message = "the file was changed on the server", status: number | null = null) {
    super("conflict", message, status);
    this.name = "ConflictError";
  }
}

const KINDS: readonly ConnectorErrorKind[] = [
  "conflict", "notFound", "auth", "forbidden", "insecure", "network", "http", "invalid", "storage", "cors", "csp", "cancelled",
];

/** Normalizes anything thrown by a transport (a Tauri command's `{ kind, status, message }` included). */
export function toConnectorError(e: unknown): ConnectorError {
  if (e instanceof ConnectorError) return e;
  if (typeof e === "object" && e !== null && "kind" in e && KINDS.includes((e as { kind: ConnectorErrorKind }).kind)) {
    const w = e as { kind: ConnectorErrorKind; status?: number | null; message?: string };
    const message = w.message ?? w.kind;
    return w.kind === "conflict" ? new ConflictError(message, w.status ?? null) : new ConnectorError(w.kind, message, w.status ?? null);
  }
  return new ConnectorError("network", e instanceof Error ? e.message : String(e));
}

/** The error for an HTTP status (same mapping as `app_common::connector::ConnectorError::from_status`). */
export function errorForStatus(status: number, method: string): ConnectorError {
  const message = `${method} failed: HTTP ${status}`;
  if (status === 409 || status === 412) return new ConflictError(message, status);
  const kind: ConnectorErrorKind =
    status === 401 ? "auth" : status === 403 ? "forbidden" : status === 404 || status === 410 ? "notFound" : "http";
  return new ConnectorError(kind, message, status);
}

/** The transport's view of a connection (`secret`: the password or token, `null` = none). */
export function targetOf(c: Pick<Connection, "baseUrl" | "rootPath" | "allowHttp" | "auth">, secret: string | null): ConnectorTarget {
  const auth: ConnectorAuth =
    c.auth.kind === "bearer"
      ? { kind: "bearer", token: secret ?? "" }
      : c.auth.username === "" && !secret
        ? { kind: "none" }
        : { kind: "basic", username: c.auth.username, password: secret ?? "" };
  return { baseUrl: c.baseUrl, rootPath: c.rootPath, auth, allowHttp: c.allowHttp };
}

/** The secret of a connection's auth. */
export function secretOf(auth: ConnectionAuth): string {
  return auth.kind === "bearer" ? auth.token : auth.password;
}

/** The connection with its secret removed (what is stored when the password is not remembered). */
export function withoutSecret(c: Connection): Connection {
  return { ...c, auth: c.auth.kind === "bearer" ? { kind: "bearer", token: "" } : { ...c.auth, password: "" } };
}
