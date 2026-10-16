// A tiny in-memory WebDAV server for the connector tests (P8-36): PROPFIND (depth 0/1), GET, PUT (If-Match /
// If-None-Match), MKCOL, DELETE, MOVE, OPTIONS with CORS for the app's origin and Basic auth. Every request is
// logged so tests can assert who contacted it.

import http from "node:http";

export interface DavRequest {
  method: string;
  path: string;
  origin: string | undefined;
  authorized: boolean;
}

interface Node {
  folder: boolean;
  bytes: Buffer;
  etag: string;
  modified: Date;
}

export const DAV_BASE = "/remote.php/dav/files/alice";

export class WebDavServer {
  readonly nodes = new Map<string, Node>([["/", { folder: true, bytes: Buffer.alloc(0), etag: '"0"', modified: new Date() }]]);
  readonly log: DavRequest[] = [];
  private server: http.Server | null = null;
  private n = 0;

  /**
   * `port` 0 (the default) listens on a free ephemeral port (read back after `start`), so the suite never collides
   * with another local server; a fixed port can still be asked for.
   */
  constructor(
    private readonly requestedPort: number,
    private readonly allowOrigin: string,
    private readonly user = "alice",
    private readonly password = "app-secret",
  ) {}

  /** The port it listens on (after `start`; before it, the requested one). */
  get port(): number {
    const a = this.server?.address();
    return a && typeof a === "object" ? a.port : this.requestedPort;
  }

  /** `http://127.0.0.1:<port>` (after `start`). */
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get url(): string {
    return `${this.origin}${DAV_BASE}`;
  }

  private tag(): string {
    return `"e${++this.n}"`;
  }

  /** Puts a file (creating its folders); returns its entity tag. */
  put(path: string, bytes: Buffer | string): string {
    let acc = "";
    for (const seg of path.split("/").filter(Boolean).slice(0, -1)) {
      acc += "/" + seg;
      if (!this.nodes.has(acc)) this.nodes.set(acc, { folder: true, bytes: Buffer.alloc(0), etag: this.tag(), modified: new Date() });
    }
    const etag = this.tag();
    this.nodes.set(path, { folder: false, bytes: Buffer.from(bytes), etag, modified: new Date() });
    return etag;
  }

  file(path: string): Buffer | undefined {
    const n = this.nodes.get(path);
    return n && !n.folder ? n.bytes : undefined;
  }

  start(): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    return new Promise((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.requestedPort, "127.0.0.1", () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private cors(res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", this.allowOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, PROPFIND, MKCOL, DELETE, MOVE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Depth, Destination, Overwrite, If-Match, If-None-Match, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "ETag");
    res.setHeader("Vary", "Origin");
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    const auth = req.headers.authorization ?? "";
    const authorized = auth === `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`;
    const method = req.method ?? "GET";
    this.log.push({ method, path: decodeURIComponent(url.pathname), origin: req.headers.origin, authorized });
    this.cors(res);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const end = (status: number, headers: Record<string, string> = {}, data?: string | Buffer) => {
      res.writeHead(status, headers);
      res.end(data);
    };
    if (method === "OPTIONS") return end(204);
    if (!authorized) return end(401, { "WWW-Authenticate": 'Basic realm="dav"' });
    if (!url.pathname.startsWith(DAV_BASE)) return end(404);
    const path = "/" + decodeURIComponent(url.pathname.slice(DAV_BASE.length)).split("/").filter(Boolean).join("/");
    const node = this.nodes.get(path);
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    switch (method) {
      case "PROPFIND": {
        if (!node) return end(404);
        const depth = req.headers.depth ?? "1";
        const items: [string, Node][] = [[path, node]];
        if (node.folder && depth !== "0")
          for (const [k, n] of this.nodes) if (k !== path && k !== "/" && (k.slice(0, k.lastIndexOf("/")) || "/") === path) items.push([k, n]);
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
        const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
        const xml = items
          .map(
            ([k, n]) =>
              `<d:response><d:href>${esc(DAV_BASE + enc(k) + (n.folder && k !== "/" ? "/" : k === "/" ? "/" : ""))}</d:href><d:propstat><d:prop>${
                n.folder ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:resourcetype/><d:getcontentlength>${n.bytes.length}</d:getcontentlength>`
              }<d:getlastmodified>${n.modified.toUTCString()}</d:getlastmodified><d:getetag>${esc(n.etag)}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          )
          .join("");
        return end(207, { "Content-Type": "application/xml; charset=utf-8" }, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`);
      }
      case "GET":
        if (!node || node.folder) return end(404);
        return end(200, { ETag: node.etag, "Content-Type": "application/octet-stream" }, node.bytes);
      case "PUT": {
        const ifMatch = req.headers["if-match"];
        if (ifMatch && node?.etag !== ifMatch) return end(412);
        if (req.headers["if-none-match"] === "*" && node) return end(412);
        if (!this.nodes.get(parent)?.folder) return end(409);
        const etag = this.tag();
        this.nodes.set(path, { folder: false, bytes: body, etag, modified: new Date() });
        return end(node ? 204 : 201, { ETag: etag });
      }
      case "MKCOL":
        if (node) return end(405);
        if (!this.nodes.get(parent)?.folder) return end(409);
        this.nodes.set(path, { folder: true, bytes: Buffer.alloc(0), etag: this.tag(), modified: new Date() });
        return end(201);
      case "DELETE":
        if (!node) return end(404);
        for (const k of [...this.nodes.keys()]) if (k === path || k.startsWith(path + "/")) this.nodes.delete(k);
        return end(204);
      case "MOVE": {
        if (!node) return end(404);
        const dest = new URL(String(req.headers.destination ?? ""));
        const to = "/" + decodeURIComponent(dest.pathname.slice(DAV_BASE.length)).split("/").filter(Boolean).join("/");
        if (this.nodes.has(to) && req.headers.overwrite === "F") return end(412);
        for (const [k, n] of [...this.nodes]) {
          if (k === path || k.startsWith(path + "/")) {
            this.nodes.delete(k);
            this.nodes.set(to + k.slice(path.length), n);
          }
        }
        return end(201);
      }
      default:
        return end(405);
    }
  }
}
