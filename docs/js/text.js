/**
 * Payload bytes <-> text for links and codes.
 *
 * - base64url: 6 bits per character, plain ASCII. Works everywhere.
 * - base16k ("short link"): 14 bits per character, using CJK ideographs from
 *   the original Unicode 1.1 set (U+4E00..U+8DFF), which every system can show
 *   and no Unicode normalization changes. A final character from a separate
 *   128-character block (U+9E00..U+9E7F) carries the last 1-7 bits, so the
 *   byte length is never ambiguous.
 */
import { DecodeError } from './codec.js';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = (() => {
    const t = new Int16Array(128).fill(-1);
    for (let i = 0; i < 64; i++)
        t[B64.charCodeAt(i)] = i;
    t['+'.charCodeAt(0)] = 62; // tolerate standard base64
    t['/'.charCodeAt(0)] = 63;
    return t;
})();
export function toBase64Url(bytes) {
    let out = '';
    let acc = 0;
    let bits = 0;
    for (const b of bytes) {
        acc = ((acc << 8) | b) & 0xffff;
        bits += 8;
        while (bits >= 6) {
            bits -= 6;
            out += B64[(acc >> bits) & 63];
        }
    }
    if (bits > 0)
        out += B64[(acc << (6 - bits)) & 63];
    return out;
}
const bad = () => new DecodeError('invalid', 'This is not an Exquisite Corpse link or code.');
export function fromBase64Url(text) {
    const out = [];
    let acc = 0;
    let bits = 0;
    for (const ch of text) {
        if (ch === '=' || /\s/.test(ch))
            continue;
        const code = ch.charCodeAt(0);
        const v = code < 128 ? B64_INDEX[code] : -1;
        if (v < 0)
            throw bad();
        acc = ((acc << 6) | v) & 0xffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push((acc >> bits) & 0xff);
        }
    }
    return Uint8Array.from(out);
}
const MAIN = 0x4e00; // 16384 characters, 14 bits each
const TAIL = 0x9e00; // 128 characters, 7 bits
export function toBase16k(bytes) {
    const chars = [];
    let acc = 0;
    let bits = 0;
    for (const b of bytes) {
        acc = ((acc << 8) | b) & 0x3fffff;
        bits += 8;
        if (bits >= 14) {
            bits -= 14;
            chars.push(MAIN + ((acc >> bits) & 0x3fff));
        }
    }
    if (bits > 0 && bits <= 7)
        chars.push(TAIL + ((acc << (7 - bits)) & 0x7f));
    else if (bits > 7)
        chars.push(MAIN + ((acc << (14 - bits)) & 0x3fff));
    return String.fromCharCode(...chars);
}
export function fromBase16k(text) {
    const out = [];
    let acc = 0;
    let bits = 0;
    const chars = [...text].filter((ch) => !/\s/.test(ch));
    chars.forEach((ch, i) => {
        const c = ch.codePointAt(0);
        if (c >= MAIN && c < MAIN + 0x4000) {
            acc = ((acc << 14) | (c - MAIN)) & 0x3fffff;
            bits += 14;
        }
        else if (c >= TAIL && c < TAIL + 0x80 && i === chars.length - 1) {
            acc = ((acc << 7) | (c - TAIL)) & 0x3fffff;
            bits += 7;
        }
        else {
            throw bad();
        }
        while (bits >= 8) {
            bits -= 8;
            out.push((acc >> bits) & 0xff);
        }
    });
    return Uint8Array.from(out);
}
/**
 * Get payload bytes from whatever the user has: a full link, a fragment, or a
 * bare code, in either alphabet, possibly percent-encoded or wrapped by email.
 */
export function parseCode(input) {
    let s = input.trim();
    const hash = s.indexOf('#');
    if (hash >= 0)
        s = s.slice(hash + 1);
    if (s.includes('%')) {
        try {
            s = decodeURIComponent(s);
        }
        catch {
            throw bad();
        }
    }
    s = s.replace(/\s+/g, '');
    if (!s)
        throw new DecodeError('empty', 'There is no picture in this link.');
    return /[^\x00-\x7f]/.test(s) ? fromBase16k(s) : fromBase64Url(s);
}
