// Object URLs of a notebook's blobs for canvas image items (the stored blobs are keyed by notebook and SHA-256; the
// store lists a notebook's bytes, so the ids are recomputed once per notebook and cached for the session).

import { useEffect, useState } from "react";
import type { NotesController } from "../controller";

const urls = new Map<string, string>();
const loading = new Map<string, Promise<void>>();

const key = (notebook: string, blob: string) => `${notebook}\0${blob}`;

/** The image type of `bytes` by its signature (`<img>` needs none for raster formats, SVG needs it). */
export function sniffImage(bytes: Uint8Array): string {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}

async function sha256(bytes: Uint8Array, ctl: NotesController): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer));
    return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  return ctl.backend.blobId(bytes);
}

async function loadNotebook(ctl: NotesController, notebook: string): Promise<void> {
  const all = await ctl.store.blobs(notebook);
  for (const bytes of all) {
    const id = await sha256(bytes, ctl);
    const k = key(notebook, id);
    if (!urls.has(k)) urls.set(k, URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: sniffImage(bytes) })));
  }
}

/** The object URL of a blob of `notebook` (null while loading or when it is not stored). */
export function useBlobUrl(ctl: NotesController, notebook: string | null, blob: string | null): string | null {
  const k = notebook && blob ? key(notebook, blob) : null;
  const [, setN] = useState(0);
  useEffect(() => {
    if (!k || urls.has(k) || !notebook) return;
    let gone = false;
    // A blob written after the first load (a new import) needs another pass.
    const p = loading.get(notebook) ?? loadNotebook(ctl, notebook).finally(() => loading.delete(notebook));
    loading.set(notebook, p);
    void p.then(() => !gone && setN((n) => n + 1));
    return () => {
      gone = true;
    };
  }, [ctl, notebook, k]);
  return k ? (urls.get(k) ?? null) : null;
}
