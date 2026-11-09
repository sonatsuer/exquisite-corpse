/** Method 0: one plain bit per pixel. The fallback that caps the size. */
import type { Decoder, Encoder } from '../arith.js';
import { createBitmap } from '../raster.js';
import type { Bitmap } from '../types.js';

export function encodeRaw(enc: Encoder, b: Bitmap): void {
  for (let i = 0; i < b.data.length; i++) enc.bitP(b.data[i]!, 2048);
}

export function decodeRaw(dec: Decoder, w: number, h: number): Bitmap {
  const b = createBitmap(w, h);
  for (let i = 0; i < b.data.length; i++) b.data[i] = dec.bitP(2048);
  return b;
}
