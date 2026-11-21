// Real frames for the frame reader's tests: a PNG (8-bit RGB or RGBA, not interlaced, as a screenshot saves them) as
// RGBA pixels, with no dependency but zlib.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function pngPixels(path: string): { px: Uint8Array; width: number; height: number } {
  const buf = readFileSync(path);
  let width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at), type = buf.toString("latin1", at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6)) throw new Error(`${path}: only 8-bit RGB(A), not interlaced`);
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels;
  const out = new Uint8Array(width * height * 4), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      cur[i] = (line[i] + pred) & 255;
    }
    for (let x = 0; x < width; x++) {
      out.set([cur[x * channels], cur[x * channels + 1], cur[x * channels + 2], channels === 4 ? cur[x * channels + 3] : 255], (y * width + x) * 4);
    }
    prev.set(cur);
  }
  return { px: out, width, height };
}
