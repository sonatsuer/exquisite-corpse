/**
 * The drawing surface for one half. The stroke list is the source of truth:
 * the pixels are always redrawn from it with the same brush the receiver uses.
 * A stroke is stored as exactly the rounded points drawn live, so nothing
 * moves when you lift the pen.
 */
import { HALF_H, HALF_W } from './config.js';
import { COLOR, Painter } from './render.js';
import { cloneBitmap, drawSegment, redraw, seamStrip, stamp, BRUSH_V1 } from './raster.js';
import { clampPoint, quantize } from './simplify.js';
import { otherSide, type Bitmap, type HalfContent, type Point, type Side, type Stroke } from './types.js';

export type HistoryEntry = { kind: 'stroke'; stroke: Stroke } | { kind: 'clear' };
export type Tool = 'pen' | 'eraser';

/** Width of the folded flap shown next to the fold while drawing a new half. */
const FLAP_W = 10;

export interface EditorOptions {
  /** The half being drawn. */
  side: Side;
  /** When completing a picture: the other half. Only its strip next to the fold is shown. */
  other: Bitmap | null;
  /** Columns next to the fold the receiver sees (or, when completing, that you see). */
  reveal: number;
  history: HistoryEntry[];
  onChange: () => void;
}

export class Editor {
  tool: Tool = 'pen';
  readonly sizes: Record<Tool, number> = { pen: 1, eraser: 3 };
  locked = false;

  private history: HistoryEntry[];
  private committed: Bitmap;
  private working: Bitmap | null = null;
  private raw: Point[] = [];
  private last: Point | null = null;
  private pointerId: number | null = null;
  private frame = 0;
  private reveal: number;
  private readonly edgeW: number;
  private readonly halfX: number;
  private readonly edgeX: number;
  private readonly strip: Bitmap | null;
  private readonly abort = new AbortController();

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly opts: EditorOptions,
  ) {
    this.history = opts.history.slice();
    this.reveal = opts.reveal;
    this.committed = redraw(HALF_W, HALF_H, this.strokes());
    this.strip = opts.other ? seamStrip(opts.other, otherSide(opts.side), opts.reveal) : null;
    this.edgeW = this.strip ? opts.reveal : FLAP_W;
    this.halfX = opts.side === 'left' ? 0 : this.edgeW;
    this.edgeX = opts.side === 'left' ? HALF_W : 0;
    canvas.width = HALF_W + this.edgeW;
    canvas.height = HALF_H;
    const signal = this.abort.signal;
    canvas.addEventListener('pointerdown', (e) => this.down(e), { signal });
    canvas.addEventListener('pointermove', (e) => this.move(e), { signal });
    canvas.addEventListener('pointerup', (e) => this.up(e), { signal });
    canvas.addEventListener('pointercancel', (e) => this.up(e), { signal });
    canvas.addEventListener('lostpointercapture', (e) => this.up(e), { signal });
    this.render();
  }

  destroy(): void {
    this.abort.abort();
    cancelAnimationFrame(this.frame);
  }

  /** The strokes that make up the picture: everything after the last clear. */
  strokes(): Stroke[] {
    const out: Stroke[] = [];
    for (const h of this.history) {
      if (h.kind === 'clear') out.length = 0;
      else out.push(h.stroke);
    }
    return out;
  }

  getHistory(): HistoryEntry[] {
    return this.history.slice();
  }

  content(signature: string): HalfContent {
    return { bitmap: cloneBitmap(this.committed), strokes: this.strokes(), signature };
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** True when completing someone else's picture (their strip is shown). */
  get hasOther(): boolean {
    return this.strip !== null;
  }

  get isEmpty(): boolean {
    return this.strokes().length === 0;
  }

  undo(): void {
    if (this.locked || !this.history.length || this.pointerId !== null) return;
    this.history.pop();
    this.commit();
  }

  clear(): void {
    if (this.locked || this.isEmpty || this.pointerId !== null) return;
    this.history.push({ kind: 'clear' });
    this.commit();
  }

  setReveal(reveal: number): void {
    this.reveal = reveal;
    this.render();
  }

  private commit(): void {
    this.committed = redraw(HALF_W, HALF_H, this.strokes());
    this.render();
    this.opts.onChange();
  }

  private toHalf(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) * this.canvas.width) / r.width - this.halfX - 0.5;
    const y = ((e.clientY - r.top) * this.canvas.height) / r.height - 0.5;
    return clampPoint([x, y], HALF_W, HALF_H);
  }

  private add(e: PointerEvent): void {
    const p = this.toHalf(e);
    this.raw.push(p);
    const q: Point = [Math.round(p[0]), Math.round(p[1])];
    const d = BRUSH_V1[this.sizes[this.tool]]!;
    const v = this.tool === 'pen' ? 1 : 0;
    if (!this.last) stamp(this.working!, q[0] + 0.5, q[1] + 0.5, d, v);
    else if (q[0] !== this.last[0] || q[1] !== this.last[1]) drawSegment(this.working!, this.last[0], this.last[1], q[0], q[1], d, v);
    this.last = q;
  }

  private down(e: PointerEvent): void {
    if (this.locked || this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.working = cloneBitmap(this.committed);
    this.raw = [];
    this.last = null;
    this.add(e);
    this.schedule();
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) this.add(ev);
    this.schedule();
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const pts = quantize(this.raw, HALF_W, HALF_H); // exactly the path drawn live
    this.working = null;
    this.raw = [];
    this.last = null;
    if (pts.length) this.history.push({ kind: 'stroke', stroke: { ink: this.tool === 'pen', size: this.sizes[this.tool], pts } });
    this.commit();
  }

  private schedule(): void {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
    }
  }

  render(): void {
    const half = this.working ?? this.committed;
    const p = new Painter(this.canvas.width, HALF_H);
    p.bitmap(half, this.halfX, 0);
    if (this.strip) {
      p.bitmap(this.strip, this.edgeX, 0, COLOR.stripPaper);
    } else {
      // Shade the columns the next player will see, and draw the folded-away flap.
      const r = Math.min(this.reveal, HALF_W);
      const x0 = this.opts.side === 'left' ? HALF_W - r : 0;
      p.bitmap(half, this.halfX + x0, 0, COLOR.revealPaper, COLOR.ink, x0, r);
      p.fill(this.edgeX, 0, this.edgeW, HALF_H, COLOR.flap);
      p.fill(this.opts.side === 'left' ? this.edgeX : this.edgeX + this.edgeW - 1, 0, 1, HALF_H, COLOR.flapEdge);
    }
    p.toCanvas(this.canvas);
  }
}
