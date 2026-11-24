/**
 * AT Protocol sign-in (OAuth) using Bluesky's open-source browser client.
 * Loaded on demand (see session.ts), so people who only play by link never
 * download it.
 *
 * - Production: the client metadata is docs/client-metadata.json, served at
 *   its client_id URL on GitHub Pages; the same object is built in here.
 * - Local development on http://127.0.0.1:<port>: a "loopback" client, which
 *   needs no hosted metadata (open the site via 127.0.0.1, not localhost).
 *
 * Handles are resolved through DNS over HTTPS and the handle's own web
 * address, not through a Bluesky service.
 */
import {
  AtprotoDohHandleResolver,
  atprotoLoopbackClientMetadata,
  BrowserOAuthClient,
  buildLoopbackClientId,
  type OAuthClientMetadataInput,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import metadata from '../../docs/client-metadata.json';
import { DOH } from './net.js';

const LOOPBACK = ['127.0.0.1', '[::1]', 'localhost'];

let client: Promise<BrowserOAuthClient> | null = null;
let initialized: ReturnType<BrowserOAuthClient['init']> | null = null;

function getClient(): Promise<BrowserOAuthClient> {
  client ??= (async () => {
    const handleResolver = new AtprotoDohHandleResolver({ dohEndpoint: DOH });
    const clientMetadata = LOOPBACK.includes(location.hostname)
      ? atprotoLoopbackClientMetadata(`${buildLoopbackClientId(location)}&scope=${encodeURIComponent(metadata.scope)}`)
      : (metadata as unknown as OAuthClientMetadataInput);
    return new BrowserOAuthClient({ clientMetadata, handleResolver, responseMode: 'query' });
  })();
  return client;
}

/** Finish a sign-in that just returned to the page, or restore the last session. Runs once per page load. */
export async function init(): Promise<{ session: OAuthSession; state?: string | null } | undefined> {
  initialized ??= getClient().then((c) => c.init());
  return initialized;
}

/** Send the player to their account's sign-in page. Never resolves: the page navigates away. */
export async function signIn(handle: string, state: string, scope: string): Promise<void> {
  await init().catch(() => undefined);
  await (await getClient()).signIn(handle, { state, scope });
}

export async function scopeOf(session: OAuthSession): Promise<string> {
  try {
    return (await session.getTokenInfo(false)).scope;
  } catch {
    return '';
  }
}

export async function signOut(session: OAuthSession): Promise<void> {
  await session.signOut();
}
