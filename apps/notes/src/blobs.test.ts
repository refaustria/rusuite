import { describe, expect, it, vi } from "vitest";
import { BlobUrls, fitInside, formatSize, MAX_IMAGE_PX, sniffImage } from "./blobs";

describe("blobs", () => {
  it("sniffs image types by signature", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });

  it("fits pictures larger than 4096 px, keeping the aspect", () => {
    expect(fitInside(800, 600)).toEqual({ w: 800, h: 600, scaled: false });
    expect(fitInside(8192, 2048)).toEqual({ w: MAX_IMAGE_PX, h: 1024, scaled: true });
    expect(fitInside(1000, 10000)).toEqual({ w: 410, h: MAX_IMAGE_PX, scaled: true });
  });

  it("formats sizes", () => {
    expect(formatSize(12, "en")).toBe("12 B");
    expect(formatSize(34_000, "en")).toBe("34 KB");
    expect(formatSize(1_250_000, "en")).toBe("1.3 MB");
    expect(formatSize(1_250_000, "de")).toBe("1,3 MB");
  });

  it("reads each blob from storage once and caches its object URL", async () => {
    const read = vi.fn(async (_nb: string, sha: string) => (sha === "a" ? new Uint8Array([1, 2]) : undefined));
    let n = 0;
    const orig = URL.createObjectURL;
    URL.createObjectURL = () => `blob:x/${++n}`;
    const urls = new BlobUrls(read);
    const [u1, u2] = await Promise.all([urls.url("nb", "a"), urls.url("nb", "a")]);
    expect(u1).toBe("blob:x/1");
    expect(u2).toBe(u1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await urls.url("nb", "missing")).toBeNull();
    expect(urls.remember("nb", "b", new Uint8Array([3]))).toBe("blob:x/2");
    expect(urls.cached("nb", "b")).toBe("blob:x/2");
    URL.createObjectURL = orig;
  });
});
