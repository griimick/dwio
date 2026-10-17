import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { hostHtml } from "../src/web-assets.ts";

/** Reads a non-interlaced 8-bit RGBA PNG (what a browser canvas writes) into raw pixels. Enough to check transparency. */
function decodePng(png: Buffer): { width: number; height: number; colorType: number; pixel: (x: number, y: number) => [number, number, number, number] } {
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.subarray(pos + 4, pos + 8).toString("ascii");
    const body = png.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") [width, height, bitDepth, colorType, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8]!, body[9]!, body[12]!];
    if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  expect([bitDepth, colorType, interlace]).toEqual([8, 6, 0]); // 8 bit, RGBA, not interlaced
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= 4 ? out[y * stride + i - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4]! : 0;
      const paeth = () => {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      };
      out[y * stride + i] = (x + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth())) & 255;
    }
  }
  return { width, height, colorType, pixel: (px, py) => [out[py * stride + px * 4]!, out[py * stride + px * 4 + 1]!, out[py * stride + px * 4 + 2]!, out[py * stride + px * 4 + 3]!] };
}

const icons = [...hostHtml.matchAll(/<link rel="icon" type="image\/png" sizes="(\d+)x(\d+)" href="data:image\/png;base64,([A-Za-z0-9+/=]+)">/g)].map((m) => ({ size: Number(m[1]), png: Buffer.from(m[3]!, "base64") }));

describe("the editor page favicon", () => {
  test("has a 32x32 and a 64x64 PNG, each matching its declared size", () => {
    expect(icons.map((i) => i.size).sort((a, b) => a - b)).toEqual([32, 64]);
    for (const { size, png } of icons) {
      const d = decodePng(png);
      expect([d.width, d.height]).toEqual([size, size]);
    }
  });
  test("has a transparent background: all four corners and the middle of every edge are fully transparent", () => {
    for (const { png } of icons) {
      const d = decodePng(png);
      const last = d.width - 1;
      const probes: [number, number][] = [[0, 0], [last, 0], [0, last], [last, last], [0, last >> 1], [last, last >> 1], [last >> 1, 0]];
      for (const [x, y] of probes) expect([x, y, d.pixel(x, y)[3]]).toEqual([x, y, 0]);
    }
  });
  test("the picture itself is there: a solid middle, and a good share of opaque pixels", () => {
    for (const { png } of icons) {
      const d = decodePng(png);
      expect(d.pixel(d.width >> 1, d.height >> 1)[3]).toBe(255);
      let opaque = 0;
      for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (d.pixel(x, y)[3] > 128) opaque++;
      expect(opaque / (d.width * d.height)).toBeGreaterThan(0.4);
      expect(opaque / (d.width * d.height)).toBeLessThan(0.95); // not a filled square
    }
  });
  test("stays small: the page is served from memory and shipped inside the program", () => {
    expect(icons.reduce((n, i) => n + i.png.length, 0)).toBeLessThan(16 * 1024);
    expect(hostHtml.length).toBeLessThan(40 * 1024);
  });
});
