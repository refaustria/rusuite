import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { decodePng, pngInfo, toOpaquePng } from "./png.mjs";

// A 3x2 RGBA PNG built by hand: filter 0 rows, one transparent pixel.
function rgbaPng(w, h, px) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  const chunk = (t, d) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(d.length, 0);
    head.write(t, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), d])) >>> 0, 0);
    return Buffer.concat([head, d, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("alpha is flattened onto the background and the result is RGB", () => {
  const px = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255];
  const out = toOpaquePng(rgbaPng(3, 2, px), [200, 100, 50]);
  assert.deepEqual(pngInfo(out), { width: 3, height: 2, bitDepth: 8, colorType: 2 });
  const { channels, data } = decodePng(out);
  assert.equal(channels, 3);
  assert.deepEqual([...data.subarray(0, 9)], [255, 0, 0, 0, 255, 0, 200, 100, 50]);
  assert.deepEqual([...data.subarray(9, 12)], [10, 20, 30]);
});

test("a larger gradient survives the filter search unchanged", () => {
  const w = 40, h = 30, px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.push((x * 6) & 255, (y * 8) & 255, (x * y) & 255, 255);
  const { data } = decodePng(toOpaquePng(rgbaPng(w, h, px)));
  for (let i = 0; i < w * h; i++) assert.deepEqual([...data.subarray(i * 3, i * 3 + 3)], px.slice(i * 4, i * 4 + 3));
});
