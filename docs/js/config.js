/**
 * App settings. Values marked "format" are part of link format v1:
 * changing them breaks old links, so they need a new format version.
 */
/**
 * Base URL for share links, so links made anywhere (including a local test
 * server) open the published site. null = use the address the page is served
 * from (location.origin + location.pathname), e.g. to test links locally.
 */
export const SHARE_BASE = 'https://sonatsuer.github.io/half-pic/';
/** Format: size of one half, in pixels. */
export const HALF_W = 128;
export const HALF_H = 192;
/** Width of the strip next to the fold that the receiver can see. */
export const DEFAULT_REVEAL = 12;
export const MIN_REVEAL = 4;
/** Format: the reveal width is stored in 5 bits, so at most 32. */
export const MAX_REVEAL = 32;
/** Format: signatures are stored with a 5-bit byte length; we allow up to 24 bytes. */
export const MAX_SIGNATURE_BYTES = 24;
/** Link length thresholds for the meter (characters). */
export const LINK_WARN = 2000;
export const LINK_DANGER = 4000;
/** Picture colours. */
export const PAPER = '#FFFFFF';
export const INK = '#1A1A1A';
