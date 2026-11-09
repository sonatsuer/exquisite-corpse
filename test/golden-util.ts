import { crc32 } from '../src/crc.js';
import type { HalfContent, Payload } from '../src/types.js';

const half = (h: HalfContent) => ({ pixels: crc32(h.bitmap.data).toString(16), ink: h.bitmap.data.reduce((a, v) => a + v, 0), signature: h.signature });

/** What a decoded payload must look like: pixel fingerprints plus metadata. */
export function describe(p: Payload) {
  return p.kind === 'half'
    ? { kind: p.kind, side: p.side, reveal: p.reveal, halves: [half(p.half)] }
    : { kind: p.kind, halves: [half(p.left), half(p.right)] };
}
