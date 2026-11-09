import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BitModel, Decoder, decodeSigned, Encoder, encodeSigned, SignedModel } from '../src/arith.js';
import { rng } from './fixtures.js';

test('adaptive bits round-trip, skewed and balanced', () => {
  for (const skew of [0.001, 0.05, 0.5, 0.97]) {
    const r = rng(42);
    const bits = Array.from({ length: 20000 }, () => (r() < skew ? 1 : 0));
    const enc = new Encoder();
    const m = new BitModel(4);
    bits.forEach((b, i) => enc.bit(m, i & 3, b));
    const buf = enc.finish();
    const dec = new Decoder(buf, 0, buf.length);
    const m2 = new BitModel(4);
    assert.deepEqual(bits.map((_, i) => dec.bit(m2, i & 3)), bits);
  }
});

test('raw bits and signed numbers round-trip', () => {
  const r = rng(7);
  const values = Array.from({ length: 3000 }, () => Math.round((r() - 0.5) * 2 ** Math.floor(r() * 20)) || 0);
  const enc = new Encoder();
  const m = new SignedModel(3);
  values.forEach((v, i) => {
    enc.raw(i & 31, 5);
    encodeSigned(enc, m, i % 3, v);
  });
  const buf = enc.finish();
  const dec = new Decoder(buf, 0, buf.length);
  const m2 = new SignedModel(3);
  values.forEach((v, i) => {
    assert.equal(dec.raw(5), i & 31);
    assert.equal(decodeSigned(dec, m2, i % 3), v);
  });
});

test('predictable data compresses', () => {
  const enc = new Encoder();
  const m = new BitModel(1);
  for (let i = 0; i < 24576; i++) enc.bit(m, 0, 0);
  assert.ok(enc.finish().length < 40);
});
