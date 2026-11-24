import assert from 'node:assert/strict';
import { test } from 'node:test';
import { richText } from '../src/atproto/bsky.js';
import { deleteHalf, loadHalf, loadPicture, myGames, pairOf, publishHalf, updateHalf } from '../src/atproto/game.js';
import { halfUri, isDid, NSID_HALF, onlinePath, parseHalfUri, parseOnlineRoute } from '../src/atproto/links.js';
import { identityFromDoc, normalizeHandle, resolveHandle, type Fetch } from '../src/atproto/net.js';
import { buildHalfRecord, parseHalfRecord, payloadOf } from '../src/atproto/record.js';
import type { Writer } from '../src/atproto/write.js';
import { bitmapsEqual } from '../src/raster.js';
import type { HalfPayload } from '../src/types.js';
import { drawing, PROFILES } from './fixtures.js';

const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const half = (side: 'left' | 'right', seed: number): HalfPayload => ({ kind: 'half', side, reveal: 12, half: drawing(seed, PROFILES.light!) });

test('online routes and AT URIs round-trip and reject junk', () => {
  const r = { kind: 'half' as const, did: ALICE, rkey: '3kabc2def' };
  assert.deepEqual(parseOnlineRoute(onlinePath(r)), r);
  assert.deepEqual(parseOnlineRoute('/picture/did:web:example.com/xyz'), { kind: 'picture', did: 'did:web:example.com', rkey: 'xyz' });
  for (const bad of ['/half/did:plc:short/x', '/half/alice/x', '/draw/left', '/half/' + ALICE, '/half/' + ALICE + '/a/b', '/half/' + ALICE + '/..']) {
    assert.equal(parseOnlineRoute(bad), null, bad);
  }
  assert.deepEqual(parseHalfUri(halfUri({ did: ALICE, rkey: 'k1' })), { did: ALICE, rkey: 'k1' });
  assert.equal(parseHalfUri(`at://${ALICE}/app.bsky.feed.post/k1`), null);
  assert.ok(isDid(ALICE) && !isDid('did:plc:UPPERCASEAAAAAAAAAAAAAAA'));
});

test('half records: build, parse (ignoring junk) and decode', () => {
  const p = half('left', 1);
  const rec = buildHalfRecord(p, { invite: [BOB, BOB, 'not-a-did'], answers: { uri: halfUri({ did: BOB, rkey: 'r' }), cid: 'bafy' } });
  assert.equal(rec.$type, NSID_HALF);
  assert.deepEqual(rec.invite, [BOB]);
  const parsed = parseHalfRecord(JSON.parse(JSON.stringify(rec)))!;
  assert.ok(parsed);
  const back = payloadOf(parsed);
  assert.equal(back.side, 'left');
  assert.ok(bitmapsEqual(back.half.bitmap, p.half.bitmap));
  assert.equal(parseHalfRecord({ picture: 42, createdAt: 'x' }), null);
  assert.equal(parseHalfRecord(null), null);
  const odd = parseHalfRecord({ ...rec, answers: { uri: 'https://evil.example', cid: 'x' }, invite: 'nope' })!;
  assert.equal(odd.answers, undefined);
  assert.equal(odd.invite, undefined);
  assert.throws(() => payloadOf({ picture: 'AAAA', createdAt: '' }));
});

test('post text: facet positions are UTF-8 byte offsets', () => {
  const { text, facets } = richText([{ mention: 'zoë.example', did: BOB }, ' 🎨 draw: ', { link: 'open', uri: 'https://x.test/#/half/a/b' }]);
  assert.equal(text, '@zoë.example 🎨 draw: open');
  const bytes = new TextEncoder().encode(text);
  const slice = (i: number) => new TextDecoder().decode(bytes.slice(facets[i]!.index.byteStart, facets[i]!.index.byteEnd));
  assert.equal(slice(0), '@zoë.example');
  assert.equal(slice(1), 'open');
  assert.equal(facets[0]!.features[0]!.$type, 'app.bsky.richtext.facet#mention');
});

test('identity: DID documents and handles', () => {
  const doc = {
    id: ALICE,
    alsoKnownAs: ['at://alice.test'],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test/' }],
  };
  assert.deepEqual(identityFromDoc(ALICE, doc), { did: ALICE, pds: 'https://pds.test', handle: 'alice.test' });
  assert.throws(() => identityFromDoc(BOB, doc));
  assert.equal(normalizeHandle(' @Alice.Bsky.Social '), 'alice.bsky.social');
  assert.equal(normalizeHandle('not a handle'), null);
});

/** A fake network: a PLC directory, PDSes holding records, Constellation, DNS. */
function fakeNetwork(records: Map<string, { cid: string; value: unknown }>, backlinkIndex: Record<string, { did: string; collection: string; rkey: string }[]> = {}) {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const f: Fetch = async (input) => {
    const url = new URL(input);
    if (url.host === 'plc.directory') {
      const did = url.pathname.slice(1);
      return json({ id: did, alsoKnownAs: [`at://${did === ALICE ? 'alice' : 'bob'}.test`], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test' }] });
    }
    if (url.pathname === '/xrpc/com.atproto.repo.getRecord') {
      const uri = `at://${url.searchParams.get('repo')}/${url.searchParams.get('collection')}/${url.searchParams.get('rkey')}`;
      const r = records.get(uri);
      return r ? json({ uri, ...r }) : json({ error: 'RecordNotFound', message: 'Could not locate record' }, 400);
    }
    if (url.pathname === '/xrpc/com.atproto.repo.listRecords') {
      const prefix = `at://${url.searchParams.get('repo')}/${url.searchParams.get('collection')}/`;
      return json({ records: [...records].filter(([u]) => u.startsWith(prefix)).map(([uri, r]) => ({ uri, ...r })) });
    }
    if (url.pathname === '/xrpc/blue.microcosm.links.getBacklinks') {
      return json({ records: backlinkIndex[`${url.searchParams.get('subject')}|${url.searchParams.get('source')}`] ?? [] });
    }
    if (url.host === 'cloudflare-dns.com') return json({ Answer: [{ data: '"did=' + BOB + '"' }] });
    return new Response('not found', { status: 404 });
  };
  return f;
}

/** A fake signed-in account that stores records in the same map. */
function fakeWriter(did: string, records: Map<string, { cid: string; value: unknown }>): Writer & { handle: string } {
  let n = 0;
  return {
    did,
    handle: did === ALICE ? 'alice.test' : 'bob.test',
    async fetchHandler(path, init) {
      const body = JSON.parse(String(init?.body));
      if (path === '/xrpc/com.atproto.repo.deleteRecord') {
        records.delete(`at://${did}/${body.collection}/${body.rkey}`);
        return new Response('{}', { status: 200 });
      }
      const rkey = body.rkey ?? `rk${++n}`;
      const uri = `at://${did}/${body.collection}/${rkey}`;
      const cid = `cid-${rkey}-${n}`;
      records.set(uri, { cid, value: body.record });
      assert.ok(path === '/xrpc/com.atproto.repo.createRecord' || path === '/xrpc/com.atproto.repo.putRecord');
      return new Response(JSON.stringify({ uri, cid }), { status: 200 });
    },
  };
}

test('publish, answer, invite and update halves; load the finished picture', async () => {
  const records = new Map<string, { cid: string; value: unknown }>();
  const alice = fakeWriter(ALICE, records);
  const bob = fakeWriter(BOB, records);
  const challenge = await publishHalf(alice, half('left', 2), { invite: [BOB] });
  assert.equal(challenge.id.did, ALICE);
  const answer = await publishHalf(bob, half('right', 3), { answers: challenge.ref });
  const f = fakeNetwork(records);
  const pic = await loadPicture(answer.id, f);
  assert.equal(pic.answered.author, 'alice.test');
  const { left, right } = pairOf(pic.answer, pic.answered);
  assert.ok(bitmapsEqual(left.bitmap, challenge.payload.half.bitmap));
  assert.ok(bitmapsEqual(right.bitmap, answer.payload.half.bitmap));
  // Updating keeps the record key and the links.
  const updated = await updateHalf(alice, challenge, { invite: [BOB, ALICE] });
  assert.equal(updated.id.rkey, challenge.id.rkey);
  await assert.rejects(updateHalf(bob, challenge, {}), /author/);
  // A half that answers nothing is not a picture.
  await assert.rejects(loadPicture(challenge.id, f), /does not complete/);
  await assert.rejects(loadPicture({ did: ALICE, rkey: 'missing' }, f), /does not exist/);
});

test('"My pictures": waiting invitations, open halves and finished pictures', async () => {
  const records = new Map<string, { cid: string; value: unknown }>();
  const alice = fakeWriter(ALICE, records);
  const bob = fakeWriter(BOB, records);
  const invite = await publishHalf(alice, half('left', 4), { invite: [BOB] }); // Bob is invited
  const open = await publishHalf(bob, half('right', 5)); // Bob's own open half
  const answered = await publishHalf(alice, half('left', 6)); // Bob will answer this
  const answer = await publishHalf(bob, half('right', 7), { answers: answered.ref });
  const index = {
    [`${BOB}|${NSID_HALF}:invite[]`]: [{ did: ALICE, collection: NSID_HALF, rkey: invite.id.rkey }],
    [`${halfUri(open.id)}|${NSID_HALF}:answers.uri`]: [],
  };
  const games = await myGames(BOB, 'bob.test', fakeNetwork(records, index));
  assert.equal(games.indexOk, true);
  assert.deepEqual(games.waiting.map((g) => g.kind === 'waiting' && g.half.id.rkey), [invite.id.rkey]);
  const kinds = games.pictures.map((g) => g.kind).sort();
  assert.deepEqual(kinds, ['finished', 'open']);
  const finished = games.pictures.find((g) => g.kind === 'finished');
  assert.ok(finished && finished.kind === 'finished' && finished.answer.id.rkey === answer.id.rkey);
});

test('handles resolve through DNS over HTTPS', async () => {
  const f = fakeNetwork(new Map());
  assert.equal(await resolveHandle('@Bob.Test', f), BOB);
  await assert.rejects(resolveHandle('no spaces allowed', f), /not a handle/);
});

test('hosted client metadata matches the app (address, return URL, permissions)', async () => {
  const { readFileSync } = await import('node:fs');
  const { SHARE_BASE } = await import('../src/config.js');
  const { SCOPE_BASIC, SCOPE_BLUESKY, SCOPE_FALLBACK } = await import('../src/atproto/session.js');
  const meta = JSON.parse(readFileSync('docs/client-metadata.json', 'utf8'));
  assert.equal(meta.client_id, `${SHARE_BASE}client-metadata.json`);
  assert.deepEqual(meta.redirect_uris, [SHARE_BASE]);
  assert.equal(meta.dpop_bound_access_tokens, true);
  const allowed = new Set(meta.scope.split(' '));
  for (const scope of [SCOPE_BASIC, SCOPE_BLUESKY, SCOPE_FALLBACK]) {
    for (const s of scope.split(' ')) assert.ok(allowed.has(s), `client metadata must allow "${s}"`);
  }
});

test('deleting your own half removes it; others cannot delete it', async () => {
  const records = new Map<string, { cid: string; value: unknown }>();
  const alice = fakeWriter(ALICE, records);
  const bob = fakeWriter(BOB, records);
  const h = await publishHalf(alice, half('left', 8));
  const answer = await publishHalf(bob, half('right', 9), { answers: h.ref });
  await assert.rejects(deleteHalf(bob, h), /Only the author/);
  await deleteHalf(alice, h);
  const f = fakeNetwork(records);
  await assert.rejects(loadHalf(h.id, f), /does not exist/);
  await assert.rejects(loadPicture(answer.id, f), /does not exist/); // the finished picture is gone too
});
