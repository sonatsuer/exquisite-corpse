/**
 * Public reads from the AT Protocol network. None of these needs a login:
 * every account's repository is public.
 *
 *  - who an account is and where its data lives (DID document);
 *  - which account a handle belongs to (DNS over HTTPS, then HTTPS);
 *  - reading records from an account's PDS;
 *  - backlinks ("which records point at this?") from Constellation;
 *  - handle suggestions from Bluesky's public API (optional nicety).
 *
 * `f` is the fetch function, so tests can supply a fake network.
 */
import { isDid } from './links.js';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetch = (input, init) => fetch(input, init);

export const PLC_DIRECTORY = 'https://plc.directory';
export const DOH = 'https://cloudflare-dns.com/dns-query';
export const CONSTELLATION = 'https://constellation.microcosm.blue';
export const BSKY_PUBLIC_API = 'https://public.api.bsky.app';

export class NetworkError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

async function getJson(f: Fetch, url: string, accept = 'application/json'): Promise<unknown> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await f(url, { headers: { accept } });
  } catch {
    throw new NetworkError(`Could not reach ${host}. Check your connection and try again.`);
  }
  if (!res.ok) {
    let message = `${host} answered with error ${res.status}.`;
    try {
      const body = (await res.json()) as { message?: unknown; error?: unknown };
      if (typeof body.message === 'string' && body.message) message = body.message;
      else if (typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      // not JSON
    }
    throw new NetworkError(message, res.status);
  }
  return res.json();
}

// ---------- identity ----------

export interface Identity {
  did: string;
  /** Base URL of the account's PDS. */
  pds: string;
  /** The handle the account claims, for display. */
  handle: string | null;
}

const identities = new Map<string, Promise<Identity>>();

function didDocUrl(did: string): string {
  if (did.startsWith('did:plc:')) return `${PLC_DIRECTORY}/${did}`;
  const [host, ...path] = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
  return path.length ? `https://${host}/${path.join('/')}/did.json` : `https://${host}/.well-known/did.json`;
}

/** Parse the parts of a DID document the game needs. */
export function identityFromDoc(did: string, doc: unknown): Identity {
  const d = (doc ?? {}) as { id?: unknown; service?: unknown; alsoKnownAs?: unknown };
  if (d.id !== did) throw new NetworkError('The account directory returned the wrong account.');
  const services = Array.isArray(d.service) ? (d.service as Record<string, unknown>[]) : [];
  const pds = services.find(
    (s) => typeof s.id === 'string' && s.id.endsWith('#atproto_pds') && s.type === 'AtprotoPersonalDataServer',
  )?.serviceEndpoint;
  if (typeof pds !== 'string' || !/^https?:\/\//.test(pds)) throw new NetworkError('This account has no data server.');
  const aka = Array.isArray(d.alsoKnownAs) ? d.alsoKnownAs : [];
  const at = aka.find((a): a is string => typeof a === 'string' && a.startsWith('at://'));
  return { did, pds: pds.replace(/\/+$/, ''), handle: at ? at.slice('at://'.length) : null };
}

export function resolveDid(did: string, f: Fetch = defaultFetch): Promise<Identity> {
  if (!isDid(did)) return Promise.reject(new NetworkError(`Not an account id: ${did}`));
  let p = identities.get(did);
  if (!p) {
    p = getJson(f, didDocUrl(did)).then((doc) => identityFromDoc(did, doc));
    p.catch(() => identities.delete(did));
    identities.set(did, p);
  }
  return p;
}

/** Normalise what a person typed as a handle: no "@", lower case. Null if it cannot be a handle. */
export function normalizeHandle(input: string): string | null {
  const h = input.trim().replace(/^@/, '').toLowerCase();
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(h) && h.length <= 253 ? h : null;
}

/** The DID behind a handle: DNS TXT `_atproto.<handle>` (via DNS over HTTPS), then `https://<handle>/.well-known/atproto-did`. */
export async function resolveHandle(input: string, f: Fetch = defaultFetch): Promise<string> {
  const handle = normalizeHandle(input);
  if (!handle) throw new NetworkError(`"${input.trim()}" is not a handle. Handles look like alice.bsky.social.`);
  try {
    const dns = (await getJson(f, `${DOH}?name=_atproto.${handle}&type=TXT`, 'application/dns-json')) as {
      Answer?: { data?: unknown }[];
    };
    for (const a of dns.Answer ?? []) {
      const m = typeof a.data === 'string' ? /did=(did:[a-z]+:[^"\s]+)/.exec(a.data) : null;
      if (m && isDid(m[1]!)) return m[1]!;
    }
  } catch {
    // fall through to HTTPS
  }
  try {
    const res = await f(`https://${handle}/.well-known/atproto-did`);
    const did = res.ok ? (await res.text()).trim() : '';
    if (isDid(did)) return did;
  } catch {
    // not found
  }
  throw new NetworkError(`Could not find the account @${handle}.`);
}

// ---------- records ----------

export interface RecordView {
  uri: string;
  cid: string;
  value: unknown;
}

function recordView(v: unknown): RecordView | null {
  const r = (v ?? {}) as Record<string, unknown>;
  return typeof r.uri === 'string' && typeof r.cid === 'string' ? { uri: r.uri, cid: r.cid, value: r.value } : null;
}

export async function getRecord(did: string, collection: string, rkey: string, f: Fetch = defaultFetch): Promise<RecordView> {
  const { pds } = await resolveDid(did, f);
  const q = new URLSearchParams({ repo: did, collection, rkey });
  try {
    const view = recordView(await getJson(f, `${pds}/xrpc/com.atproto.repo.getRecord?${q}`));
    if (!view) throw new NetworkError('The data server sent something unexpected.');
    return view;
  } catch (e) {
    if (e instanceof NetworkError && (e.status === 400 || e.status === 404)) {
      throw new NetworkError('This picture does not exist any more. Its author may have deleted it.', 404);
    }
    throw e;
  }
}

/** All records of one collection in an account, newest first, fetched 100 at a time (at most `max`). */
export async function listAllRecords(did: string, collection: string, f: Fetch = defaultFetch, max = 1000): Promise<RecordView[]> {
  const { pds } = await resolveDid(did, f);
  const out: RecordView[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ repo: did, collection, limit: String(Math.min(100, max - out.length)) });
    if (cursor) q.set('cursor', cursor);
    const body = (await getJson(f, `${pds}/xrpc/com.atproto.repo.listRecords?${q}`)) as { records?: unknown[]; cursor?: unknown };
    const page = (body.records ?? []).map(recordView).filter((r): r is RecordView => r !== null);
    out.push(...page);
    cursor = page.length && typeof body.cursor === 'string' && body.cursor ? body.cursor : null;
  } while (cursor && out.length < max);
  return out;
}

// ---------- backlinks (Constellation) ----------

export interface Backlink {
  did: string;
  collection: string;
  rkey: string;
}

/** Records whose `source` field (`collection:path`) points at `subject`, newest first; optionally only those by `did`. */
export async function backlinks(subject: string, source: string, f: Fetch = defaultFetch, limit = 100, did?: string): Promise<Backlink[]> {
  const q = new URLSearchParams({ subject, source, limit: String(limit) });
  if (did) q.append('did', did);
  const body = (await getJson(f, `${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${q}`)) as { records?: unknown[] };
  return (body.records ?? []).filter((r): r is Backlink => {
    const b = (r ?? {}) as Record<string, unknown>;
    return typeof b.did === 'string' && isDid(b.did) && typeof b.collection === 'string' && typeof b.rkey === 'string';
  });
}

// ---------- handle suggestions (Bluesky's public API; optional) ----------

export interface Actor {
  did: string;
  handle: string;
  displayName?: string;
}

/** Accounts whose handle or name starts with `q`. Empty on any failure: typing a full handle still works. */
export async function suggestHandles(q: string, f: Fetch = defaultFetch, limit = 6): Promise<Actor[]> {
  const term = q.trim().replace(/^@/, '');
  if (term.length < 2) return [];
  try {
    const params = new URLSearchParams({ q: term, limit: String(limit) });
    const body = (await getJson(f, `${BSKY_PUBLIC_API}/xrpc/app.bsky.actor.searchActorsTypeahead?${params}`)) as {
      actors?: Record<string, unknown>[];
    };
    return (body.actors ?? [])
      .filter((a) => typeof a.did === 'string' && isDid(a.did) && typeof a.handle === 'string')
      .map((a) => ({
        did: a.did as string,
        handle: a.handle as string,
        ...(typeof a.displayName === 'string' && a.displayName ? { displayName: a.displayName } : {}),
      }));
  } catch {
    return [];
  }
}
