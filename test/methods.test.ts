import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Decoder, Encoder } from '../src/arith.js';
import { HALF_H, HALF_W } from '../src/config.js';
import { decodeBitmap, encodeBitmap } from '../src/methods/bitmap.js';
import { decodeRaw, encodeRaw } from '../src/methods/raw.js';
import { decodeStrokes, encodeStrokes } from '../src/methods/strokes.js';
import { bitmapsEqual, redraw } from '../src/raster.js';
import { drawing, noise, PROFILES } from './fixtures.js';

const samples = () => [
  ...Object.values(PROFILES).flatMap((p) => [1, 2, 3].map((s) => drawing(s * 31 + p.strokes, p))),
  noise(5),
  { bitmap: redraw(HALF_W, HALF_H, []), strokes: [], signature: '' },
];

function roundTrip<T>(write: (e: Encoder) => void, read: (d: Decoder) => T): T {
  const e = new Encoder();
  write(e);
  const buf = e.finish();
  return read(new Decoder(buf, 0, buf.length));
}

test('raw method round-trips', () => {
  for (const s of samples()) {
    const back = roundTrip((e) => encodeRaw(e, s.bitmap), (d) => decodeRaw(d, HALF_W, HALF_H));
    assert.ok(bitmapsEqual(back, s.bitmap));
  }
});

test('bitmap method round-trips', () => {
  for (const s of samples()) {
    const back = roundTrip((e) => encodeBitmap(e, s.bitmap), (d) => decodeBitmap(d, HALF_W, HALF_H));
    assert.ok(bitmapsEqual(back, s.bitmap));
  }
});

test('stroke method round-trips strokes and pixels', () => {
  for (const s of samples()) {
    if (!s.strokes) continue;
    const back = roundTrip((e) => encodeStrokes(e, s.strokes!, HALF_W, HALF_H), (d) => decodeStrokes(d, HALF_W, HALF_H));
    assert.deepEqual(back, s.strokes.filter((st) => st.pts.length));
    assert.ok(bitmapsEqual(redraw(HALF_W, HALF_H, back), s.bitmap));
  }
});

test('stroke method handles dots, long jumps and points outside the half', () => {
  const strokes = [
    { ink: true, size: 0, pts: [[5, 5]] as [number, number][] },
    { ink: true, size: 4, pts: [[-20, -20], [140, 200], [0, 100]] as [number, number][] },
    { ink: false, size: 2, pts: [[127, 191], [127, 0]] as [number, number][] },
  ];
  const back = roundTrip((e) => encodeStrokes(e, strokes, HALF_W, HALF_H), (d) => decodeStrokes(d, HALF_W, HALF_H));
  assert.deepEqual(back, strokes);
});

test('stroke encoder rejects points it cannot represent', () => {
  const e = new Encoder();
  assert.throws(() => encodeStrokes(e, [{ ink: true, size: 0, pts: [[0.5, 1]] }], HALF_W, HALF_H), RangeError);
  assert.throws(() => encodeStrokes(e, [{ ink: true, size: 0, pts: [[999, 1]] }], HALF_W, HALF_H), RangeError);
  assert.throws(() => encodeStrokes(e, [{ ink: true, size: 9, pts: [[1, 1]] }], HALF_W, HALF_H), RangeError);
});
