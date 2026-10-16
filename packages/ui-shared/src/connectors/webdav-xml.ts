// WebDAV PROPFIND (RFC 4918) request body and multistatus parsing for the browser transport – the same rules as
// `app_common::webdav` on the desktop: properties count only from 2xx `propstat`s, hrefs (absolute paths or full
// URLs, percent-encoded) map to connection-relative paths below the base URL's path.

import type { Entry } from "./provider";
import { ConnectorError } from "./provider";
import { decodePercent, normalizePath } from "./paths";

export const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>';

export interface DavResponse {
  href: string;
  collection: boolean;
  displayName: string | null;
  size: number | null;
  modified: string | null;
  etag: string | null;
}

const children = (el: Element, local: string): Element[] => Array.from(el.children).filter((c) => c.localName === local);
const child = (el: Element, local: string): Element | undefined => children(el, local)[0];
const text = (el: Element | undefined): string | null => {
  const v = el?.textContent?.trim();
  return v ? v : null;
};

/** Parses a `207 Multi-Status` body. */
export function parseMultistatus(xml: string): DavResponse[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName === "parsererror" || doc.getElementsByTagName("parsererror").length > 0) {
    throw new ConnectorError("invalid", "bad PROPFIND reply: not XML");
  }
  const out: DavResponse[] = [];
  for (const res of Array.from(root.getElementsByTagNameNS("*", "response"))) {
    const href = text(child(res, "href"));
    if (!href) continue;
    const r: DavResponse = { href, collection: false, displayName: null, size: null, modified: null, etag: null };
    for (const ps of children(res, "propstat")) {
      const status = text(child(ps, "status")) ?? "HTTP/1.1 200 OK";
      if (!/^\S+\s+2\d\d\b/.test(status)) continue;
      const prop = child(ps, "prop");
      if (!prop) continue;
      const rt = child(prop, "resourcetype");
      if (rt && child(rt, "collection")) r.collection = true;
      r.displayName ??= text(child(prop, "displayname"));
      const len = text(child(prop, "getcontentlength"));
      if (len !== null && r.size === null && /^\d+$/.test(len)) r.size = Number(len);
      r.modified ??= text(child(prop, "getlastmodified"));
      r.etag ??= text(child(prop, "getetag"));
    }
    out.push(r);
  }
  return out;
}

/** The path part of an href (full URLs lose their origin). */
function hrefPath(href: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(.*)$/i.exec(href);
  return m ? m[1] ?? "" : href;
}

/** Maps an href to a connection-relative path; `null` outside `prefix` (the base URL's path + root folder). */
export function hrefToPath(href: string, prefix: string): string | null {
  const path = decodePercent(hrefPath(href));
  const pre = decodePercent(prefix).replace(/\/+$/, "");
  if (!path.startsWith(pre)) return null;
  const rest = path.slice(pre.length);
  if (rest !== "" && !rest.startsWith("/")) return null;
  try {
    return normalizePath(rest);
  } catch {
    return null;
  }
}

/** Responses → entries; the entry at `skip` (the listed folder itself) is left out. */
export function entriesOf(responses: DavResponse[], prefix: string, skip: string | null): Entry[] {
  const out: Entry[] = [];
  for (const r of responses) {
    const path = hrefToPath(r.href, prefix);
    if (path === null || path === skip) continue;
    const last = path.slice(path.lastIndexOf("/") + 1);
    const modified = r.modified ? Date.parse(r.modified) : NaN;
    out.push({
      name: last || (r.displayName ?? ""),
      path,
      kind: r.collection ? "folder" : "file",
      size: r.collection ? null : r.size,
      modified: Number.isFinite(modified) ? modified : null,
      etag: r.etag,
    });
  }
  return out;
}
