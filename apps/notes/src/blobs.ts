// Images and attachments (notes-format §7.1): content-addressed blobs (SHA-256 via the core's `blob_id`), stored
// through the core's Blob persist effect (`putBlob`) and shown from IndexedDB as object URLs. Pictures larger
// than 4096 px are downscaled on insert (the downscaled copy is stored, not the original).

/** The relay's blob limit (P11-N5) – also the limit for inserting a file or picture. */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

/** Longest side of an inserted picture; larger ones are downscaled. */
export const MAX_IMAGE_PX = 4096;

/** CSS px → points (images store their size in points, notes-format §7.1). */
export const PX_TO_PT = 0.75;

/** The MIME type of image bytes by their signature (`null`: not an image the browser shows). */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 && b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return "image/avif";
  return null;
}

/** The size `w × h` fitted into `max × max` (aspect kept; never enlarged). */
export function fitInside(w: number, h: number, max = MAX_IMAGE_PX): { w: number; h: number; scaled: boolean } {
  if (w <= max && h <= max) return { w, h, scaled: false };
  const k = max / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
}

/** `1.2 MB`, `340 KB`, `12 bytes` (decimal units, like the file managers). */
export function formatSize(bytes: number, locale?: string): string {
  const n = (v: number, d: number) => v.toLocaleString(locale, { maximumFractionDigits: d });
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${n(bytes / 1000, 0)} KB`;
  if (bytes < 1_000_000_000) return `${n(bytes / 1_000_000, 1)} MB`;
  return `${n(bytes / 1_000_000_000, 1)} GB`;
}

/** A prepared picture: the bytes to store and its natural size in px. */
export interface PreparedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** It was larger than `MAX_IMAGE_PX` and is stored downscaled. */
  downscaled: boolean;
}

/** Natural size of an image (browser decode); `null` when it cannot be decoded. */
async function decode(bytes: Uint8Array, mime: string): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  } catch {
    return null;
  }
}

/** Reads a picture for insertion: its size and, above `MAX_IMAGE_PX`, a downscaled PNG/JPEG copy. */
export async function prepareImage(bytes: Uint8Array, mime: string): Promise<PreparedImage | null> {
  const bmp = await decode(bytes, mime);
  if (!bmp) return null;
  const fit = fitInside(bmp.width, bmp.height);
  if (!fit.scaled) {
    const out = { bytes, width: bmp.width, height: bmp.height, downscaled: false };
    bmp.close();
    return out;
  }
  const canvas = document.createElement("canvas");
  canvas.width = fit.w;
  canvas.height = fit.h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, fit.w, fit.h);
  bmp.close();
  const type = mime === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: fit.w, height: fit.h, downscaled: true };
}

/** Object URLs of a notebook's blobs, read from storage once and kept for the session. */
export class BlobUrls {
  private urls = new Map<string, string>();
  private pending = new Map<string, Promise<string | null>>();

  constructor(private readonly read: (notebook: string, sha: string) => Promise<Uint8Array | undefined>) {}

  private static key(notebook: string, sha: string): string {
    return `${notebook}\0${sha}`;
  }

  /** Registers bytes just inserted (before they reach storage). */
  remember(notebook: string, sha: string, bytes: Uint8Array, mime?: string): string {
    const k = BlobUrls.key(notebook, sha);
    const have = this.urls.get(k);
    if (have) return have;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime ?? sniffImage(bytes) ?? "application/octet-stream" }));
    this.urls.set(k, url);
    return url;
  }

  /** The cached URL (synchronous), if any. */
  cached(notebook: string, sha: string): string | null {
    return this.urls.get(BlobUrls.key(notebook, sha)) ?? null;
  }

  /** The object URL of a stored blob; `null` when it is not stored (yet). */
  url(notebook: string, sha: string): Promise<string | null> {
    const k = BlobUrls.key(notebook, sha);
    const have = this.urls.get(k);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(k);
    if (!p) {
      p = this.read(notebook, sha).then(
        (bytes) => {
          this.pending.delete(k);
          return bytes ? this.remember(notebook, sha, bytes) : null;
        },
        () => {
          this.pending.delete(k);
          return null;
        },
      );
      this.pending.set(k, p);
    }
    return p;
  }

  /** Revokes every URL (Remove local data). */
  clear(): void {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.pending.clear();
  }
}
