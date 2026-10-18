// Minimal PNG encoder (stored deflate blocks) for fixture images: a soft gradient, no dependency.

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(b: Uint8Array<ArrayBuffer>): number {
  let a = 1, s = 0;
  for (const x of b) {
    a = (a + x) % 65521;
    s = (s + a) % 65521;
  }
  return ((s << 16) | a) >>> 0;
}
const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
function chunk(type: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] {
  const td = new Uint8Array(4 + data.length);
  td.set(new TextEncoder().encode(type));
  td.set(data, 4);
  return [u32(data.length), td, u32(crc32(td))];
}

export function gradientPng(w: number, h: number, hue = 0): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = (120 + hue * 40 + x * 2) & 255;
      raw[o + 1] = (180 + y) & 255;
      raw[o + 2] = (140 + hue * 20) & 255;
    }
  }
  const blocks: Uint8Array<ArrayBuffer>[] = [new Uint8Array([0x78, 0x01])];
  for (let i = 0; i < raw.length; i += 65535) {
    const part = raw.subarray(i, Math.min(raw.length, i + 65535));
    const last = i + 65535 >= raw.length ? 1 : 0;
    blocks.push(
      new Uint8Array([
        last,
        part.length & 255,
        part.length >>> 8,
        ~part.length & 255,
        (~part.length >>> 8) & 255,
      ]),
      part,
    );
  }
  blocks.push(u32(adler32(raw)));
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 2, 0, 0, 0]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", concat(blocks)),
    ...chunk("IEND", new Uint8Array()),
  ];
  return concat(parts);
}

function concat(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
