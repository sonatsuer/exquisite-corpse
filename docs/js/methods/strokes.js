/**
 * Method 2: the strokes themselves. The receiver redraws them with brush v1.
 * Each step between points is coded as its difference from the previous step,
 * so lines that keep their direction cost little. Part of link format v1.
 *
 * Per stroke: "more strokes" bit, tool bit, brush size (3-bit tree), start
 * point relative to the previous stroke's end. Per further point: "continue"
 * bit, then the step residual (x, then y).
 */
import { BitModel, CorruptDataError, decodeSigned, encodeSigned, SignedModel } from '../arith.js';
import { BRUSH_V1 } from '../raster.js';
import { COORD_MARGIN } from '../simplify.js';
const MAX_STROKES = 20000;
const inRange = (x, y, w, h) => x >= -COORD_MARGIN && x < w + COORD_MARGIN && y >= -COORD_MARGIN && y < h + COORD_MARGIN;
const MAX_POINTS = 200000;
const START_X = 64;
const START_Y = 65;
class Models {
    more = new BitModel(1);
    tool = new BitModel(1);
    size = new BitModel(16);
    cont = new BitModel(24);
    steps = new SignedModel(66);
}
const contCtx = (i, pdx, pdy) => (Math.min(i, 3) - 1) * 8 + Math.min(Math.abs(pdx) + Math.abs(pdy), 7);
const speed = (pdx, pdy) => Math.min((Math.abs(pdx) + Math.abs(pdy)) >> 1, 3);
const ctxX = (first, pr, pdx, pdy) => (first ? 0 : 16) + Math.min(pr, 3) * 4 + speed(pdx, pdy);
const ctxY = (first, rx, pr, pdx, pdy) => 32 + (first ? 0 : 16) + (rx === 0 ? 0 : 8) + Math.min(pr, 1) * 4 + speed(pdx, pdy);
export function encodeStrokes(enc, strokes, w, h) {
    const m = new Models();
    let ex = w >> 1;
    let ey = h >> 1;
    for (const s of strokes) {
        if (!s.pts.length)
            continue;
        if (!Number.isInteger(s.size) || s.size < 0 || s.size >= BRUSH_V1.length) {
            throw new RangeError(`bad brush size ${s.size}`);
        }
        for (const [x, y] of s.pts) {
            if (!Number.isInteger(x) || !Number.isInteger(y) || !inRange(x, y, w, h))
                throw new RangeError(`bad point ${x},${y}`);
        }
        enc.bit(m.more, 0, 1);
        enc.bit(m.tool, 0, s.ink ? 1 : 0);
        const t = s.ink ? 1 : 0;
        const b2 = (s.size >> 2) & 1;
        const b1 = (s.size >> 1) & 1;
        enc.bit(m.size, t, b2);
        enc.bit(m.size, 2 + t * 4 + b2, b1);
        enc.bit(m.size, 8 + t * 4 + ((b2 << 1) | b1), s.size & 1);
        const [sx, sy] = s.pts[0];
        encodeSigned(enc, m.steps, START_X, sx - ex);
        encodeSigned(enc, m.steps, START_Y, sy - ey);
        let pdx = 0;
        let pdy = 0;
        let pr = 0;
        for (let i = 1;; i++) {
            const last = i === s.pts.length;
            enc.bit(m.cont, contCtx(i, pdx, pdy), last ? 0 : 1);
            if (last)
                break;
            const dx = s.pts[i][0] - s.pts[i - 1][0];
            const dy = s.pts[i][1] - s.pts[i - 1][1];
            const first = i === 1;
            const rx = first ? dx : dx - pdx;
            const ry = first ? dy : dy - pdy;
            encodeSigned(enc, m.steps, ctxX(first, pr, pdx, pdy), rx);
            encodeSigned(enc, m.steps, ctxY(first, rx, pr, pdx, pdy), ry);
            pr = Math.abs(rx) + Math.abs(ry);
            pdx = dx;
            pdy = dy;
        }
        const end = s.pts[s.pts.length - 1];
        ex = end[0];
        ey = end[1];
    }
    enc.bit(m.more, 0, 0);
}
export function decodeStrokes(dec, w, h) {
    const m = new Models();
    const strokes = [];
    let ex = w >> 1;
    let ey = h >> 1;
    let total = 0;
    while (dec.bit(m.more, 0)) {
        if (strokes.length >= MAX_STROKES)
            throw new CorruptDataError('too many strokes');
        const t = dec.bit(m.tool, 0);
        const b2 = dec.bit(m.size, t);
        const b1 = dec.bit(m.size, 2 + t * 4 + b2);
        const b0 = dec.bit(m.size, 8 + t * 4 + ((b2 << 1) | b1));
        const size = (b2 << 2) | (b1 << 1) | b0;
        if (size >= BRUSH_V1.length)
            throw new CorruptDataError('bad brush size');
        let x = ex + decodeSigned(dec, m.steps, START_X);
        let y = ey + decodeSigned(dec, m.steps, START_Y);
        if (!inRange(x, y, w, h))
            throw new CorruptDataError('point out of range');
        const pts = [[x, y]];
        let pdx = 0;
        let pdy = 0;
        let pr = 0;
        for (let i = 1; dec.bit(m.cont, contCtx(i, pdx, pdy)); i++) {
            if (++total > MAX_POINTS)
                throw new CorruptDataError('too many points');
            const first = i === 1;
            const rx = decodeSigned(dec, m.steps, ctxX(first, pr, pdx, pdy));
            const ry = decodeSigned(dec, m.steps, ctxY(first, rx, pr, pdx, pdy));
            const dx = first ? rx : pdx + rx;
            const dy = first ? ry : pdy + ry;
            x += dx;
            y += dy;
            if (!inRange(x, y, w, h))
                throw new CorruptDataError('point out of range');
            pts.push([x, y]);
            pr = Math.abs(rx) + Math.abs(ry);
            pdx = dx;
            pdy = dy;
        }
        strokes.push({ ink: t === 1, size, pts });
        ex = x;
        ey = y;
    }
    return strokes;
}
