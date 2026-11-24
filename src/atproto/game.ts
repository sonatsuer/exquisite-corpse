/**
 * The online game on top of the AT Protocol:
 *
 *  - a half is an `io.github.sonatsuer.corpse.half` record in its author's repo;
 *  - a half with `answers` completes the half it points to: the pair is a
 *    finished picture;
 *  - answers are found through Constellation backlinks on `answers.uri`;
 *  - invitations are DIDs in `invite`, found through backlinks on `invite[]`.
 */
import type { HalfContent, HalfPayload } from '../types.js';
import { halfUri, NSID_HALF, parseHalfUri, type RecordId } from './links.js';
import { backlinks, getRecord, listRecords, NetworkError, resolveDid, type Fetch } from './net.js';
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

/** Halves that complete `half`, newest first. */
export async function answersTo(half: RecordId, f?: Fetch): Promise<RecordId[]> {
  const links = await backlinks(halfUri(half), ANSWERS_SOURCE, f);
  return links.filter((l) => l.collection === NSID_HALF).map((l) => ({ did: l.did, rkey: l.rkey }));
}

/** Halves whose authors invited `did` (including halves you invited yourself to, e.g. to try the game alone). */
export async function invitesFor(did: string, f?: Fetch): Promise<RecordId[]> {
  const links = await backlinks(did, INVITE_SOURCE, f);
  return links.filter((l) => l.collection === NSID_HALF).map((l) => ({ did: l.did, rkey: l.rkey }));
}

/** Your own halves, newest first. Unreadable records are skipped. */
export async function myHalves(did: string, handle: string | null, f?: Fetch): Promise<OnlineHalf[]> {
  const views = await listRecords(did, NSID_HALF, f);
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

/**
 * Everything for the "My pictures" screen:
 *  - waiting: halves you were invited to and have not answered yet;
 *  - pictures: your open halves, and finished pictures you took part in.
 * `indexOk` is false when Constellation could not be reached, so lists that
 * depend on it may be incomplete.
 */
export async function myGames(
  did: string,
  handle: string | null,
  f?: Fetch,
): Promise<{ waiting: GameEntry[]; pictures: GameEntry[]; indexOk: boolean }> {
  const mine = await myHalves(did, handle, f);
  let indexOk = true;
  const index = <T>(p: Promise<T[]>): Promise<T[]> =>
    p.catch(() => {
      indexOk = false;
      return [] as T[];
    });

  const answeredByMe = new Set(mine.flatMap((h) => (h.record.answers ? [h.record.answers.uri] : [])));
  const invited = (await index(invitesFor(did, f))).filter((id) => !answeredByMe.has(halfUri(id)));
  const waiting = (await settle(invited.slice(0, 30).map((id) => loadHalf(id, f)))).map((half): GameEntry => ({ kind: 'waiting', half }));

  const pictureLists = await Promise.all(
    mine.slice(0, 40).map(async (h): Promise<GameEntry[]> => {
      if (h.record.answers) {
        const target = parseHalfUri(h.record.answers.uri);
        if (!target) return [];
        const answered = await loadHalf(target, f).catch(() => null);
        return answered ? [{ kind: 'finished', answer: h, answered }] : [];
      }
      const answers = await index(answersTo(h.id, f));
      const loaded = await settle(answers.slice(0, 6).map((id) => loadHalf(id, f)));
      const finished = loaded
        .filter((a) => a.payload.side !== h.payload.side)
        .map((answer): GameEntry => ({ kind: 'finished', answer, answered: h }));
      return finished.length ? finished : [{ kind: 'open', half: h }];
    }),
  );
  return { waiting: unique(waiting), pictures: unique(pictureLists.flat()), indexOk };
}

/**
 * Drop repeated entries. A picture can be found twice: when both halves are
 * yours (you answered your own half), it comes up both from your half
 * ("someone answered it") and from your answer ("it answers something").
 */
function unique(entries: GameEntry[]): GameEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = e.kind === 'finished' ? `picture ${e.answer.ref.uri}` : `${e.kind} ${e.half.ref.uri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
