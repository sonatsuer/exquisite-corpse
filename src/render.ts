/** Painting bitmaps onto canvases, at logical resolution (CSS scales them up). */
import { INK, PAPER } from './config.js';
import type { Bitmap } from './types.js';

/** '#RRGGBB' -> RGBA packed for a little-endian Uint32Array view of ImageData. */
function packed(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return ((0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
}

export const COLOR = {
  paper: packed(PAPER),
  ink: packed(INK),
  /** Paper in the strip the next player will see. */
  revealPaper: packed('#E4E4E4'),
  /** Paper of the other player's strip (read-only). */
  stripPaper: packed('#EBEBEB'),
  flap: packed('#C9C9C9'),
  flapEdge: packed('#9A9A9A'),
};

export class Painter {
  readonly image: ImageData;
  private readonly px: Uint32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.image = new ImageData(w, h);
    this.px = new Uint32Array(this.image.data.buffer);
  }

  fill(x: number, y: number, w: number, h: number, color: number): void {
    for (let yy = y; yy < y + h; yy++) this.px.fill(color, yy * this.w + x, yy * this.w + x + w);
  }

  /** Copy columns [x0, x0 + cols) of `b` to (ox, oy). */
  bitmap(b: Bitmap, ox: number, oy: number, paper = COLOR.paper, ink = COLOR.ink, x0 = 0, cols = b.w): void {
    for (let y = 0; y < b.h; y++) {
      const row = (oy + y) * this.w + ox;
      for (let x = 0; x < cols; x++) this.px[row + x] = b.data[y * b.w + x0 + x] ? ink : paper;
    }
  }

  toCanvas(canvas: HTMLCanvasElement): void {
    if (canvas.width !== this.w) canvas.width = this.w;
    if (canvas.height !== this.h) canvas.height = this.h;
    canvas.getContext('2d')!.putImageData(this.image, 0, 0);
  }
}

/** Size a pixel-art canvas to fit `box`, using a whole-number scale when it is at least 2. */
export function fitCanvas(canvas: HTMLCanvasElement, maxW: number, maxH: number): void {
  let scale = Math.min(maxW / canvas.width, maxH / canvas.height);
  if (scale >= 2) scale = Math.floor(scale);
  scale = Math.max(scale, 0.5);
  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
}
