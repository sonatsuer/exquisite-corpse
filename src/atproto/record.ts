/**
 * The game's record (`io.github.sonatsuer.corpse.half`, see lexicons/): building
 * one from a half, and checking one read from the network, where anyone could
 * have written anything.
 */
import { decodePayload, encodePayload, DecodeError } from '../codec.js';
import { parseCode, toBase64Url } from '../text.js';
import type { HalfPayload } from '../types.js';
import { isDid, NSID_HALF, parseHalfUri } from './links.js';

export interface StrongRef {
  uri: string;
  cid: string;
}

export interface HalfRecord {
  picture: string;
  answers?: StrongRef;
  invite?: string[];
  announcement?: StrongRef;
  createdAt: string;
}

const MAX_PICTURE = 20000;
export const MAX_INVITES = 20;

function strongRef(v: unknown, sameCollection: boolean): StrongRef | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { uri, cid } = v as Record<string, unknown>;
  if (typeof uri !== 'string' || typeof cid !== 'string' || !cid || cid.length > 200) return undefined;
  if (sameCollection ? !parseHalfUri(uri) : !/^at:\/\/[^/]+\/[^/]+\/[^/]+$/.test(uri)) return undefined;
  return { uri, cid };
}

/** A well-formed half record, or null. Unknown fields are ignored. */
export function parseHalfRecord(v: unknown): HalfRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.picture !== 'string' || !r.picture || r.picture.length > MAX_PICTURE) return null;
  if (typeof r.createdAt !== 'string') return null;
  const out: HalfRecord = { picture: r.picture, createdAt: r.createdAt };
  const answers = strongRef(r.answers, true);
  if (answers) out.answers = answers;
  const announcement = strongRef(r.announcement, false);
  if (announcement) out.announcement = announcement;
  if (Array.isArray(r.invite)) {
    const invite = r.invite.filter((d): d is string => typeof d === 'string' && isDid(d)).slice(0, MAX_INVITES);
    if (invite.length) out.invite = invite;
  }
  return out;
}

/** The half stored in a record. Throws DecodeError if the picture is damaged or is not a half. */
export function payloadOf(rec: HalfRecord): HalfPayload {
  const p = decodePayload(parseCode(rec.picture));
  if (p.kind !== 'half') throw new DecodeError('invalid', 'This record does not hold half a picture.');
  return p;
}

type RecordExtras = { answers?: StrongRef; invite?: string[]; announcement?: StrongRef; createdAt?: string };

/** A record ready for createRecord. */
export function buildHalfRecord(half: HalfPayload, extra: RecordExtras = {}): HalfRecord & { $type: string } {
  return recordAround(toBase64Url(encodePayload(half)), extra);
}

/** A record holding exactly this picture text (used to change a half's invitations without touching its drawing). */
export function recordAround(picture: string, extra: RecordExtras = {}): HalfRecord & { $type: string } {
  const rec: HalfRecord & { $type: string } = {
    $type: NSID_HALF,
    picture,
    createdAt: extra.createdAt ?? new Date().toISOString(),
  };
  if (extra.answers) rec.answers = extra.answers;
  const invite = [...new Set(extra.invite ?? [])].filter(isDid).slice(0, MAX_INVITES);
  if (invite.length) rec.invite = invite;
  if (extra.announcement) rec.announcement = extra.announcement;
  return rec;
}
