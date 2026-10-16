// Test helpers: a WebDAV server simulated on top of a `MemoryProvider` as a `fetch` replacement, so the browser
// transport runs the same contract tests as the fake.

import type { FetchLike } from "./webdav-fetch";
import { MemoryProvider } from "./fake";
import { ConnectorError } from "./provider";
import { decodePercent, encodePath, normalizePath } from "./paths";

export interface DavLog {
  method: string;
  url: string;
  headers: Record<string, string>;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A `fetch` answering WebDAV requests below `basePath` from `fs`. */
export function davFetch(fs: MemoryProvider, basePath = "/dav", log: DavLog[] = []): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    log.push({ method, url, headers });
    if (!u.pathname.startsWith(basePath)) return new Response("", { status: 404 });
    const path = normalizePath(decodePercent(u.pathname.slice(basePath.length)));
    const status = (e: unknown) => {
      const s = e instanceof ConnectorError && e.status ? e.status : e instanceof ConnectorError && e.kind === "notFound" ? 404 : 500;
      return new Response("", { status: s });
    };
    try {
      switch (method) {
        case "PROPFIND": {
          const self = await fs.stat(path);
          const list = headers.depth === "1" && self.kind === "folder" ? [self, ...(await fs.list(path))] : [self];
          const body = list
            .map((e) => {
              const href = basePath + encodePath(e.path) + (e.kind === "folder" && e.path !== "/" ? "/" : e.path === "/" ? "/" : "");
              return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${
                e.kind === "folder" ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:resourcetype/><d:getcontentlength>${e.size}</d:getcontentlength>`
              }<d:getlastmodified>${new Date(e.modified ?? 0).toUTCString()}</d:getlastmodified><d:getetag>${xmlEscape(e.etag ?? "")}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
            })
            .join("");
          return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`, { status: 207 });
        }
        case "GET": {
          const r = await fs.read(path);
          return new Response(r.bytes as BodyInit, { status: 200, headers: r.etag ? { ETag: r.etag } : {} });
        }
        case "PUT": {
          const body = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
          const etag = await fs.write(path, body, { ifMatch: headers["if-match"] ?? null, ifNoneMatch: headers["if-none-match"] === "*" });
          return new Response(null, { status: 201, headers: etag ? { ETag: etag } : {} });
        }
        case "MKCOL":
          await fs.mkdir(path);
          return new Response(null, { status: 201 });
        case "DELETE":
          await fs.delete(path);
          return new Response(null, { status: 204 });
        case "MOVE": {
          const dest = new URL(headers.destination ?? "");
          await fs.rename(path, decodePercent(dest.pathname.slice(basePath.length)), { overwrite: headers.overwrite === "T" });
          return new Response(null, { status: 201 });
        }
        default:
          return new Response("", { status: 405 });
      }
    } catch (e) {
      return status(e);
    }
  };
}
