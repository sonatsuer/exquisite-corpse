/** Store and find a text payload inside a PNG file (a tEXt chunk). */
import { crc32 } from './crc.js';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function isPng(png: Uint8Array): boolean {
  return png.length >= 8 && SIGNATURE.every((b, i) => png[i] === b);
}

interface Chunk {
  type: string;
  start: number; // offset of the length field
  dataStart: number;
  dataEnd: number;
}

function* chunks(png: Uint8Array): Generator<Chunk> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > png.length) return;
    yield { type, start: pos, dataStart, dataEnd };
    pos = dataEnd + 4;
  }
}

/** Return a copy of `png` with a tEXt chunk `keyword` = `text` inserted before IEND. */
export function addTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array<ArrayBuffer> {
  if (!isPng(png)) throw new Error('not a PNG');
  let iend = -1;
  for (const c of chunks(png)) if (c.type === 'IEND') iend = c.start;
  if (iend < 0) throw new Error('PNG has no IEND chunk');

  const data = latin1(`${keyword}\0${text}`);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(latin1('tEXt'), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk, 4, 8 + data.length));

  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(png.subarray(iend), iend + chunk.length);
  return out;
}

/** The text of the first tEXt chunk named `keyword`, or null. */
export function readTextChunk(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null;
  const prefix = `${keyword}\0`;
  for (const c of chunks(png)) {
    if (c.type !== 'tEXt') continue;
    const s = String.fromCharCode(...png.subarray(c.dataStart, c.dataEnd));
    if (s.startsWith(prefix)) return s.slice(prefix.length);
  }
  return null;
}
