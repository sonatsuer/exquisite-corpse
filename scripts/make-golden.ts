/**
 * Writes test/golden.json: frozen v1 links that every future version must
 * still decode to the same picture. Run only when adding new vectors
 * (`npm run golden`); never regenerate existing ones after links are public.
 */
import { writeFileSync } from 'node:fs';
import { encodePayload } from '../src/codec.js';
import { HALF_H, HALF_W } from '../src/config.js';
import { redraw } from '../src/raster.js';
import { toBase16k, toBase64Url } from '../src/text.js';
import type { Payload } from '../src/types.js';
import { drawing, noise, PROFILES } from '../test/fixtures.js';
import { describe } from '../test/golden-util.js';

const typical = drawing(101, PROFILES.typical!);
const cases: Record<string, Payload> = {
  'half, strokes': { kind: 'half', side: 'left', reveal: 12, half: typical },
  'half, strokes, signature': { kind: 'half', side: 'right', reveal: 20, half: drawing(202, PROFILES.light!, 'Zoë 🎨') },
  'half, strokes with eraser': { kind: 'half', side: 'left', reveal: 4, half: drawing(303, PROFILES['typical + erases']!) },
  'half, bitmap': { kind: 'half', side: 'left', reveal: 12, half: { ...drawing(404, PROFILES.heavy!), strokes: null } },
  'half, raw': { kind: 'half', side: 'right', reveal: 32, half: noise(505) },
  'half, empty': { kind: 'half', side: 'left', reveal: 12, half: { bitmap: redraw(HALF_W, HALF_H, []), strokes: [], signature: '' } },
  'chimera, mixed': {
    kind: 'chimera',
    left: { ...typical, signature: 'Ana' },
    right: { ...drawing(606, PROFILES.typical!), strokes: null, signature: 'Bo' },
  },
};

const out = Object.entries(cases).map(([name, p]) => {
  const bytes = encodePayload(p);
  return { name, code: toBase64Url(bytes), short: toBase16k(bytes), expect: describe(p) };
});
writeFileSync('test/golden.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${out.length} golden vectors`);
