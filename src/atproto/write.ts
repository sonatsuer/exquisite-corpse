/**
 * Writing to the signed-in player's own repository. A `Writer` is anything
 * that can send authenticated requests to that account's PDS; in the app it
 * is the OAuth session, in tests a fake.
 */
import type { StrongRef } from './record.js';

export interface Writer {
  readonly did: string;
  fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
}

export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export class WriteError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WriteError';
  }
}

async function xrpcPost(w: Writer, method: string, body: BodyInit, contentType: string): Promise<unknown> {
  let res: Response;
  try {
    res = await w.fetchHandler(`/xrpc/${method}`, { method: 'POST', headers: { 'content-type': contentType }, body });
  } catch (e) {
    throw new WriteError(`Could not reach your data server: ${e instanceof Error ? e.message : e}`, 'Network', 0);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // keep {}
  }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : String(res.status);
    const message = typeof json.message === 'string' && json.message ? json.message : `Saving failed (${code}).`;
    throw new WriteError(message, code, res.status);
  }
  return json;
}

function strongRefFrom(v: unknown): StrongRef {
  const r = (v ?? {}) as Record<string, unknown>;
  if (typeof r.uri !== 'string' || typeof r.cid !== 'string') throw new WriteError('Your data server sent something unexpected.', 'BadResponse', 200);
  return { uri: r.uri, cid: r.cid };
}

const rkeyOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

export async function createRecord(w: Writer, collection: string, record: object): Promise<StrongRef & { rkey: string }> {
  const ref = strongRefFrom(await xrpcPost(w, 'com.atproto.repo.createRecord', JSON.stringify({ repo: w.did, collection, record }), 'application/json'));
  return { ...ref, rkey: rkeyOf(ref.uri) };
}

export async function putRecord(w: Writer, collection: string, rkey: string, record: object): Promise<StrongRef> {
  return strongRefFrom(await xrpcPost(w, 'com.atproto.repo.putRecord', JSON.stringify({ repo: w.did, collection, rkey, record }), 'application/json'));
}

export async function deleteRecord(w: Writer, collection: string, rkey: string): Promise<void> {
  await xrpcPost(w, 'com.atproto.repo.deleteRecord', JSON.stringify({ repo: w.did, collection, rkey }), 'application/json');
}

export async function uploadBlob(w: Writer, data: Blob): Promise<BlobRef> {
  const body = (await xrpcPost(w, 'com.atproto.repo.uploadBlob', data, data.type || 'application/octet-stream')) as { blob?: BlobRef };
  if (!body.blob || body.blob.$type !== 'blob') throw new WriteError('Your data server did not accept the image.', 'BadResponse', 200);
  return body.blob;
}
