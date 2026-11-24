/**
 * Optional Bluesky posts: an invitation that mentions friends (Bluesky then
 * notifies them), and a reply with the finished picture (which notifies the
 * first player). Only these use Bluesky's own record types.
 */
import type { StrongRef } from './record.js';
import { createRecord, uploadBlob, type Writer } from './write.js';

export const BSKY_POST = 'app.bsky.feed.post';

export type TextPart = string | { mention: string; did: string } | { link: string; uri: string };

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: ({ $type: 'app.bsky.richtext.facet#mention'; did: string } | { $type: 'app.bsky.richtext.facet#link'; uri: string })[];
}

const utf8 = new TextEncoder();

/** Post text plus facets. Facet positions are UTF-8 byte offsets, as Bluesky requires. */
export function richText(parts: TextPart[]): { text: string; facets: Facet[] } {
  let text = '';
  let bytes = 0;
  const facets: Facet[] = [];
  for (const part of parts) {
    const segment = typeof part === 'string' ? part : 'mention' in part ? `@${part.mention}` : part.link;
    const len = utf8.encode(segment).length;
    if (typeof part !== 'string') {
      const feature =
        'mention' in part
          ? ({ $type: 'app.bsky.richtext.facet#mention', did: part.did } as const)
          : ({ $type: 'app.bsky.richtext.facet#link', uri: part.uri } as const);
      facets.push({ index: { byteStart: bytes, byteEnd: bytes + len }, features: [feature] });
    }
    text += segment;
    bytes += len;
  }
  return { text, facets };
}

export interface ImagePost {
  parts: TextPart[];
  image: Blob;
  alt: string;
  width: number;
  height: number;
  reply?: { root: StrongRef; parent: StrongRef };
}

/** Publish a post with one image from the signed-in account. */
export async function postWithImage(w: Writer, post: ImagePost): Promise<StrongRef> {
  const blob = await uploadBlob(w, post.image);
  const { text, facets } = richText(post.parts);
  const record: Record<string, unknown> = {
    $type: BSKY_POST,
    text,
    facets,
    langs: ['en'],
    createdAt: new Date().toISOString(),
    embed: {
      $type: 'app.bsky.embed.images',
      images: [{ alt: post.alt, image: blob, aspectRatio: { width: post.width, height: post.height } }],
    },
  };
  if (post.reply) record.reply = post.reply;
  const { uri, cid } = await createRecord(w, BSKY_POST, record);
  return { uri, cid };
}
