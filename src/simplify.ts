/**
 * Turns raw pointer samples into the points that get stored: round to whole
 * pixels, keep inside the range the stroke codec accepts, drop repeats.
 * Nothing else is removed, so the stored stroke draws exactly the pixels that
 * were shown while drawing. (Dropping points that change no pixel was tried:
 * it removes ~27% of points but makes links slightly longer, because the step
 * coder predicts best from evenly spaced points.)
 */
import type { Point } from './types.js';

/** Stroke points may lie this far outside the half (they are clipped when drawn). */
export const COORD_MARGIN = 32;

export function clampPoint(p: Point, w: number, h: number): Point {
  return [
    Math.min(w - 1 + COORD_MARGIN, Math.max(-COORD_MARGIN, p[0])),
    Math.min(h - 1 + COORD_MARGIN, Math.max(-COORD_MARGIN, p[1])),
  ];
}

/** Raw pointer samples (half coordinates) -> stored stroke points. This is also the path drawn live. */
export function quantize(pts: readonly Point[], w: number, h: number): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const [x, y] = clampPoint([Math.round(p[0]) + 0, Math.round(p[1]) + 0], w, h); // + 0 turns -0 into 0
    const last = out[out.length - 1];
    if (!last || last[0] !== x || last[1] !== y) out.push([x, y]);
  }
  return out;
}
