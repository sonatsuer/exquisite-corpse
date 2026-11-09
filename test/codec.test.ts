import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseMethod,
  clampSignature,
  DecodeError,
  decodePayload,
  encodePayload,
  METHOD_BITMAP,
  METHOD_RAW,
  METHOD_STROKES,
  methodSizes,
} from '../src/codec.js';
import { HALF_H, HALF_W } from '../src/config.js';
import { bitmapsEqual, redraw } from '../src/raster.js';
import type { HalfContent, Payload } from '../src/types.js';
import { drawing, noise, PROFILES } from './fixtures.js';

const typical = (seed: number, sig = '') => drawing(seed, PROFILES.typical!, sig);

function sameHalf(a: HalfContent, b: HalfContent) {
  assert.ok(bitmapsEqual(a.bitmap, b.bitmap), 'pixels differ');
  assert.equal(a.signature, b.signature);
}

test('half payloads round-trip with every side, reveal width and signature', () => {
  for (const side of ['left', 'right'] as const) {
    for (const reveal of [1, 4, 12, 32]) {
      for (const sig of ['', 'Ana', 'Zoë 🎨 drew this']) {
        const half = typical(reveal * 13 + sig.length, sig);
        const back = decodePayload(encodePayload({ kind: 'half', side, reveal, half }));
        assert.equal(back.kind, 'half');
        if (back.kind !== 'half') return;
        assert.equal(back.side, side);
        assert.equal(back.reveal, reveal);
        sameHalf(back.half, half);
      }
    }
  }
});

test('chimera payloads round-trip, mixing methods', () => {
  const left = drawing(1, PROFILES.light!, 'left artist'); // light drawings use the stroke method
  const right = noise(2);
  const back = decodePayload(encodePayload({ kind: 'chimera', left, right }));
  assert.equal(back.kind, 'chimera');
  if (back.kind !== 'chimera') return;
  sameHalf(back.left, left);
  sameHalf(back.right, right);
  assert.ok(back.left.strokes, 'strokes survive so the half can be passed on in stroke form');
  assert.equal(back.right.strokes, null);
});

test('the encoder picks the smallest method', () => {
  const d = typical(3);
  const s = methodSizes(d);
  assert.equal(chooseMethod(d), METHOD_STROKES);
  assert.ok(s.strokes! < s.bitmap && s.bitmap < s.raw);
  assert.equal(chooseMethod({ ...d, strokes: null }), METHOD_BITMAP);
  assert.equal(chooseMethod(noise(4)), METHOD_RAW);
  const worst = encodePayload({ kind: 'half', side: 'left', reveal: 12, half: noise(4) });
  assert.ok(worst.length <= 3100, `noise payload is ${worst.length} B`);
});

test('strokes that do not match the pixels are not used', () => {
  const d = typical(5);
  const wrong = { ...d, strokes: d.strokes!.slice(1) };
  assert.equal(methodSizes(wrong).strokes, null);
  const back = decodePayload(encodePayload({ kind: 'half', side: 'left', reveal: 12, half: wrong }));
  assert.ok(back.kind === 'half' && bitmapsEqual(back.half.bitmap, d.bitmap));
});

test('an empty half is tiny', () => {
  const empty: HalfContent = { bitmap: redraw(HALF_W, HALF_H, []), strokes: [], signature: '' };
  assert.ok(encodePayload({ kind: 'half', side: 'right', reveal: 12, half: empty }).length <= 6);
});

test('damaged, truncated, empty and foreign data give clear errors', () => {
  const bytes = encodePayload({ kind: 'half', side: 'left', reveal: 12, half: typical(6) });
  const reason = (b: Uint8Array) => {
    try {
      decodePayload(b);
      return 'ok';
    } catch (e) {
      assert.ok(e instanceof DecodeError);
      return e.reason;
    }
  };
  for (let i = 0; i < bytes.length; i += 7) {
    const flipped = bytes.slice();
    flipped[i]! ^= 0x10;
    assert.notEqual(reason(flipped), 'ok', `flip at ${i}`);
  }
  assert.equal(reason(bytes.slice(0, bytes.length - 5)), 'damaged');
  assert.equal(reason(new Uint8Array(0)), 'empty');
  const newer = bytes.slice();
  newer[0] = (2 << 5) | (newer[0]! & 31);
  assert.equal(reason(withCrc(newer)), 'newer');
});

/** Recompute the CRC after editing a payload, to test checks behind it. */
function withCrc(b: Uint8Array): Uint8Array {
  // Same CRC rule as codec.ts.
  let c = 0xffffffff;
  for (let i = 0; i < b.length - 2; i++) {
    c ^= b[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  const crc = ((c ^ 0xffffffff) >>> 0) & 0xffff;
  b[b.length - 2] = crc >> 8;
  b[b.length - 1] = crc & 0xff;
  return b;
}

test('signatures are trimmed to 24 bytes without splitting characters', () => {
  assert.equal(clampSignature('  Ana  '), 'Ana');
  const long = '🎨'.repeat(10); // 4 bytes each
  assert.equal(clampSignature(long), '🎨'.repeat(6));
});

test('wrong half size is rejected', () => {
  const bad: Payload = { kind: 'half', side: 'left', reveal: 12, half: { bitmap: redraw(10, 10, []), strokes: null, signature: '' } };
  assert.throws(() => encodePayload(bad), RangeError);
});
