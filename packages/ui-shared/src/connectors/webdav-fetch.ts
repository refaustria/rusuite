// The browser WebDAV transport: `fetch` straight from this page to the server the user configured (ADR 0009
// amendment – no Rusuite server in between, no other host). The server must allow this site's origin (CORS:
// `Access-Control-Allow-Origin`, the WebDAV methods, the `Authorization`, `Depth`, `Destination`, `Overwrite`,
// `If-Match`, `If-None-Match` request headers, and `ETag` exposed). Nextcloud/ownCloud need the origin in their CORS
// configuration. A Content-Security-Policy whose `connect-src` does not list the server blocks the request before
// any traffic; `securitypolicyviolation` events tell that apart from CORS (`csp` vs `cors`).
//
// This is the only module of the web apps that calls `fetch` for documents (scripts/privacy-check.sh allow-list).

import type { ConnectorTarget, Entry, FileProvider, ReadResult, WriteOptions } from "./provider";
import { ConflictError, ConnectorError, errorForStatus } from "./provider";
import { checkBaseUrl, encodePath, normalizePath, originOf } from "./paths";
import { entriesOf, parseMultistatus, PROPFIND_BODY } from "./webdav-xml";

/** `connect-src` violations seen by this page (origin → time), for telling CSP from CORS failures. */
const violations = new Map<string, number>();
let watching = false;

function watchCsp(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("securitypolicyviolation", (e) => {
    if (!/^connect-src/.test(e.effectiveDirective || e.violatedDirective || "")) return;
    violations.set(originOf(e.blockedURI), Date.now());
  });
}

/** Records a CSP violation (tests). */
export function noteCspViolation(origin: string, at = Date.now()): void {
  violations.set(origin, at);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class FetchWebDavProvider implements FileProvider {
  private readonly base: string;
  private readonly prefix: string;
  private readonly origin: string;

  constructor(
    private readonly target: ConnectorTarget,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {
    watchCsp();
    const base = checkBaseUrl(target.baseUrl, target.allowHttp);
    const root = normalizePath(target.rootPath || "/");
    this.base = root === "/" ? base : base + encodePath(root);
    this.origin = originOf(base);
    this.prefix = new URL(this.base + "/").pathname;
  }

  /** The URL of a path (folders with a trailing `/`). */
  url(path: string, folder = false): string {
    const p = normalizePath(path);
    let url = p === "/" ? `${this.base}/` : this.base + encodePath(p);
    if (folder && !url.endsWith("/")) url += "/";
    return url;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const a = this.target.auth;
    const h: Record<string, string> = { ...extra };
    if (a.kind === "basic") h.Authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${a.username}:${a.password}`)))}`;
    else if (a.kind === "bearer") h.Authorization = `Bearer ${a.token}`;
    return h;
  }

  private async send(method: string, url: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Response> {
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(init.headers),
        body: init.body ?? null,
        // Credentials go in the Authorization header only: no cookies, no referrer, no caching, no redirects.
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "manual",
        mode: "cors",
      });
    } catch (e) {
      // CSP and CORS failures both reject with a TypeError; the CSP violation event arrives around the same time.
      await sleep(30);
      const seen = violations.get(this.origin);
      if (seen !== undefined && seen >= started - 1000) {
        throw new ConnectorError("csp", "This site's security policy does not allow connections to other servers");
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new ConnectorError("network", "You are offline");
      }
      const detail = e instanceof Error ? e.message : String(e);
      throw new ConnectorError(
        "cors",
        `${method} ${this.origin} failed (${detail}). The server is unreachable or does not allow requests from ${
          typeof location === "undefined" ? "this site" : location.origin
        } (CORS).`,
      );
    }
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      throw new ConnectorError("insecure", `${method}: the server redirected (only the configured server is contacted)`, res.status || null);
    }
    if (!res.ok) throw errorForStatus(res.status, method);
    return res;
  }

  private async propfind(path: string, depth: "0" | "1", folder: boolean): Promise<Entry[]> {
    const p = normalizePath(path);
    const res = await this.send("PROPFIND", this.url(p, folder), {
      headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
    });
    return entriesOf(parseMultistatus(await res.text()), this.prefix, depth === "1" ? p : null);
  }

  list(path: string): Promise<Entry[]> {
    return this.propfind(path, "1", true);
  }

  async stat(path: string): Promise<Entry> {
    const p = normalizePath(path);
    const [e] = await this.propfind(p, "0", false);
    if (!e) throw new ConnectorError("notFound", `${p} not found`);
    return { ...e, path: p };
  }

  async read(path: string): Promise<ReadResult> {
    const res = await this.send("GET", this.url(path));
    return { bytes: new Uint8Array(await res.arrayBuffer()), etag: res.headers.get("ETag") };
  }

  async write(path: string, bytes: Uint8Array, options: WriteOptions = {}): Promise<string | null> {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (options.ifMatch) headers["If-Match"] = options.ifMatch;
    if (options.ifNoneMatch) headers["If-None-Match"] = "*";
    const res = await this.send("PUT", this.url(path), { headers, body: bytes as BodyInit });
    const tag = res.headers.get("ETag");
    if (tag) return tag;
    try {
      return (await this.stat(path)).etag;
    } catch {
      return null;
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.send("MKCOL", this.url(path, true));
    } catch (e) {
      if (e instanceof ConnectorError && e.status === 405) throw new ConflictError("a file or folder with this name already exists", 405);
      throw e;
    }
  }

  async delete(path: string): Promise<void> {
    const p = normalizePath(path);
    if (p === "/") throw new ConnectorError("invalid", "the root folder cannot be deleted");
    await this.send("DELETE", this.url(p));
  }

  async rename(from: string, to: string, options: { overwrite?: boolean } = {}): Promise<void> {
    await this.send("MOVE", this.url(from), { headers: { Destination: this.url(to), Overwrite: options.overwrite ? "T" : "F" } });
  }
}
