/**
 * Method 1: bitmap context model (the JBIG approach). Each pixel is predicted
 * from 10 neighbours that are already known (3 from two rows up, 5 from the
 * row above, 2 to the left); the arithmetic coder turns good predictions into
 * a fraction of a bit. Part of link format v1.
 */
import { BitModel } from '../arith.js';
import { createBitmap } from '../raster.js';
/** Neighbour offsets [dx, dy]; bit i of the context is neighbour i. */
const TEMPLATE = [
    [-1, -2], [0, -2], [1, -2],
    [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
    [-2, 0], [-1, 0],
];
function context(d, w, x, y) {
    let c = 0;
    for (let i = 0; i < TEMPLATE.length; i++) {
        const t = TEMPLATE[i];
        const xx = x + t[0];
        const yy = y + t[1];
        if (xx >= 0 && xx < w && yy >= 0 && d[yy * w + xx])
            c |= 1 << i;
    }
    return c;
}
export function encodeBitmap(enc, b) {
    const m = new BitModel(1 << TEMPLATE.length);
    for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++)
            enc.bit(m, context(b.data, b.w, x, y), b.data[y * b.w + x]);
    }
}
export function decodeBitmap(dec, w, h) {
    const b = createBitmap(w, h);
    const m = new BitModel(1 << TEMPLATE.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++)
            b.data[y * w + x] = dec.bit(m, context(b.data, w, x, y));
    }
    return b;
}
