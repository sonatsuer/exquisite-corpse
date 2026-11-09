/**
 * Link payload format v1.
 *
 *   byte 0   version (3 bits) | kind (1: 0 half, 1 chimera) | side (1: 0 left, 1 right)
 *            | has-signature (1) | reserved (2, must be 0)
 *   stream   one arithmetic-coded stream:
 *              half:    reveal width - 1 (5 bits), then one half record
 *              chimera: left half record, right half record
 *            half record = method (2 bits; 3 = escape for future methods)
 *                          [signature: 5-bit byte length + UTF-8 bytes, if flagged]
 *                          + method data (each method knows where it ends)
 *   2 bytes  CRC-16 (low 16 bits of CRC-32 of everything before), big-endian
 *
 * Version 1 implies halves of HALF_W x HALF_H, a vertical fold and black ink on paper.
 */
import { CorruptDataError, Decoder, Encoder } from './arith.js';
import { HALF_H, HALF_W, MAX_REVEAL, MAX_SIGNATURE_BYTES } from './config.js';
import { crc32 } from './crc.js';
import { decodeBitmap, encodeBitmap } from './methods/bitmap.js';
import { decodeRaw, encodeRaw } from './methods/raw.js';
import { decodeStrokes, encodeStrokes } from './methods/strokes.js';
import { bitmapsEqual, redraw } from './raster.js';
import type { HalfContent, Payload, Side } from './types.js';

export const FORMAT_VERSION = 1;

export const METHOD_RAW = 0;
export const METHOD_BITMAP = 1;
export const METHOD_STROKES = 2;
export type Method = typeof METHOD_RAW | typeof METHOD_BITMAP | typeof METHOD_STROKES;

export type DecodeErrorReason = 'empty' | 'damaged' | 'newer' | 'invalid';

export class DecodeError extends Error {
  constructor(
    readonly reason: DecodeErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** Trim a signature to at most MAX_SIGNATURE_BYTES of UTF-8, never cutting a character. */
export function clampSignature(s: string): string {
  let out = '';
  let bytes = 0;
  for (const ch of s.trim()) {
    const n = utf8.encode(ch).length;
    if (bytes + n > MAX_SIGNATURE_BYTES) break;
    out += ch;
    bytes += n;
  }
  return out;
}

function encodeMethodData(enc: Encoder, method: Method, c: HalfContent): void {
  if (method === METHOD_RAW) encodeRaw(enc, c.bitmap);
  else if (method === METHOD_BITMAP) encodeBitmap(enc, c.bitmap);
  else encodeStrokes(enc, c.strokes!, c.bitmap.w, c.bitmap.h);
}

function strokesUsable(c: HalfContent): boolean {
  return !!c.strokes && bitmapsEqual(redraw(c.bitmap.w, c.bitmap.h, c.strokes), c.bitmap);
}

function sizeWith(method: Method, c: HalfContent): number | null {
  try {
    const enc = new Encoder();
    encodeMethodData(enc, method, c);
    return enc.finish().length;
  } catch (e) {
    if (e instanceof RangeError) return null; // e.g. a stroke the codec cannot represent
    throw e;
  }
}

export interface MethodSizes {
  raw: number;
  bitmap: number;
  strokes: number | null;
}

/** Bytes each method needs for this half's picture (null = method not available). */
export function methodSizes(c: HalfContent): MethodSizes {
  return {
    raw: sizeWith(METHOD_RAW, c)!,
    bitmap: sizeWith(METHOD_BITMAP, c)!,
    strokes: strokesUsable(c) ? sizeWith(METHOD_STROKES, c) : null,
  };
}

/** The smallest method for this half. Ties go to strokes, which keeps the strokes for whoever passes it on. */
export function chooseMethod(c: HalfContent): Method {
  const s = methodSizes(c);
  let best: Method = s.bitmap <= s.raw ? METHOD_BITMAP : METHOD_RAW;
  if (s.strokes !== null && s.strokes <= Math.min(s.raw, s.bitmap)) best = METHOD_STROKES;
  return best;
}

function checkHalf(c: HalfContent): void {
  if (c.bitmap.w !== HALF_W || c.bitmap.h !== HALF_H) {
    throw new RangeError(`half must be ${HALF_W}x${HALF_H}, got ${c.bitmap.w}x${c.bitmap.h}`);
  }
}

export function encodePayload(p: Payload): Uint8Array {
  const halves = p.kind === 'half' ? [p.half] : [p.left, p.right];
  halves.forEach(checkHalf);
  const sigs = halves.map((h) => utf8.encode(clampSignature(h.signature)));
  const hasSig = sigs.some((s) => s.length > 0);
  const byte0 =
    (FORMAT_VERSION << 5) |
    ((p.kind === 'chimera' ? 1 : 0) << 4) |
    ((p.kind === 'half' && p.side === 'right' ? 1 : 0) << 3) |
    ((hasSig ? 1 : 0) << 2);

  const enc = new Encoder();
  if (p.kind === 'half') {
    const reveal = Math.min(MAX_REVEAL, Math.max(1, Math.round(p.reveal)));
    enc.raw(reveal - 1, 5);
  }
  halves.forEach((h, i) => {
    const method = chooseMethod(h);
    enc.raw(method, 2);
    if (hasSig) {
      const sig = sigs[i]!;
      enc.raw(sig.length, 5);
      for (const b of sig) enc.raw(b, 8);
    }
    encodeMethodData(enc, method, h);
  });
  const body = enc.finish();

  const out = new Uint8Array(1 + body.length + 2);
  out[0] = byte0;
  out.set(body, 1);
  const crc = crc32(out, 0, out.length - 2) & 0xffff;
  out[out.length - 2] = crc >> 8;
  out[out.length - 1] = crc & 0xff;
  return out;
}

function readHalf(dec: Decoder, hasSig: boolean): HalfContent {
  const method = dec.raw(2);
  let signature = '';
  if (hasSig) {
    const sig = new Uint8Array(dec.raw(5));
    for (let i = 0; i < sig.length; i++) sig[i] = dec.raw(8);
    signature = utf8Decoder.decode(sig);
  }
  if (method === METHOD_RAW) return { bitmap: decodeRaw(dec, HALF_W, HALF_H), strokes: null, signature };
  if (method === METHOD_BITMAP) return { bitmap: decodeBitmap(dec, HALF_W, HALF_H), strokes: null, signature };
  if (method === METHOD_STROKES) {
    const strokes = decodeStrokes(dec, HALF_W, HALF_H);
    return { bitmap: redraw(HALF_W, HALF_H, strokes), strokes, signature };
  }
  throw new DecodeError('newer', 'This picture was made with a newer version of Exquisite Corpse.');
}

export function decodePayload(bytes: Uint8Array): Payload {
  const n = bytes.length;
  if (n === 0) throw new DecodeError('empty', 'There is no picture in this link.');
  const damaged = () => new DecodeError('damaged', 'This link is damaged or incomplete. Ask for it again, or use the file.');
  if (n < 4) throw damaged();
  const stored = (bytes[n - 2]! << 8) | bytes[n - 1]!;
  if ((crc32(bytes, 0, n - 2) & 0xffff) !== stored) throw damaged();

  const byte0 = bytes[0]!;
  const version = byte0 >> 5;
  if (version > FORMAT_VERSION || (byte0 & 3) !== 0) {
    throw new DecodeError('newer', 'This picture was made with a newer version of Exquisite Corpse.');
  }
  if (version !== FORMAT_VERSION) throw new DecodeError('invalid', 'This is not an Exquisite Corpse link.');
  const chimera = (byte0 >> 4) & 1;
  const sideBit = (byte0 >> 3) & 1;
  const hasSig = ((byte0 >> 2) & 1) === 1;
  if (chimera && sideBit) throw new DecodeError('invalid', 'This is not an Exquisite Corpse link.');

  try {
    const dec = new Decoder(bytes, 1, n - 2);
    if (!chimera) {
      const reveal = dec.raw(5) + 1;
      const side: Side = sideBit ? 'right' : 'left';
      return { kind: 'half', side, reveal, half: readHalf(dec, hasSig) };
    }
    const left = readHalf(dec, hasSig);
    const right = readHalf(dec, hasSig);
    return { kind: 'chimera', left, right };
  } catch (e) {
    if (e instanceof CorruptDataError) throw damaged();
    throw e;
  }
}
