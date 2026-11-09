/** Which half of the page. The fold is vertical, so halves are left and right. */
export type Side = 'left' | 'right';

/** A 1-bit image: data[y * w + x] is 1 for ink, 0 for paper. */
export interface Bitmap {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
}

/** A point in half coordinates. Integers once a stroke is finished. */
export type Point = [number, number];

export interface Stroke {
  /** true = pen (ink), false = eraser (paper). */
  ink: boolean;
  /** Index into BRUSH_V1 (raster.ts). */
  size: number;
  pts: Point[];
}

/** One half as it travels in a link. */
export interface HalfContent {
  bitmap: Bitmap;
  /** The strokes that draw `bitmap`, when known. Lets the encoder use the stroke method. */
  strokes: Stroke[] | null;
  /** Optional name of the person who drew it ('' = none). */
  signature: string;
}

/** A half-picture challenge: the receiver sees `reveal` columns next to the fold. */
export interface HalfPayload {
  kind: 'half';
  side: Side;
  reveal: number;
  half: HalfContent;
}

/** A finished picture: both halves. */
export interface ChimeraPayload {
  kind: 'chimera';
  left: HalfContent;
  right: HalfContent;
}

export type Payload = HalfPayload | ChimeraPayload;

export const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');
