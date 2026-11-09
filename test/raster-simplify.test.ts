import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bitmapsEqual, BRUSH_V1, columns, createBitmap, drawSegment, drawStroke, hasInk, joinHalves, redraw, seamStrip, stamp } from '../src/raster.js';
import { clampPoint, COORD_MARGIN, quantize } from '../src/simplify.js';
import type { Point } from '../src/types.js';
import { rng } from './fixtures.js';

const ink = (b: { data: Uint8Array }) => b.data.reduce((a, v) => a + v, 0);

test('a 1 px dot is one pixel; brushes are round and clipped at the edges', () => {
  const b = createBitmap(20, 20);
  stamp(b, 5.5, 5.5, 1, 1);
  assert.equal(ink(b), 1);
  assert.equal(b.data[5 * 20 + 5], 1);
  const c = createBitmap(20, 20);
  stamp(c, 0.5, 0.5, 8, 1); // mostly outside
  assert.ok(ink(c) > 0 && ink(c) < 30);
});

test('segments ink both endpoints; the eraser removes ink', () => {
  const b = createBitmap(40, 40);
  drawStroke(b, { ink: true, size: 0, pts: [[2, 3], [30, 17]] });
  assert.equal(b.data[3 * 40 + 2], 1);
  assert.equal(b.data[17 * 40 + 30], 1);
  drawStroke(b, { ink: false, size: 4, pts: [[2, 3], [30, 17]] });
  assert.equal(ink(b), 0);
});

test('strokes far outside the half draw nothing and do not throw', () => {
  const b = redraw(16, 16, [{ ink: true, size: 4, pts: [[-30, -30], [-20, 40]] }]);
  assert.equal(ink(b), 0);
});

test('join, columns and seam strip agree', () => {
  const left = redraw(8, 4, [{ ink: true, size: 0, pts: [[7, 0], [7, 3]] }]);
  const right = redraw(8, 4, [{ ink: true, size: 0, pts: [[0, 1]] }]);
  const full = joinHalves(left, right);
  assert.deepEqual(columns(full, 0, 8).data, left.data);
  assert.deepEqual(columns(full, 8, 8).data, right.data);
  assert.deepEqual(seamStrip(left, 'left', 1).data, Uint8Array.from([1, 1, 1, 1]));
  assert.deepEqual(seamStrip(right, 'right', 1).data, Uint8Array.from([0, 1, 0, 0]));
});

test('hasInk spots a single ink pixel', () => {
  const b = createBitmap(10, 10);
  assert.equal(hasInk(b), false);
  b.data[57] = 1;
  assert.equal(hasInk(b), true);
});

test('stored strokes are whole pixels, inside the margin, without repeats', () => {
  const out = quantize([[1.2, 1.4], [1.4, 1.2], [500, -500], [3.6, 3.4], [-0.2, 0.3]], 128, 192);
  for (const [x, y] of out) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y));
    assert.ok(x >= -COORD_MARGIN && x < 128 + COORD_MARGIN && y >= -COORD_MARGIN && y < 192 + COORD_MARGIN);
  }
  assert.deepEqual(quantize([[1.2, 1.4], [1.4, 1.2], [2, 1]], 128, 192), [[1, 1], [2, 1]]);
  assert.ok(Object.is(out[out.length - 1]![0], 0), 'no negative zero');
});

test('the stored stroke draws exactly the pixels drawn live', () => {
  const r = rng(11);
  for (let run = 0; run < 40; run++) {
    const size = run % BRUSH_V1.length;
    const raw: Point[] = [];
    let x = r() * 128;
    let y = r() * 192;
    for (let i = 0; i < 120; i++) {
      x += (r() - 0.5) * 6;
      y += (r() - 0.5) * 6;
      raw.push([x, y]);
    }
    // What the editor paints while the pen is down.
    const live = createBitmap(128, 192);
    let last: Point | null = null;
    for (const p of raw) {
      const q = clampPoint([Math.round(p[0]), Math.round(p[1])], 128, 192);
      if (!last) stamp(live, q[0] + 0.5, q[1] + 0.5, BRUSH_V1[size]!, 1);
      else if (q[0] !== last[0] || q[1] !== last[1]) drawSegment(live, last[0], last[1], q[0], q[1], BRUSH_V1[size]!, 1);
      last = q;
    }
    const stored = redraw(128, 192, [{ ink: true, size, pts: quantize(raw, 128, 192) }]);
    assert.ok(bitmapsEqual(live, stored), `run ${run}`);
  }
});
