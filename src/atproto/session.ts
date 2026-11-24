/**
 * Who is signed in. Kept small and free of the OAuth library, which is
 * imported only when someone has signed in before or is signing in now.
 */
import { load, remove, save } from '../storage.js';
import { NSID_HALF } from './links.js';
import { resolveDid } from './net.js';
import type { Writer } from './write.js';

/** Basic sign-in: save the game's own records, nothing else. */
export const SCOPE_BASIC = `atproto repo:${NSID_HALF}`;
/** Also allow posting on Bluesky with an image (asked for on first use). */
export const SCOPE_BLUESKY = `${SCOPE_BASIC} repo:app.bsky.feed.post?action=create blob:image/*`;
/** For data servers that do not support fine-grained permissions yet. */
export const SCOPE_FALLBACK = 'atproto transition:generic';

export interface Session extends Writer {
  readonly handle: string | null;
  /** May this session create Bluesky posts with images? */
  readonly canPost: boolean;
}

interface StoredAccount {
  did: string;
}

interface PendingSignIn {
  handle: string;
  returnTo: string;
  bluesky: boolean;
  fallback: boolean;
}

const ACCOUNT_KEY = 'account';
const PENDING_KEY = 'exquisite-corpse:pending-sign-in';

let current: Session | null = null;
/** Ends the OAuth session behind `current` (set when it is created). */
let endCurrent: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export const getSession = (): Session | null => current;

export function onSessionChange(listener: () => void): void {
  listeners.add(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

function readPending(): PendingSignIn | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingSignIn) : null;
  } catch {
    return null;
  }
}

function writePending(p: PendingSignIn): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    // the retry-with-fallback-scope convenience is lost; sign-in still works
  }
}

const isCallback = () => {
  const q = new URLSearchParams(location.search);
  return q.has('state') && (q.has('code') || q.has('error'));
};

/**
 * On page load: finish a sign-in that just returned here, or restore the
 * previous session. Resolves with the route to go back to (after a sign-in)
 * and a message if signing in failed.
 */
export async function startSession(): Promise<{ returnTo: string | null; error: string | null }> {
  const stored = load<StoredAccount>(ACCOUNT_KEY);
  const callback = isCallback();
  if (!callback && !stored?.did) return { returnTo: null, error: null };
  const pending = callback ? readPending() : null;
  const oauth = await import('./oauth.js');
  try {
    const result = await oauth.init();
    if (!result) {
      if (stored) remove(ACCOUNT_KEY);
      current = null;
      notify();
      return { returnTo: null, error: null };
    }
    const s = result.session;
    const scope = await oauth.scopeOf(s);
    const handle = await resolveDid(s.did).then((i) => i.handle).catch(() => pending?.handle ?? null);
    current = {
      did: s.did,
      handle,
      canPost: /(^|\s)(transition:generic|repo:app\.bsky\.feed\.post)/.test(scope),
      fetchHandler: (path, init) => s.fetchHandler(path, init),
    };
    endCurrent = () => oauth.signOut(s);
    save(ACCOUNT_KEY, { did: s.did } satisfies StoredAccount);
    notify();
    return { returnTo: result.state ?? null, error: null };
  } catch (e) {
    // Restoring a saved session failed (e.g. offline): stay signed out for now, keep the
    // account for next time, and leave the address alone so the opened link still works.
    if (!callback) return { returnTo: null, error: null };
    history.replaceState(null, '', location.pathname);
    const message = e instanceof Error ? e.message : String(e);
    if (pending && !pending.fallback && /invalid_scope|scope/i.test(message)) {
      // The data server does not know the fine-grained permissions yet: ask for the general one instead.
      await signIn(pending.handle, pending.returnTo, pending.bluesky, true);
    }
    const cancelled = /access_denied|denied|cancel/i.test(message);
    return {
      returnTo: pending?.returnTo ?? null,
      error: cancelled ? 'Sign-in was cancelled.' : `Sign-in did not work: ${message}`,
    };
  }
}

/** Go to the account's sign-in page; come back to `returnTo` (a route such as "#/mine"). */
export async function signIn(handle: string, returnTo: string, bluesky = false, fallback = false): Promise<void> {
  writePending({ handle, returnTo, bluesky, fallback });
  const oauth = await import('./oauth.js');
  const scope = fallback ? SCOPE_FALLBACK : bluesky ? SCOPE_BLUESKY : SCOPE_BASIC;
  await oauth.signIn(handle, returnTo, scope);
}

export async function signOut(): Promise<void> {
  try {
    await endCurrent?.();
  } catch {
    // already gone on the server; forget it locally anyway
  }
  remove(ACCOUNT_KEY);
  current = null;
  endCurrent = null;
  notify();
}
