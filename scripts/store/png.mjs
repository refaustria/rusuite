// Minimal PNG helpers for the store assets (P10-M7, no dependencies): decode 8-bit RGB/RGBA PNGs, re-encode them
// as opaque RGB (the stores reject screenshots and icons with an alpha channel) with adaptive row filters.

import zlib from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width, height, colour type and bit depth from a PNG header. */
export function pngInfo(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] };
}

/** Decodes an 8-bit non-interlaced RGB or RGBA PNG to { width, height, channels, data }. */
export function decodePng(buf) {
  const { width, height, bitDepth, colorType } = pngInfo(buf);
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || buf[28] !== 0) throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType})`);
  const ch = colorType === 6 ? 4 : 3;
  const idat = [];
  for (let p = 8; p < buf.length; ) {
    const n = buf.readUInt32BE(p);
    if (buf.toString("latin1", p + 4, p + 8) === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + n));
    p += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= ch ? out[dst + i - ch] : 0;
      const b = y > 0 ? out[dst - stride + i] : 0;
      const c = i >= ch && y > 0 ? out[dst - stride + i - ch] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 255;
    }
  }
  return { width, height, channels: ch, data: out };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes RGB pixels (3 bytes per pixel) as an opaque PNG, choosing the filter per row by the smallest residual sum. */
export function encodeRgb(width, height, rgb) {
  const stride = width * 3;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      const o = cand[f];
      for (let i = 0; i < stride; i++) {
        const x = rgb[row + i];
        const a = i >= 3 ? rgb[row + i - 3] : 0;
        const b = y > 0 ? rgb[row - stride + i] : 0;
        const c = i >= 3 && y > 0 ? rgb[row - stride + i - 3] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const d = (x - pred) & 255;
        o[i] = d;
        sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) (bestSum = sum), (best = f);
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(out, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Flattens a PNG onto `bg` ([r, g, b]) and returns an opaque RGB PNG (no alpha channel). */
export function toOpaquePng(buf, bg = [255, 255, 255]) {
  const { width, height, channels, data } = decodePng(buf);
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const al = channels === 4 ? data[s + 3] / 255 : 1;
    for (let k = 0; k < 3; k++) rgb[j++] = Math.round(data[s + k] * al + bg[k] * (1 - al));
  }
  return encodeRgb(width, height, rgb);
}
