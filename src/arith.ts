/**
 * Binary arithmetic coder (32-bit, carry-less, in the style of lpaq) plus
 * adaptive bit models. Everything uses integer arithmetic so the encoder and
 * the decoder agree bit for bit in every browser. Part of link format v1.
 */

/** Thrown when coded data is malformed. codec.ts turns it into a DecodeError. */
export class CorruptDataError extends Error {}

/** Probability of a 1 bit, per context, learned from counts. */
export class BitModel {
  private readonly n0: Uint16Array;
  private readonly n1: Uint16Array;

  constructor(contexts: number) {
    this.n0 = new Uint16Array(contexts);
    this.n1 = new Uint16Array(contexts);
  }

  /** P(bit = 1) in units of 1/4096, from the counts (KT estimator), clamped to [1, 4095]. */
  p1(ctx: number): number {
    const n0 = this.n0[ctx]!;
    const n1 = this.n1[ctx]!;
    const p = Math.floor((4096 * (2 * n1 + 1)) / (2 * (n0 + n1) + 2));
    return p < 1 ? 1 : p > 4095 ? 4095 : p;
  }

  update(ctx: number, bit: number): void {
    if (bit) this.n1[ctx]++;
    else this.n0[ctx]++;
    if (this.n0[ctx]! + this.n1[ctx]! >= 1024) {
      this.n0[ctx] = (this.n0[ctx]! + 1) >> 1;
      this.n1[ctx] = (this.n1[ctx]! + 1) >> 1;
    }
  }
}

export class Encoder {
  private x1 = 0;
  private x2 = 0xffffffff;
  private readonly out: number[] = [];

  /** Code one bit with P(1) = p / 4096. */
  bitP(bit: number, p: number): void {
    const xmid = this.x1 + ((this.x2 - this.x1) >>> 12) * p;
    if (bit) this.x2 = xmid;
    else this.x1 = xmid + 1;
    while (((this.x1 ^ this.x2) & 0xff000000) === 0) {
      this.out.push(this.x2 >>> 24);
      this.x1 = (this.x1 << 8) >>> 0;
      this.x2 = ((this.x2 << 8) | 255) >>> 0;
    }
  }

  bit(model: BitModel, ctx: number, bit: number): void {
    this.bitP(bit, model.p1(ctx));
    model.update(ctx, bit);
  }

  /** Code `nbits` plain bits of `value`, most significant first. */
  raw(value: number, nbits: number): void {
    for (let i = nbits - 1; i >= 0; i--) this.bitP((value >>> i) & 1, 2048);
  }

  /** Bytes written so far, plus the one byte finish() adds. */
  get length(): number {
    return this.out.length + 1;
  }

  finish(): Uint8Array {
    // x1 and x2 differ in their top byte here, so x2's top byte followed by
    // zero padding (which the decoder supplies) lies inside [x1, x2].
    return Uint8Array.from([...this.out, this.x2 >>> 24]);
  }
}

export class Decoder {
  private x1 = 0;
  private x2 = 0xffffffff;
  private x = 0;
  private pos: number;

  constructor(
    private readonly buf: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.pos = start;
    for (let i = 0; i < 4; i++) this.x = ((this.x << 8) | this.next()) >>> 0;
  }

  private next(): number {
    const b = this.pos < this.end ? this.buf[this.pos]! : 0;
    this.pos++;
    // A valid stream never reads more than 4 bytes past its end.
    if (this.pos > this.end + 8) throw new CorruptDataError('read past end of data');
    return b;
  }

  bitP(p: number): number {
    const xmid = this.x1 + ((this.x2 - this.x1) >>> 12) * p;
    const bit = this.x <= xmid ? 1 : 0;
    if (bit) this.x2 = xmid;
    else this.x1 = xmid + 1;
    while (((this.x1 ^ this.x2) & 0xff000000) === 0) {
      this.x1 = (this.x1 << 8) >>> 0;
      this.x2 = ((this.x2 << 8) | 255) >>> 0;
      this.x = ((this.x << 8) | this.next()) >>> 0;
    }
    return bit;
  }

  bit(model: BitModel, ctx: number): number {
    const bit = this.bitP(model.p1(ctx));
    model.update(ctx, bit);
    return bit;
  }

  raw(nbits: number): number {
    let v = 0;
    for (let i = 0; i < nbits; i++) v = (v << 1) | this.bitP(2048);
    return v >>> 0;
  }
}

/**
 * Models for signed integers coded as: zero flag, sign, Exp-Golomb exponent in
 * unary (adaptive), mantissa as plain bits. Small values are cheap.
 */
export class SignedModel {
  readonly zero: BitModel;
  readonly sign: BitModel;
  readonly unary: BitModel;

  constructor(readonly contexts: number) {
    this.zero = new BitModel(contexts);
    this.sign = new BitModel(contexts);
    this.unary = new BitModel(contexts * UNARY_SLOTS);
  }
}

const UNARY_SLOTS = 12;
const MAX_EXPONENT = 24;

export function encodeSigned(enc: Encoder, m: SignedModel, ctx: number, v: number): void {
  enc.bit(m.zero, ctx, v === 0 ? 1 : 0);
  if (v === 0) return;
  enc.bit(m.sign, ctx, v < 0 ? 1 : 0);
  // |v| = 2^k + mantissa, mantissa < 2^k
  const a = Math.abs(v);
  if (!Number.isInteger(v) || a >= 1 << (MAX_EXPONENT + 1)) throw new RangeError(`cannot code ${v}`);
  let k = 0;
  while (a >= 1 << (k + 1)) k++;
  for (let i = 0; i < k; i++) enc.bit(m.unary, ctx * UNARY_SLOTS + Math.min(i, UNARY_SLOTS - 1), 0);
  enc.bit(m.unary, ctx * UNARY_SLOTS + Math.min(k, UNARY_SLOTS - 1), 1);
  if (k) enc.raw(a - (1 << k), k);
}

export function decodeSigned(dec: Decoder, m: SignedModel, ctx: number): number {
  if (dec.bit(m.zero, ctx)) return 0;
  const negative = dec.bit(m.sign, ctx);
  let k = 0;
  while (!dec.bit(m.unary, ctx * UNARY_SLOTS + Math.min(k, UNARY_SLOTS - 1))) {
    if (++k > MAX_EXPONENT) throw new CorruptDataError('number too large');
  }
  const a = (1 << k) + (k ? dec.raw(k) : 0);
  return negative ? -a : a;
}
