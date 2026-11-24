/**
 * The online game on top of the AT Protocol:
 *
 *  - a half is an `io.github.sonatsuer.corpse.half` record in its author's repo;
 *  - a half with `answers` completes the half it points to: the pair is a
 *    finished picture;
 *  - answers are found through Constellation backlinks on `answers.uri`;
 *  - invitations are DIDs in `invite`, found through backlinks on `invite[]`.
 */
import { otherSide, type HalfContent, type HalfPayload, type Side } from '../types.js';
import { halfUri, NSID_HALF, parseHalfUri, type RecordId } from './links.js';
import { backlinks, getRecord, listAllRecords, NetworkError, resolveDid, type Fetch } from './net.js';
import { buildHalfRecord, parseHalfRecord, payloadOf, recordAround, type HalfRecord, type StrongRef } from './record.js';
import { createRecord, deleteRecord, putRecord, type Writer } from './write.js';

export interface OnlineHalf {
  id: RecordId;
  ref: StrongRef;
  record: HalfRecord;
  payload: HalfPayload;
  /** The author's handle, for display. */
  author: string | null;
}

const ANSWERS_SOURCE = `${NSID_HALF}:answers.uri`;
const INVITE_SOURCE = `${NSID_HALF}:invite[]`;

const handleOf = (did: string, f?: Fetch) =>
  resolveDid(did, f)
    .then((i) => i.handle)
    .catch(() => null);

function toOnlineHalf(id: RecordId, ref: StrongRef, value: unknown, author: string | null): OnlineHalf {
  const record = parseHalfRecord(value);
  if (!record) throw new NetworkError('This is not an Exquisite Corpse half.');
  return { id, ref, record, payload: payloadOf(record), author };
}

export async function loadHalf(id: RecordId, f?: Fetch): Promise<OnlineHalf> {
  const [view, author] = await Promise.all([getRecord(id.did, NSID_HALF, id.rkey, f), handleOf(id.did, f)]);
  return toOnlineHalf(id, { uri: view.uri, cid: view.cid }, view.value, author);
}

/** A finished picture: the answer at `id`, and the half it answers. */
export async function loadPicture(id: RecordId, f?: Fetch): Promise<{ answer: OnlineHalf; answered: OnlineHalf }> {
  const answer = await loadHalf(id, f);
  const target = answer.record.answers ? parseHalfUri(answer.record.answers.uri) : null;
  if (!target) throw new NetworkError('This half does not complete another half, so there is no finished picture yet.');
  const answered = await loadHalf(target, f);
  if (answered.payload.side === answer.payload.side) throw new NetworkError('These two halves do not fit together.');
  return { answer, answered };
}

/** Left and right halves of a picture made of two halves. */
export function pairOf(a: { payload: HalfPayload }, b: { payload: HalfPayload }): { left: HalfContent; right: HalfContent } {
  return a.payload.side === 'left' ? { left: a.payload.half, right: b.payload.half } : { left: b.payload.half, right: a.payload.half };
}

export async function publishHalf(
  w: Writer & { handle: string | null },
  payload: HalfPayload,
  extra: { answers?: StrongRef; invite?: string[] } = {},
): Promise<OnlineHalf> {
  const record = buildHalfRecord(payload, extra);
  const ref = await createRecord(w, NSID_HALF, record);
  return { id: { did: w.did, rkey: ref.rkey }, ref: { uri: ref.uri, cid: ref.cid }, record, payload, author: w.handle };
}

/**
 * Change the invitations or the announcement of one of your own halves.
 * The drawing never changes: others may have answered it, and changing it would
 * change their finished pictures. A different drawing is always a new half.
 */
export async function updateHalf(
  w: Writer,
  half: OnlineHalf,
  changes: { invite?: string[]; announcement?: StrongRef },
): Promise<OnlineHalf> {
  if (half.id.did !== w.did) throw new NetworkError('Only the author can change this half.');
  const record = recordAround(half.record.picture, {
    answers: half.record.answers,
    invite: changes.invite ?? half.record.invite,
    announcement: changes.announcement ?? half.record.announcement,
    createdAt: half.record.createdAt,
  });
  const ref = await putRecord(w, NSID_HALF, half.id.rkey, record);
  return { ...half, ref, record };
}

/** Delete one of your own halves. Finished pictures made with it disappear too. */
export async function deleteHalf(w: Writer, half: OnlineHalf): Promise<void> {
  if (half.id.did !== w.did) throw new NetworkError('Only the author can delete this half.');
  await deleteRecord(w, NSID_HALF, half.id.rkey);
}

/** Halves that complete `half`, newest first; optionally only those drawn by `by`. */
export async function answersTo(half: RecordId, f?: Fetch, by?: string): Promise<RecordId[]> {
  const links = await backlinks(halfUri(half), ANSWERS_SOURCE, f, 100, by);
  return links.filter((l) => l.collection === NSID_HALF).map((l) => ({ did: l.did, rkey: l.rkey }));
}

/** Halves whose authors invited `did` (including halves you invited yourself to, e.g. to try the game alone). */
export async function invitesFor(did: string, f?: Fetch): Promise<RecordId[]> {
  const links = await backlinks(did, INVITE_SOURCE, f);
  return links.filter((l) => l.collection === NSID_HALF).map((l) => ({ did: l.did, rkey: l.rkey }));
}

/** Your own halves, newest first. Unreadable records are skipped. */
export async function myHalves(did: string, handle: string | null, f?: Fetch): Promise<OnlineHalf[]> {
  const views = await listAllRecords(did, NSID_HALF, f);
  const out: OnlineHalf[] = [];
  for (const v of views) {
    const id = parseHalfUri(v.uri);
    if (!id || id.did !== did) continue;
    try {
      out.push(toOnlineHalf(id, { uri: v.uri, cid: v.cid }, v.value, handle));
    } catch {
      // damaged or foreign record: ignore
    }
  }
  return out.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
}

export type GameEntry =
  | { kind: 'waiting'; half: OnlineHalf }
  | { kind: 'open'; half: OnlineHalf }
  | { kind: 'finished'; answer: OnlineHalf; answered: OnlineHalf };

const settle = async <T>(ps: Promise<T>[]): Promise<T[]> =>
  (await Promise.allSettled(ps)).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

/** Which pictures to show: those where `artist` (a DID; null = anyone) drew `side` (null = either side). */
export interface PictureFilter {
  artist: string | null;
  side: Side | null;
}

export const ANY_PICTURE: PictureFilter = { artist: null, side: null };

/** Does any of these halves (who drew which side) satisfy the filter? */
export function matchesFilter(filter: PictureFilter, halves: { did: string; side: Side }[]): boolean {
  return halves.some((h) => (filter.artist === null || h.did === filter.artist) && (filter.side === null || h.side === filter.side));
}

/**
 * "Your pictures", in batches: your open halves and the finished pictures you
 * drew a half of, newest first, filtered by artist and side. Your own records
 * say which side you drew and whose half each answer completes, so most
 * filtering happens before any network request.
 */
export class PicturePager {
  /** Other artists met so far (DID → handle), for the filter menu. */
  readonly artists = new Map<string, string | null>();
  /** False when Constellation could not be reached, so answers may be missing. */
  indexOk = true;
  private readonly queue: OnlineHalf[];
  private readonly buffer: GameEntry[] = [];
  private readonly seen = new Set<string>();

  private constructor(
    private readonly did: string,
    readonly mine: readonly OnlineHalf[],
    readonly filter: PictureFilter,
    private readonly f?: Fetch,
  ) {
    this.queue = [...mine];
  }

  /** Read all your halves (a few requests), ready to page through. */
  static async open(did: string, handle: string | null, filter: PictureFilter = ANY_PICTURE, f?: Fetch): Promise<PicturePager> {
    return new PicturePager(did, await myHalves(did, handle, f), filter, f);
  }

  /** The same halves with another filter (no new requests until next()). */
  withFilter(filter: PictureFilter): PicturePager {
    const p = new PicturePager(this.did, this.mine, filter, this.f);
    for (const [k, v] of this.artists) p.artists.set(k, v);
    return p;
  }

  /** URIs of the halves you answered, so "Waiting for you" can leave them out. */
  get answered(): Set<string> {
    return new Set(this.mine.flatMap((h) => (h.record.answers ? [h.record.answers.uri] : [])));
  }

  get done(): boolean {
    return !this.queue.length && !this.buffer.length;
  }

  /** Up to `count` more entries. */
  async next(count = 12): Promise<GameEntry[]> {
    const out: GameEntry[] = [];
    while (out.length < count && !this.done) {
      if (this.buffer.length) {
        out.push(this.buffer.shift()!);
        continue;
      }
      const batch = this.queue.splice(0, 6);
      const found = await Promise.all(batch.map((h) => this.entriesFor(h)));
      this.buffer.push(...found.flat());
    }
    return out;
  }

  private note(h: OnlineHalf): void {
    if (h.id.did !== this.did) this.artists.set(h.id.did, h.author);
  }

  private fresh(entries: GameEntry[]): GameEntry[] {
    return entries.filter((e) => {
      const key = e.kind === 'finished' ? `picture ${e.answer.ref.uri}` : `${e.kind} ${e.half.ref.uri}`;
      if (this.seen.has(key)) return false;
      this.seen.add(key);
      return true;
    });
  }

  private async entriesFor(h: OnlineHalf): Promise<GameEntry[]> {
    const me = this.did;
    const mySide = h.payload.side;
    const theirSide = otherSide(mySide);
    const filter = this.filter;
    if (h.record.answers) {
      // Your answer: the other artist is known from the link, before fetching anything.
      const target = parseHalfUri(h.record.answers.uri);
      if (!target || !matchesFilter(filter, [{ did: me, side: mySide }, { did: target.did, side: theirSide }])) return [];
      const answered = await loadHalf(target, this.f).catch(() => null);
      if (!answered || answered.payload.side === mySide) return [];
      this.note(answered);
      return this.fresh([{ kind: 'finished', answer: h, answered }]);
    }
    // Your half: its answers come from the index.
    const mineMatches = matchesFilter(filter, [{ did: me, side: mySide }]);
    const answersCould = filter.side === null || filter.side === theirSide;
    if (!mineMatches && !answersCould) return [];
    const onlyBy = !mineMatches && filter.artist ? filter.artist : undefined;
    let ids: RecordId[] = [];
    try {
      ids = await answersTo(h.id, this.f, onlyBy);
    } catch {
      this.indexOk = false;
    }
    const answers = (await settle(ids.slice(0, 20).map((id) => loadHalf(id, this.f)))).filter((a) => a.payload.side !== mySide);
    answers.forEach((a) => this.note(a));
    const finished = answers
      .filter((a) => matchesFilter(filter, [{ did: me, side: mySide }, { did: a.id.did, side: a.payload.side }]))
      .map((answer): GameEntry => ({ kind: 'finished', answer, answered: h }));
    if (finished.length) return this.fresh(finished);
    return !answers.length && !onlyBy && mineMatches ? this.fresh([{ kind: 'open', half: h }]) : [];
  }
}

/** "Waiting for you", in batches: halves you were invited to and have not answered yet. */
export class WaitingPager {
  indexOk = true;
  private constructor(
    private readonly ids: RecordId[],
    private readonly f?: Fetch,
  ) {}

  static async open(did: string, answered: Set<string>, f?: Fetch): Promise<WaitingPager> {
    let ids: RecordId[] = [];
    let ok = true;
    try {
      ids = await invitesFor(did, f);
    } catch {
      ok = false;
    }
    const seen = new Set<string>();
    const fresh = ids.filter((id) => {
      const uri = halfUri(id);
      if (answered.has(uri) || seen.has(uri)) return false;
      seen.add(uri);
      return true;
    });
    const p = new WaitingPager(fresh, f);
    p.indexOk = ok;
    return p;
  }

  get done(): boolean {
    return !this.ids.length;
  }

  async next(count = 12): Promise<GameEntry[]> {
    const batch = this.ids.splice(0, count);
    return (await settle(batch.map((id) => loadHalf(id, this.f)))).map((half): GameEntry => ({ kind: 'waiting', half }));
  }
}
