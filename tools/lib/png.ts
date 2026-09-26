// Tiny dependency-free PNG encoder (RGBA8) and contact-sheet compositor.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode top-down RGBA pixels as an opaque RGB PNG. */
export function encodePNG(rgba: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = o + 1 + x * 3;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Tile equally sized RGBA frames into a grid. */
export function contactSheet(frames: Uint8Array[], w: number, h: number, cols: number, gap = 6) {
  const rows = Math.ceil(frames.length / cols);
  const W = cols * w + (cols + 1) * gap;
  const H = rows * h + (rows + 1) * gap;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 24;
    out[i + 1] = 24;
    out[i + 2] = 28;
    out[i + 3] = 255;
  }
  frames.forEach((f, i) => {
    const cx = gap + (i % cols) * (w + gap);
    const cy = gap + Math.floor(i / cols) * (h + gap);
    for (let y = 0; y < h; y++) out.set(f.subarray(y * w * 4, (y + 1) * w * 4), ((cy + y) * W + cx) * 4);
  });
  return { data: out, width: W, height: H };
}
