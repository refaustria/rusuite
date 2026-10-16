// An in-memory `FileProvider` with real WebDAV semantics (entity tags, conflicts, folders): the reference for the
// provider contract tests and the session/UI tests.

import type { Entry, FileProvider, ReadResult, WriteOptions } from "./provider";
import { ConflictError, ConnectorError } from "./provider";
import { baseName, normalizePath, parentPath } from "./paths";

interface Node {
  kind: "file" | "folder";
  bytes: Uint8Array;
  etag: string;
  modified: number;
}

export class MemoryProvider implements FileProvider {
  readonly nodes = new Map<string, Node>([["/", { kind: "folder", bytes: new Uint8Array(), etag: '"0"', modified: 0 }]]);
  private n = 0;
  /** Every call, for assertions (`list /Docs`). */
  readonly calls: string[] = [];
  /** When set, every call rejects with it (offline, auth …). */
  failWith: ConnectorError | null = null;

  constructor(private readonly now: () => number = () => 1_700_000_000_000) {}

  private tag(): string {
    return `"${++this.n}"`;
  }

  private check(op: string, path: string): string {
    this.calls.push(`${op} ${path}`);
    if (this.failWith) throw this.failWith;
    return normalizePath(path);
  }

  private node(p: string): Node {
    const n = this.nodes.get(p);
    if (!n) throw new ConnectorError("notFound", `${p} not found`, 404);
    return n;
  }

  private entry(p: string, n: Node): Entry {
    return { name: baseName(p), path: p, kind: n.kind, size: n.kind === "file" ? n.bytes.length : null, modified: n.modified, etag: n.etag };
  }

  private parentFolder(p: string): void {
    const parent = this.nodes.get(parentPath(p));
    if (!parent || parent.kind !== "folder") throw new ConflictError(`the folder of ${p} does not exist`, 409);
  }

  /** Puts a file directly (test setup); returns its entity tag. */
  put(path: string, bytes: Uint8Array | string): string {
    const p = normalizePath(path);
    let acc = "";
    for (const seg of p.split("/").slice(1, -1)) {
      acc += "/" + seg;
      if (!this.nodes.has(acc)) this.nodes.set(acc, { kind: "folder", bytes: new Uint8Array(), etag: this.tag(), modified: this.now() });
    }
    const etag = this.tag();
    this.nodes.set(p, { kind: "file", bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, etag, modified: this.now() });
    return etag;
  }

  async list(path: string): Promise<Entry[]> {
    const p = this.check("list", path);
    if (this.node(p).kind !== "folder") throw new ConnectorError("invalid", `${p} is not a folder`);
    const out: Entry[] = [];
    for (const [k, n] of this.nodes) if (k !== p && k !== "/" && parentPath(k) === p) out.push(this.entry(k, n));
    return out;
  }

  async stat(path: string): Promise<Entry> {
    const p = this.check("stat", path);
    return this.entry(p, this.node(p));
  }

  async read(path: string): Promise<ReadResult> {
    const p = this.check("read", path);
    const n = this.node(p);
    if (n.kind !== "file") throw new ConnectorError("invalid", `${p} is a folder`);
    return { bytes: n.bytes.slice(), etag: n.etag };
  }

  async write(path: string, bytes: Uint8Array, options: WriteOptions = {}): Promise<string | null> {
    const p = this.check("write", path);
    const old = this.nodes.get(p);
    if (options.ifMatch && old?.etag !== options.ifMatch) throw new ConflictError("the file was changed on the server", 412);
    if (options.ifNoneMatch && old) throw new ConflictError("the file exists", 412);
    if (old?.kind === "folder") throw new ConflictError(`${p} is a folder`, 409);
    this.parentFolder(p);
    const etag = this.tag();
    this.nodes.set(p, { kind: "file", bytes: bytes.slice(), etag, modified: this.now() });
    return etag;
  }

  async mkdir(path: string): Promise<void> {
    const p = this.check("mkdir", path);
    if (this.nodes.has(p)) throw new ConflictError("a file or folder with this name already exists", 405);
    this.parentFolder(p);
    this.nodes.set(p, { kind: "folder", bytes: new Uint8Array(), etag: this.tag(), modified: this.now() });
  }

  async delete(path: string): Promise<void> {
    const p = this.check("delete", path);
    if (p === "/") throw new ConnectorError("invalid", "the root folder cannot be deleted");
    this.node(p);
    for (const k of [...this.nodes.keys()]) if (k === p || k.startsWith(p + "/")) this.nodes.delete(k);
  }

  async rename(from: string, to: string, options: { overwrite?: boolean } = {}): Promise<void> {
    const src = this.check("rename", from);
    const dst = normalizePath(to);
    this.node(src);
    if (this.nodes.has(dst) && !options.overwrite) throw new ConflictError(`${dst} exists`, 412);
    this.parentFolder(dst);
    for (const [k, n] of [...this.nodes]) {
      if (k === src || k.startsWith(src + "/")) {
        this.nodes.delete(k);
        this.nodes.set(dst + k.slice(src.length), n);
      }
    }
  }
}
