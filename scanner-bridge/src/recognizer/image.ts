import sharp, { type Sharp } from "sharp";
import type { GrayImage, RgbImage, RotatedRect } from "./types.js";

// Pixel plumbing shared by the card finder, the fingerprinting and the
// pixel-level check. sharp (libvips) does decoding, resizing and encoding;
// the one transform it can't do the way we need — mapping an arbitrary
// rotated rectangle onto an upright card-sized image — is a small bilinear
// warp written out below.

export type ImageInput = Buffer | string;

/** sharp instance for a scan or reference image, auto-rotated by EXIF and tolerant of odd scanner files. */
export function openImage(input: ImageInput): Sharp {
  return sharp(input, { failOn: "none", limitInputPixels: 400_000_000 }).rotate();
}

export interface ImageInfo {
  width: number;
  height: number;
  /** Dots per inch from the file's own metadata, when the scanner wrote it. */
  density: number | null;
}

export async function imageInfo(input: ImageInput): Promise<ImageInfo> {
  const meta = await sharp(input, { failOn: "none", limitInputPixels: 400_000_000 }).metadata();
  const rotated = meta.orientation !== undefined && meta.orientation >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  const density = meta.density && meta.density >= 50 && meta.density <= 2400 ? meta.density : null;
  return { width, height, density };
}

async function toRgb(pipeline: Sharp): Promise<RgbImage> {
  const { data, info } = await pipeline
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) {
    // Grayscale scans come back with one channel; expand to RGB.
    const rgb = new Uint8Array(info.width * info.height * 3);
    for (let i = 0, j = 0; i < info.width * info.height; i++, j += info.channels) {
      const v = data[j];
      rgb[i * 3] = v;
      rgb[i * 3 + 1] = v;
      rgb[i * 3 + 2] = v;
    }
    return { width: info.width, height: info.height, data: rgb };
  }
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** Decodes the whole image, shrunk to fit inside maxSide × maxSide (never enlarged). */
export async function decodeFit(input: ImageInput, maxSide: number): Promise<RgbImage> {
  return toRgb(openImage(input).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }));
}

/** Decodes one axis-aligned region at the given scale (region in original pixels). */
export async function decodeRegion(
  input: ImageInput,
  region: { left: number; top: number; width: number; height: number },
  scale: number,
): Promise<RgbImage> {
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));
  return toRgb(openImage(input).extract(region).resize(width, height, { fit: "fill" }));
}

/** Resizes an RGB image to exactly width × height. */
export async function resizeRgb(img: RgbImage, width: number, height: number): Promise<RgbImage> {
  if (img.width === width && img.height === height) return img;
  return toRgb(
    sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
      raw: { width: img.width, height: img.height, channels: 3 },
    }).resize(width, height, { fit: "fill", kernel: "cubic" }),
  );
}

/** Decodes any image straight to grayscale at exactly width × height. */
export async function decodeGray(input: ImageInput, width: number, height: number): Promise<GrayImage> {
  const { data, info } = await openImage(input)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

export async function encodeJpeg(img: RgbImage, quality = 90): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

/** ITU-R BT.601 luma. */
export function toGray(img: RgbImage): GrayImage {
  const out = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; i < out.length; i++, j += 3) {
    out[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114 + 500) / 1000;
  }
  return { width: img.width, height: img.height, data: out };
}

/** Area-average downscale by an integer factor (used for coarse-to-fine alignment). */
export function shrinkGray(img: GrayImage, factor: number): GrayImage {
  const width = Math.floor(img.width / factor);
  const height = Math.floor(img.height / factor);
  const out = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        let idx = (y * factor + dy) * img.width + x * factor;
        for (let dx = 0; dx < factor; dx++) sum += img.data[idx++];
      }
      out[y * width + x] = (sum / area + 0.5) | 0;
    }
  }
  return { width, height, data: out };
}

/** Halves an RGB image (2×2 box average) — a fast detection-resolution copy. */
export function halveRgb(img: RgbImage): RgbImage {
  const width = Math.floor(img.width / 2);
  const height = Math.floor(img.height / 2);
  const out = new Uint8Array(width * height * 3);
  const stride = img.width * 3;
  const d = img.data;
  for (let y = 0; y < height; y++) {
    const r0 = y * 2 * stride;
    const r1 = r0 + stride;
    for (let x = 0; x < width; x++) {
      const i = x * 6;
      const o = (y * width + x) * 3;
      out[o] = (d[r0 + i] + d[r0 + i + 3] + d[r1 + i] + d[r1 + i + 3] + 2) >> 2;
      out[o + 1] = (d[r0 + i + 1] + d[r0 + i + 4] + d[r1 + i + 1] + d[r1 + i + 4] + 2) >> 2;
      out[o + 2] = (d[r0 + i + 2] + d[r0 + i + 5] + d[r1 + i + 2] + d[r1 + i + 5] + 2) >> 2;
    }
  }
  return { width, height, data: out };
}

export function rotate180Rgb(img: RgbImage): RgbImage {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = i * 3;
    const t = (n - 1 - i) * 3;
    out[t] = img.data[s];
    out[t + 1] = img.data[s + 1];
    out[t + 2] = img.data[s + 2];
  }
  return { width: img.width, height: img.height, data: out };
}

export function rotate180Gray(img: GrayImage): GrayImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0, n = img.data.length; i < n; i++) out[n - 1 - i] = img.data[i];
  return { width: img.width, height: img.height, data: out };
}

/**
 * Samples `rect` (in src's pixel coordinates) into an upright outW × outH
 * image: the rectangle's own x-axis becomes the output's x-axis. Pixels that
 * fall outside the source are filled with `fill`.
 */
export function warpRect(
  src: RgbImage,
  rect: RotatedRect,
  outW: number,
  outH: number,
  fill: [number, number, number] = [255, 255, 255],
): RgbImage {
  const out = new Uint8Array(outW * outH * 3);
  const ux = Math.cos(rect.angle);
  const uy = Math.sin(rect.angle);
  const vx = -uy;
  const vy = ux;
  const sx = rect.width / outW;
  const sy = rect.height / outH;
  const { width: W, height: H, data } = src;
  let o = 0;
  for (let oy = 0; oy < outH; oy++) {
    const fy = (oy + 0.5) * sy - rect.height / 2;
    const baseX = rect.cx + fy * vx;
    const baseY = rect.cy + fy * vy;
    for (let ox = 0; ox < outW; ox++, o += 3) {
      const fx = (ox + 0.5) * sx - rect.width / 2;
      // Pixel centers sit at +0.5 in source coordinates.
      const px = baseX + fx * ux - 0.5;
      const py = baseY + fx * uy - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) {
        if (x0 >= -1 && y0 >= -1 && x0 < W && y0 < H) {
          // Edge pixel: nearest neighbour, clamped.
          const cx = Math.min(W - 1, Math.max(0, Math.round(px)));
          const cy = Math.min(H - 1, Math.max(0, Math.round(py)));
          const s = (cy * W + cx) * 3;
          out[o] = data[s];
          out[o + 1] = data[s + 1];
          out[o + 2] = data[s + 2];
        } else {
          out[o] = fill[0];
          out[o + 1] = fill[1];
          out[o + 2] = fill[2];
        }
        continue;
      }
      const ax = px - x0;
      const ay = py - y0;
      const i00 = (y0 * W + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + W * 3;
      const i11 = i01 + 3;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      out[o] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11 + 0.5;
      out[o + 1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11 + 0.5;
      out[o + 2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11 + 0.5;
    }
  }
  return { width: outW, height: outH, data: out };
}

/** Copies a horizontal band / rectangle out of an RGB image (clamped to its bounds). */
export function cropRgb(img: RgbImage, left: number, top: number, width: number, height: number): RgbImage {
  const l = Math.max(0, Math.min(img.width - 1, Math.round(left)));
  const t = Math.max(0, Math.min(img.height - 1, Math.round(top)));
  const w = Math.max(1, Math.min(img.width - l, Math.round(width)));
  const h = Math.max(1, Math.min(img.height - t, Math.round(height)));
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const s = ((t + y) * img.width + l) * 3;
    out.set(img.data.subarray(s, s + w * 3), y * w * 3);
  }
  return { width: w, height: h, data: out };
}
