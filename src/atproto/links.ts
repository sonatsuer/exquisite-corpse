/**
 * Addresses of the game's records: AT URIs, and the short in-app routes
 * `#/half/<did>/<rkey>` (draw the other half) and `#/picture/<did>/<rkey>`
 * (a finished picture: this answer plus the half it answers).
 */

/** The game's record type (lexicon NSID). Permanent: changing it orphans every saved half. */
export const NSID_HALF = 'io.github.sonatsuer.corpse.half';

export interface RecordId {
  did: string;
  rkey: string;
}

export type OnlineRoute = { kind: 'half' | 'picture' } & RecordId;

const DID_RE = /^did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%-]+(?::[a-zA-Z0-9._%-]+)*)$/;
const RKEY_RE = /^[a-zA-Z0-9._:~-]{1,512}$/;

export const isDid = (s: string): boolean => DID_RE.test(s);
export const isRkey = (s: string): boolean => RKEY_RE.test(s) && s !== '.' && s !== '..';

/** Parse a route path such as `/half/did:plc:…/3abc` (the part after `#`). */
export function parseOnlineRoute(path: string): OnlineRoute | null {
  const m = /^\/(half|picture)\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return null;
  let did: string;
  try {
    did = decodeURIComponent(m[2]!);
  } catch {
    return null;
  }
  const rkey = m[3]!;
  return isDid(did) && isRkey(rkey) ? { kind: m[1] as OnlineRoute['kind'], did, rkey } : null;
}

export const onlinePath = (r: OnlineRoute): string => `/${r.kind}/${r.did}/${r.rkey}`;

export const halfUri = (r: RecordId): string => `at://${r.did}/${NSID_HALF}/${r.rkey}`;

/** The record id of an `at://<did>/<NSID_HALF>/<rkey>` URI, or null if it is anything else. */
export function parseHalfUri(uri: string): RecordId | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m || m[2] !== NSID_HALF || !isDid(m[1]!) || !isRkey(m[3]!)) return null;
  return { did: m[1]!, rkey: m[3]! };
}
