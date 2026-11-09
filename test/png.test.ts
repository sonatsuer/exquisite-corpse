import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { crc32 } from '../src/crc.js';
import { addTextChunk, readTextChunk } from '../src/png.js';

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid 2x2 greyscale PNG. */
function tinyPng(): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.from([0, 255, 0, 0, 0, 255]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a text chunk can be added and read back; the PNG stays well-formed', () => {
  const png = tinyPng();
  assert.equal(readTextChunk(png, 'halfpic'), null);
  const out = addTextChunk(png, 'halfpic', 'IAbc-_123');
  assert.equal(readTextChunk(out, 'halfpic'), 'IAbc-_123');
  assert.equal(readTextChunk(out, 'other'), null);
  // IEND is still last.
  assert.equal(Buffer.from(out.subarray(out.length - 8, out.length - 4)).toString('latin1'), 'IEND');
});

test('non-PNG data is not mistaken for a picture', () => {
  assert.equal(readTextChunk(new TextEncoder().encode('hello'), 'halfpic'), null);
  assert.throws(() => addTextChunk(new Uint8Array(10), 'halfpic', 'x'));
});
