import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DecodeError } from '../src/codec.js';
import { fromBase16k, fromBase64Url, parseCode, toBase16k, toBase64Url } from '../src/text.js';
import { rng } from './fixtures.js';

const randomBytes = (n: number, seed: number) => {
  const r = rng(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
};

test('base64url round-trips every length', () => {
  for (let n = 0; n <= 300; n++) {
    const b = randomBytes(n, n);
    const s = toBase64Url(b);
    assert.match(s, /^[A-Za-z0-9_-]*$/);
    assert.equal(s.length, Math.ceil((n * 8) / 6));
    assert.deepEqual(fromBase64Url(s), b);
  }
});

test('base16k round-trips every length and uses 14 bits per character', () => {
  for (let n = 0; n <= 300; n++) {
    const b = randomBytes(n, n + 1000);
    const s = toBase16k(b);
    assert.deepEqual(fromBase16k(s), b, `length ${n}`);
    assert.ok(s.length <= Math.ceil((n * 8) / 14) + 1);
    assert.equal(s.normalize('NFC'), s);
    assert.equal(s.normalize('NFKD'), s);
  }
  const big = randomBytes(4000, 9);
  assert.deepEqual(fromBase16k(toBase16k(big)), big);
});

test('parseCode accepts links, fragments, bare codes, percent-encoding and line breaks', () => {
  const b = randomBytes(50, 3);
  const ascii = toBase64Url(b);
  const short = toBase16k(b);
  for (const input of [
    ascii,
    `#${ascii}`,
    `https://example.github.io/half-pic/#${ascii}`,
    `  ${ascii.slice(0, 20)}\n${ascii.slice(20)}  `,
    short,
    `https://example.github.io/half-pic/#${short}`,
    `https://example.github.io/half-pic/#${encodeURIComponent(short)}`,
  ]) {
    assert.deepEqual(parseCode(input), b, input);
  }
});

test('parseCode rejects junk', () => {
  for (const junk of ['hello world!', '#', '', 'abc%zz']) {
    assert.throws(() => parseCode(junk), DecodeError, junk);
  }
});
