import zlib from "node:zlib";

/**
 * A very small PNG reader and writer: enough to turn the 512×512 plate picture inside a 3MF into the
 * square thumbnails the U1 file list shows. Dependency-free, so it also works on the build machine.
 */

export type Picture = { width: number; height: number; rgba: Buffer };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Decodes an 8-bit PNG (grey, RGB, palette, grey + alpha or RGBA, not interlaced) into RGBA pixels. */
export function decodePng(buf: Buffer): Picture | null {
  if (!pngSize(buf)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const parts: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "PLTE") palette = Buffer.from(body);
    else if (type === "tRNS") transparency = Buffer.from(body);
    else if (type === "IDAT") parts.push(Buffer.from(body));
    else if (type === "IEND") break;
    pos += length + 12;
  }
  const channels = CHANNELS[colorType];
  if (depth !== 8 || interlace !== 0 || !width || !height || !channels || !parts.length) return null;

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    if (start + 1 + stride > raw.length) return null;
    const line = unfilter(raw[start], raw.subarray(start + 1, start + 1 + stride), previous, channels);
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[o] = line[i];
        rgba[o + 1] = line[i + 1];
        rgba[o + 2] = line[i + 2];
        rgba[o + 3] = line[i + 3];
      } else if (colorType === 2) {
        rgba[o] = line[i];
        rgba[o + 1] = line[i + 1];
        rgba[o + 2] = line[i + 2];
        rgba[o + 3] = 255;
      } else if (colorType === 0) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i];
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = line[i];
        rgba[o + 3] = line[i + 1];
      } else if (palette && i < line.length) {
        const p = line[i] * 3;
        rgba[o] = palette[p] ?? 0;
        rgba[o + 1] = palette[p + 1] ?? 0;
        rgba[o + 2] = palette[p + 2] ?? 0;
        rgba[o + 3] = transparency && line[i] < transparency.length ? transparency[line[i]] : 255;
      }
    }
    previous = line;
  }
  return { width, height, rgba };
}

function unfilter(filter: number, line: Buffer, previous: Buffer, bpp: number) {
  if (filter === 0) return Buffer.from(line);
  const out = Buffer.from(line);
  for (let i = 0; i < out.length; i++) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = previous[i] ?? 0;
    const upperLeft = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
    if (filter === 1) out[i] = (out[i] + left) & 255;
    else if (filter === 2) out[i] = (out[i] + up) & 255;
    else if (filter === 3) out[i] = (out[i] + ((left + up) >> 1)) & 255;
    else if (filter === 4) out[i] = (out[i] + paeth(left, up, upperLeft)) & 255;
  }
  return out;
}

function paeth(left: number, up: number, upperLeft: number) {
  const estimate = left + up - upperLeft;
  const a = Math.abs(estimate - left);
  const b = Math.abs(estimate - up);
  const c = Math.abs(estimate - upperLeft);
  return a <= b && a <= c ? left : b <= c ? up : upperLeft;
}

/** Crops the picture to its centre square and averages it down to `size` × `size`, as the U1 shows it. */
export function squarePicture(src: Picture, size: number): Picture {
  const side = Math.min(src.width, src.height);
  const left = Math.floor((src.width - side) / 2);
  const top = Math.floor((src.height - side) / 2);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const y0 = top + Math.floor((y * side) / size);
    const y1 = top + Math.max(y0 - top + 1, Math.floor(((y + 1) * side) / size));
    for (let x = 0; x < size; x++) {
      const x0 = left + Math.floor((x * side) / size);
      const x1 = left + Math.max(x0 - left + 1, Math.floor(((x + 1) * side) / size));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.rgba[i];
          g += src.rgba[i + 1];
          b += src.rgba[i + 2];
          a += src.rgba[i + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(r / n);
      rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n);
      rgba[o + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, rgba };
}

/** Encodes RGBA pixels as a PNG. */
export function encodePng(src: Picture): Buffer {
  const stride = src.width * 4;
  const raw = Buffer.alloc((stride + 1) * src.height);
  for (let y = 0; y < src.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    src.rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(src.width, 0);
  header.writeUInt32BE(src.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

function chunk(type: string, body: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const name = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([length, name, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A square `size` px PNG thumbnail of any PNG picture; null when the source cannot be read. */
export function thumbnailPng(buf: Buffer, size: number): Buffer | null {
  const picture = decodePng(buf);
  return picture ? encodePng(squarePicture(picture, size)) : null;
}
