import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodePayload, encodePayload } from '../src/codec.js';
import { parseCode, toBase64Url } from '../src/text.js';
import { describe } from './golden-util.js';

interface Golden {
  name: string;
  code: string;
  short: string;
  expect: ReturnType<typeof describe>;
}

const golden: Golden[] = JSON.parse(readFileSync('test/golden.json', 'utf8'));

test('golden v1 links still decode to the same pictures', () => {
  assert.ok(golden.length >= 7);
  for (const g of golden) {
    assert.deepEqual(describe(decodePayload(parseCode(g.code))), g.expect, g.name);
    assert.deepEqual(describe(decodePayload(parseCode(g.short))), g.expect, `${g.name} (short)`);
  }
});

test('re-encoding a decoded golden link gives the same link', () => {
  for (const g of golden) {
    assert.equal(toBase64Url(encodePayload(decodePayload(parseCode(g.code)))), g.code, g.name);
  }
});
