/**
 * Deterministic synthetic drawings for tests, the benchmark and golden vectors.
 * Simulated pointer input: smooth paths with variable speed and slight jitter.
 */
import { HALF_H, HALF_W } from '../src/config.js';
import { redraw } from '../src/raster.js';
import { quantize } from '../src/simplify.js';
import type { HalfContent, Point, Stroke } from '../src/types.js';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface Profile {
  strokes: number;
  sizes: number[]; // indexes into BRUSH_V1
  patches: number; // areas scribbled solid with the biggest pen
  erases: number;
}

export const PROFILES: Record<string, Profile> = {
  light: { strokes: 8, sizes: [0, 1], patches: 0, erases: 0 },
  typical: { strokes: 18, sizes: [0, 1, 2], patches: 2, erases: 0 },
  heavy: { strokes: 35, sizes: [0, 1, 2, 3], patches: 5, erases: 0 },
  'typical + erases': { strokes: 18, sizes: [0, 1, 2], patches: 2, erases: 6 },
};

/** Raw (float) pointer samples for each stroke. */
export function rawStrokes(seed: number, p: Profile, w = HALF_W, h = HALF_H): { ink: boolean; size: number; raw: Point[] }[] {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const path = (len: number): Point[] => {
    let x = r() * w;
    let y = r() * h;
    let a = r() * 2 * Math.PI;
    let da = 0;
    let speed = 1 + r() * 3;
    let acc = 0;
    const pts: Point[] = [[x, y]];
    for (let i = 0; i < len; i++) {
      da = da * 0.9 + (r() - 0.5) * 0.06;
      a += da;
      x += Math.cos(a);
      y += Math.sin(a);
      if (x < 0 || x >= w) {
        a = Math.PI - a;
        x = Math.max(0, Math.min(w - 1, x));
      }
      if (y < 0 || y >= h) {
        a = -a;
        y = Math.max(0, Math.min(h - 1, y));
      }
      speed = Math.max(1, Math.min(4, speed + (r() - 0.5) * 0.5));
      if (++acc >= speed) {
        acc = 0;
        pts.push([x + gauss() * 0.25, y + gauss() * 0.25]);
      }
    }
    return pts;
  };
  const out: { ink: boolean; size: number; raw: Point[] }[] = [];
  for (let s = 0; s < p.strokes; s++) out.push({ ink: true, size: p.sizes[Math.floor(r() * p.sizes.length)]!, raw: path(60 + r() * 160) });
  for (let k = 0; k < p.patches; k++) {
    const cx = 10 + r() * (w - 20);
    const cy = 10 + r() * (h - 20);
    const R = 8 + r() * 10;
    const zig: Point[] = [];
    let dir = 1;
    for (let yy = -R; yy <= R; yy += 5) {
      const hw = Math.sqrt(Math.max(0, R * R - yy * yy));
      zig.push([cx - hw * dir, cy + yy], [cx + hw * dir, cy + yy + 2.5]);
      dir = -dir;
    }
    const dense: Point[] = [zig[0]!];
    for (let i = 1; i < zig.length; i++) {
      const [x0, y0] = zig[i - 1]!;
      const [x1, y1] = zig[i]!;
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
      for (let j = 1; j <= n; j++) dense.push([x0 + ((x1 - x0) * j) / n + gauss() * 0.4, y0 + ((y1 - y0) * j) / n + gauss() * 0.4]);
    }
    out.push({ ink: true, size: 4, raw: dense });
  }
  for (let e = 0; e < p.erases; e++) out.push({ ink: false, size: [2, 3, 4][Math.floor(r() * 3)]!, raw: path(30 + r() * 60) });
  return out;
}

/** A half drawn the way the editor draws it: every pointer sample, rounded to whole pixels. */
export function drawing(seed: number, p: Profile, signature = ''): HalfContent {
  const strokes: Stroke[] = rawStrokes(seed, p).map((s) => ({
    ink: s.ink,
    size: s.size,
    pts: quantize(s.raw, HALF_W, HALF_H),
  }));
  return { bitmap: redraw(HALF_W, HALF_H, strokes), strokes, signature };
}

/** Random noise: the worst case for every method. */
export function noise(seed: number): HalfContent {
  const r = rng(seed);
  const bitmap = redraw(HALF_W, HALF_H, []);
  for (let i = 0; i < bitmap.data.length; i++) bitmap.data[i] = r() < 0.5 ? 1 : 0;
  return { bitmap, strokes: null, signature: '' };
}
