// Connection-relative paths (`/Docs/a.xlsx`) – the same rules as `app_common::connector` in Rust.

import { ConnectorError } from "./provider";

/** `/`-separated, leading `/`, no trailing `/`; empty and `.` segments dropped; `..`, `\` and NUL refused. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." || seg.includes("\0") || seg.includes("\\")) throw new ConnectorError("invalid", `invalid path "${path}"`);
    out.push(seg);
  }
  return "/" + out.join("/");
}

/** A folder and a file name → a path. */
export function joinPath(folder: string, name: string): string {
  if (name === "" || name.includes("/")) throw new ConnectorError("invalid", `invalid file name "${name}"`);
  return normalizePath(`${folder}/${name}`);
}

/** The folder of a path (`/` for top-level entries and the root). */
export function parentPath(path: string): string {
  const p = normalizePath(path);
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

/** The last segment (`""` for the root). */
export function baseName(path: string): string {
  const p = normalizePath(path);
  return p.slice(p.lastIndexOf("/") + 1);
}

/** The folders from the root down to `path`: `/a/b` → `["/", "/a", "/a/b"]`. */
export function ancestors(path: string): string[] {
  const p = normalizePath(path);
  const out = ["/"];
  if (p === "/") return out;
  let acc = "";
  for (const seg of p.slice(1).split("/")) {
    acc += "/" + seg;
    out.push(acc);
  }
  return out;
}

/** Percent-encodes one segment (RFC 3986 unreserved characters stay; UTF-8 bytes otherwise). */
export function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function encodePath(path: string): string {
  return path.split("/").map(encodeSegment).join("/");
}

/** Decodes `%XX` escapes; invalid escapes stay as they are. */
export function decodePercent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

/** `name.ext` → [`name`, `.ext`] (lower-case extension; `""` when none). */
export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  return i <= 0 ? [name, ""] : [name.slice(0, i), name.slice(i).toLowerCase()];
}

/** Whether `name` ends with one of `extensions` (`[".xlsx"]`; empty list = any). */
export function hasExtension(name: string, extensions: readonly string[]): boolean {
  if (extensions.length === 0) return true;
  const [, ext] = splitExt(name);
  return extensions.includes(ext);
}

/** "Budget.xlsx" → "Budget (copy).xlsx", n ≥ 2 → "Budget (copy 2).xlsx". */
export function copyName(name: string, n = 1): string {
  const [base, ext] = splitExt(name);
  const tail = n <= 1 ? "copy" : `copy ${n}`;
  return `${base} (${tail})${name.slice(name.length - ext.length)}`;
}

/** Checks a server URL: `https://` (or `http://` when allowed) with a host; returns it without a trailing `/`. */
export function checkBaseUrl(url: string, allowHttp: boolean): string {
  const u = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new ConnectorError("invalid", `invalid server URL "${u}"`);
  }
  if (parsed.protocol === "http:" && !allowHttp) throw new ConnectorError("insecure", "plain http:// is not allowed for this connection");
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ConnectorError("invalid", `not an http(s) URL: "${u}"`);
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ConnectorError("invalid", `invalid server URL "${u}"`);
  }
  return u.replace(/\/+$/, "");
}

/** `scheme://host[:port]` of a URL. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
