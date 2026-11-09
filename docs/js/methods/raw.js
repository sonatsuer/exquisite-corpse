import { createBitmap } from '../raster.js';
export function encodeRaw(enc, b) {
    for (let i = 0; i < b.data.length; i++)
        enc.bitP(b.data[i], 2048);
}
export function decodeRaw(dec, w, h) {
    const b = createBitmap(w, h);
    for (let i = 0; i < b.data.length; i++)
        b.data[i] = dec.bitP(2048);
    return b;
}
