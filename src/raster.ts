/**
 * Bitmap drawing. The brush is part of link format v1: links that use the
 * stroke method are redrawn with this code, so its output must never change.
 * It uses only +, -, *, / and integer square roots, which give identical
 * results in every JavaScript engine.
 */
import type { Bitmap, Side, Stroke } from './types.js';

/** Format: brush diameters in pixels, indexed by Stroke.size. */
export const BRUSH_V1: readonly number[] = [1, 2, 3, 5, 8];

export function createBitmap(w: number, h: number): Bitmap {
  return { w, h, data: new Uint8Array(w * h) };
}

export function cloneBitmap(b: Bitmap): Bitmap {
  return { w: b.w, h: b.h, data: b.data.slice() };
}

export function bitmapsEqual(a: Bitmap, b: Bitmap): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Paint a disc of `diameter` px centred at (cx, cy); pixel (x, y) has its centre at (x + .5, y + .5). */
export function stamp(b: Bitmap, cx: number, cy: number, diameter: number, value: number): void {
  const r = diameter / 2;
  const limit = r * r + 0.25;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(b.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(b.h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= limit) b.data[y * b.w + x] = value;
    }
  }
}

/** ceil(2 * length) of the vector (dx, dy), at least 1, in exact integer arithmetic. */
function substeps(dx: number, dy: number): number {
  const m = 4 * (dx * dx + dy * dy);
  if (m === 0) return 1;
  let s = Math.floor(Math.sqrt(m));
  while (s * s > m) s--;
  while ((s + 1) * (s + 1) <= m) s++;
  return s * s === m ? s : s + 1;
}

/** Stamp along the segment from (x0, y0) to (x1, y1), excluding the start point. */
export function drawSegment(
  b: Bitmap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  diameter: number,
  value: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = substeps(dx, dy);
  for (let k = 1; k <= n; k++) stamp(b, x0 + 0.5 + (dx * k) / n, y0 + 0.5 + (dy * k) / n, diameter, value);
}

/** True if any pixel is ink. */
export function hasInk(b: Bitmap): boolean {
  return b.data.includes(1);
}

export function drawStroke(b: Bitmap, s: Stroke): void {
  const d = BRUSH_V1[s.size];
  if (d === undefined) throw new RangeError(`bad brush size ${s.size}`);
  const v = s.ink ? 1 : 0;
  const p = s.pts;
  if (!p.length) return;
  stamp(b, p[0]![0] + 0.5, p[0]![1] + 0.5, d, v);
  for (let i = 1; i < p.length; i++) drawSegment(b, p[i - 1]![0], p[i - 1]![1], p[i]![0], p[i]![1], d, v);
}

export function redraw(w: number, h: number, strokes: readonly Stroke[]): Bitmap {
  const b = createBitmap(w, h);
  for (const s of strokes) drawStroke(b, s);
  return b;
}

/** Put two halves side by side. */
export function joinHalves(left: Bitmap, right: Bitmap): Bitmap {
  const w = left.w + right.w;
  const out = createBitmap(w, left.h);
  for (let y = 0; y < left.h; y++) {
    out.data.set(left.data.subarray(y * left.w, (y + 1) * left.w), y * w);
    out.data.set(right.data.subarray(y * right.w, (y + 1) * right.w), y * w + left.w);
  }
  return out;
}

/** Copy columns [x0, x0 + w) of a bitmap. */
export function columns(src: Bitmap, x0: number, w: number): Bitmap {
  const out = createBitmap(w, src.h);
  for (let y = 0; y < src.h; y++) out.data.set(src.data.subarray(y * src.w + x0, y * src.w + x0 + w), y * w);
  return out;
}

/** The `width` columns of a half that lie next to the fold. */
export function seamStrip(half: Bitmap, side: Side, width: number): Bitmap {
  return columns(half, side === 'left' ? half.w - width : 0, width);
}
