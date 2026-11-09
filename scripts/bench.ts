/** Prints link sizes for synthetic drawings: `npm run bench`. */
import { encodePayload, methodSizes } from '../src/codec.js';
import { toBase16k, toBase64Url } from '../src/text.js';
import { drawing, noise, PROFILES } from '../test/fixtures.js';

const N = 10;
const pad = (v: number | string, n = 7) => String(typeof v === 'number' ? Math.round(v) : v).padStart(n);
console.log('Mean over 10 drawings. Bytes of picture data per method; link = characters after "#".');
console.log(['profile'.padEnd(17), 'raw', 'bitmap', 'strokes', '| half b64', 'short', '| chimera b64', 'short'].map((s) => pad(s, 9)).join(''));
for (const [name, p] of Object.entries(PROFILES)) {
  const sum = { raw: 0, bitmap: 0, strokes: 0, hb: 0, hs: 0, cb: 0, cs: 0 };
  for (let i = 1; i <= N; i++) {
    const a = drawing(i * 7919, p);
    const b = drawing(i * 104729 + 1, p);
    const s = methodSizes(a);
    sum.raw += s.raw / N;
    sum.bitmap += s.bitmap / N;
    sum.strokes += (s.strokes ?? NaN) / N;
    const half = encodePayload({ kind: 'half', side: 'left', reveal: 12, half: a });
    const chimera = encodePayload({ kind: 'chimera', left: a, right: b });
    sum.hb += toBase64Url(half).length / N;
    sum.hs += toBase16k(half).length / N;
    sum.cb += toBase64Url(chimera).length / N;
    sum.cs += toBase16k(chimera).length / N;
  }
  console.log([name.padEnd(17), sum.raw, sum.bitmap, sum.strokes, sum.hb, sum.hs, sum.cb, sum.cs].map((v) => pad(v, 9)).join(''));
}
const worst = encodePayload({ kind: 'half', side: 'left', reveal: 12, half: noise(1) });
console.log(`worst case (noise) half: ${toBase64Url(worst).length} / ${toBase16k(worst).length} chars`);
const t0 = performance.now();
const d = drawing(1, PROFILES.heavy!);
for (let i = 0; i < 20; i++) encodePayload({ kind: 'chimera', left: d, right: d });
console.log(`encode time, heavy chimera: ${((performance.now() - t0) / 20).toFixed(1)} ms`);
