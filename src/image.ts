// Turns a screenshot file into what the model and the duplicate check need.
// Runs on the main thread because createImageBitmap + canvas is fastest here.

export interface Tile { data: Uint8ClampedArray; width: number; height: number; offsetY: number; scale: number }

const MODEL_SIDE = 768;   // Florence-2's input size
const MAX_TILES = 3;      // bounds the cost of very long scrolling screenshots

function draw(src: ImageBitmap, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) {
  const c = new OffscreenCanvas(dw, dh);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  return ctx.getImageData(0, 0, dw, dh);
}

function fit(w: number, h: number, side: number) {
  const s = Math.min(1, side / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), s };
}

/**
 * Split into roughly-square tiles from the top down. A 1179x2556 phone
 * screenshot becomes three 1179x852 strips; anything below the third strip
 * is ignored (the title and most sensitive data sit near the top).
 */
export function tiles(bmp: ImageBitmap): Tile[] {
  const { width: W, height: H } = bmp;
  const count = Math.min(MAX_TILES, Math.max(1, Math.round(H / W)));
  const stripH = H / Math.max(1, Math.round(H / W));
  const out: Tile[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.round(i * stripH);
    const h = Math.round(Math.min(stripH, H - y));
    const f = fit(W, h, MODEL_SIDE);
    const img = draw(bmp, 0, y, W, h, f.w, f.h);
    out.push({ data: img.data, width: f.w, height: f.h, offsetY: y, scale: f.s });
  }
  return out;
}

/** The whole screenshot, small, for the one-line caption. */
export function thumb(bmp: ImageBitmap): Tile {
  const f = fit(bmp.width, bmp.height, MODEL_SIDE);
  const img = draw(bmp, 0, 0, bmp.width, bmp.height, f.w, f.h);
  return { data: img.data, width: f.w, height: f.h, offsetY: 0, scale: f.s };
}

/** 32x32 luminance thumbnail for the duplicate check. */
export function gray32(bmp: ImageBitmap): Uint8Array {
  const { data } = draw(bmp, 0, 0, bmp.width, bmp.height, 32, 32);
  const out = new Uint8Array(32 * 32);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return out;
}
