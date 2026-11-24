/**
 * The online parts of the interface: the account in the header and on the
 * home page, the sign-in dialog, the "Online" section of the send dialog, and
 * the "My pictures" screen. Wording stays protocol-neutral ("internet
 * handle"); Bluesky appears only on the optional posting buttons.
 */
import { postWithImage, type TextPart } from './atproto/bsky.js';
import { deleteHalf, myGames, pairOf, publishHalf, updateHalf, type GameEntry, type OnlineHalf } from './atproto/game.js';
import { onlinePath, type RecordId } from './atproto/links.js';
import { normalizeHandle, resolveDid, resolveHandle, suggestHandles } from './atproto/net.js';
import { MAX_INVITES, type StrongRef } from './atproto/record.js';
import { getSession, onSessionChange, signIn, signOut, type Session } from './atproto/session.js';
import { encodePayload } from './codec.js';
import { bitmapsEqual } from './raster.js';
import { fitCanvas, type Painter } from './render.js';
import { chimeraLines, linkFor, paintChallenge, paintPage, pngImage, shareBase, type SendExtension } from './share.js';
import { load, save } from './storage.js';
import { toBase64Url } from './text.js';
import { otherSide, type Payload } from './types.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const onlineLink = (kind: 'half' | 'picture', id: RecordId): string => linkFor(onlinePath({ kind, ...id }));

// ---------- toast ----------

let toastTimer = 0;

export function toast(text: string, ms = 6000): void {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

// ---------- account & sign-in ----------

let signInTarget = { returnTo: '#/', bluesky: false };

function renderAccount(): void {
  const s = getSession();
  const name = s ? `@${s.handle ?? s.did}` : '';
  $('account-signin').hidden = !!s;
  const mine = $<HTMLAnchorElement>('account-mine');
  mine.hidden = !s;
  mine.textContent = name;
  mine.title = 'My pictures';
  $('home-online-out').hidden = !!s;
  $('home-online-in').hidden = !s;
  $('home-handle').textContent = name;
}

/** Ask for a handle, then go to that account's sign-in page; come back to `returnTo`. */
export function openSignIn(returnTo = location.hash || '#/', why = '', bluesky = false): void {
  signInTarget = { returnTo, bluesky };
  const whyEl = $('signin-why');
  whyEl.textContent = why;
  whyEl.hidden = !why;
  $('signin-error').hidden = true;
  const input = $<HTMLInputElement>('signin-handle');
  input.value = getSession()?.handle ?? load<string>('last-handle') ?? '';
  const go = $<HTMLButtonElement>('signin-go');
  go.disabled = false;
  go.textContent = 'Sign in';
  const d = $<HTMLDialogElement>('signin');
  if (!d.open) d.showModal();
  input.focus();
}

async function submitSignIn(e: Event): Promise<void> {
  e.preventDefault();
  const input = $<HTMLInputElement>('signin-handle');
  const err = $('signin-error');
  const handle = normalizeHandle(input.value);
  if (!handle) {
    err.textContent = 'That does not look like a handle. Handles look like alice.bsky.social.';
    err.hidden = false;
    return;
  }
  save('last-handle', handle);
  const go = $<HTMLButtonElement>('signin-go');
  go.disabled = true;
  go.textContent = 'Opening your account…';
  try {
    await signIn(handle, signInTarget.returnTo, signInTarget.bluesky);
  } catch (ex) {
    err.textContent = `Could not start signing in: ${errorText(ex)}`;
    err.hidden = false;
    go.disabled = false;
    go.textContent = 'Sign in';
  }
}

export function initAccountUI(): void {
  $('account-signin').addEventListener('click', () => openSignIn());
  $('home-signin').addEventListener('click', () => openSignIn());
  $('mine-signin').addEventListener('click', () => openSignIn('#/mine'));
  $('signin-cancel').addEventListener('click', () => $<HTMLDialogElement>('signin').close());
  $('signin-form').addEventListener('submit', (e) => void submitSignIn(e));
  $('mine-signout').addEventListener('click', () => {
    void signOut().then(() => {
      toast('Signed out.');
      location.hash = '#/';
    });
  });
  onSessionChange(() => {
    renderAccount();
    activeBox?.refresh();
  });
  renderAccount();
}

// ---------- Bluesky posts (optional) ----------

/** Announce one of your halves on Bluesky, mentioning the people it invites. */
export async function postHalf(s: Session, half: OnlineHalf): Promise<StrongRef> {
  const p = half.payload;
  const other = otherSide(p.side);
  const invited = await Promise.all(
    (half.record.invite ?? []).map(async (did) => ({ did, handle: (await resolveDid(did).catch(() => null))?.handle ?? null })),
  );
  const mentions = invited.filter((m): m is { did: string; handle: string } => !!m.handle).slice(0, 8);
  const parts: TextPart[] = [];
  for (const m of mentions) parts.push({ mention: m.handle, did: m.did }, ' ');
  parts.push(`I drew the ${p.side} half of a picture and folded it away. `);
  parts.push(mentions.length ? `Your turn: draw the ${other} half! ` : `Who will draw the ${other} half? `);
  parts.push({ link: 'Open the game', uri: onlineLink('half', half.id) });
  const img = await pngImage(
    paintChallenge(p.half, p.side, p.reveal),
    [`Exquisite Corpse: the ${p.side} half, folded away.`, `Draw the ${other} half at ${shareBase()}`],
    toBase64Url(encodePayload(p)),
  );
  return postWithImage(s, {
    parts,
    image: img.blob,
    alt: `A folded page: only a thin strip of the ${p.side} half of a drawing is visible.`,
    width: img.width,
    height: img.height,
  });
}

/** Share a finished picture on Bluesky: a reply to the half's announcement if it had one, mentioning the other artist. */
export async function postPicture(s: Session, picture: { answer: OnlineHalf; answered: OnlineHalf }): Promise<StrongRef> {
  const { answer, answered } = picture;
  const { left, right } = pairOf(answer, answered);
  const other = answered.id.did === s.did ? answer : answered;
  const parts: TextPart[] = [];
  if (other.id.did !== s.did && other.author) parts.push({ mention: other.author, did: other.id.did }, ' ');
  parts.push('Unfolded! Here is our exquisite corpse. ', { link: 'See it in the game', uri: onlineLink('picture', answer.id) });
  const img = await pngImage(paintPage(left, right), chimeraLines(left, right), toBase64Url(encodePayload({ kind: 'chimera', left, right })));
  const ann = answered.record.announcement;
  return postWithImage(s, {
    parts,
    image: img.blob,
    alt: 'A finished exquisite corpse: two halves of a picture, drawn by two people without seeing each other.',
    width: img.width,
    height: img.height,
    ...(ann ? { reply: { root: ann, parent: ann } } : {}),
  });
}

/** Ensure there is a session that may post on Bluesky; otherwise ask to sign in with that permission. */
export function sessionForPosting(): Session | null {
  const s = getSession();
  if (s?.canPost) return s;
  openSignIn(
    location.hash || '#/',
    s
      ? 'Posting on Bluesky needs one more permission. You will be asked to allow it; then press the button again.'
      : 'Sign in to post on Bluesky.',
    true,
  );
  return null;
}

// ---------- the "Online" section of the send dialog ----------

export interface OnlineContext {
  /** The record behind what is being sent, once it exists. */
  published: OnlineHalf | null;
  /** What the online link opens: drawing the other half, or the finished picture. */
  link: 'half' | 'picture';
  /** Whether the signed-in player may publish or change this half (it is theirs). */
  editable: boolean;
  /** For a finished picture: its two halves (for the Bluesky post). */
  picture?: { answer: OnlineHalf; answered: OnlineHalf };
  /** Called whenever the record was created or changed. */
  onSaved?: (h: OnlineHalf) => void;
}

let activeBox: OnlineBox | null = null;

export class OnlineBox implements SendExtension {
  private payload: () => Payload = () => {
    throw new Error('not attached');
  };
  private readonly known = new Map<string, string>();
  private timer = 0;

  constructor(private readonly ctx: OnlineContext) {}

  attach(payload: () => Payload): void {
    this.payload = payload;
    activeBox = this;
    const input = $<HTMLInputElement>('send-invite');
    input.value = '';
    input.oninput = () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.suggest(), 200);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Escape' && !$('send-invite-suggest').hidden) {
        e.preventDefault();
        this.hideSuggestions();
      }
    };
    $('send-online-signin').onclick = () => openSignIn(location.hash || '#/', 'Sign in to save this half online.');
    $('send-publish').onclick = () => void this.publish();
    $('send-online-copy').onclick = () => void this.copy();
    $('send-bluesky').onclick = () => void this.bluesky();
    this.msg('');
    this.render();
  }

  detach(): void {
    if (activeBox === this) activeBox = null;
    clearTimeout(this.timer);
    this.hideSuggestions();
  }

  refresh(): void {
    if (activeBox === this) this.render();
  }

  private msg(text: string): void {
    $('send-online-msg').textContent = text;
  }

  private render(): void {
    const s = getSession();
    const pub = this.ctx.published;
    const p = this.payload();
    const canEdit = this.ctx.editable && p.kind === 'half';
    $('send-online-out').hidden = !(canEdit && !s);
    $('send-online-invite-row').hidden = !(canEdit && s);
    $('send-publish-row').hidden = !(canEdit && s);
    $('send-online-public').hidden = !canEdit;
    const changed = this.differs();
    $('send-publish').textContent = !pub ? 'Publish online' : changed ? 'Publish as a new half' : 'Save invitations';
    if (changed) {
      this.msg('This differs from the half you published (the drawing, strip width or signature). Published halves never change, so publish this as a new half. The earlier half and its finished pictures stay as they are; you can delete the half in "My pictures".');
    }
    // Never offer to share a published half that differs from what is being sent.
    $('send-online-link-row').hidden = !pub || changed;
    if (pub) $<HTMLInputElement>('send-online-link').value = onlineLink(this.ctx.link, pub.id);
    const ann = this.ctx.picture?.answered.record.announcement;
    $('send-bluesky').textContent = ann ? 'Reply on Bluesky' : 'Post on Bluesky';
    void this.renderInvited();
  }

  /** Does the half being sent differ from the published one (drawing, strip width or signature)? */
  private differs(): boolean {
    const pub = this.ctx.published;
    const p = this.payload();
    if (!pub || p.kind !== 'half') return false;
    return !bitmapsEqual(p.half.bitmap, pub.payload.half.bitmap) || toBase64Url(encodePayload(p)) !== pub.record.picture;
  }

  /** The people this half invites, each with a button to take the invitation back. */
  private async renderInvited(): Promise<void> {
    const el = $('send-invited');
    const pub = this.ctx.published;
    const dids = pub?.record.invite ?? [];
    el.textContent = 'Invited people find this half under "My pictures" when they sign in.';
    if (!pub || !dids.length) return;
    const names = await Promise.all(dids.map((d) => resolveDid(d).then((i) => `@${i.handle ?? d}`, () => d)));
    if (activeBox !== this || this.ctx.published !== pub) return;
    const chips = names.map((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `${name} ×`;
      b.title = `Remove the invitation for ${name}`;
      b.setAttribute('aria-label', `Remove the invitation for ${name}`);
      b.onclick = () => void this.uninvite(dids[i]!, name);
      return b;
    });
    el.replaceChildren('Invited: ', ...chips);
  }

  private async uninvite(did: string, name: string): Promise<void> {
    const s = getSession();
    const pub = this.ctx.published;
    if (!s || !pub) return openSignIn(location.hash || '#/', 'Sign in to change the invitations.');
    try {
      const h = await updateHalf(s, pub, { invite: (pub.record.invite ?? []).filter((d) => d !== did) });
      this.ctx.published = h;
      this.ctx.onSaved?.(h);
      this.msg(`Removed the invitation for ${name}.`);
    } catch (e) {
      this.msg(`Could not remove the invitation: ${errorText(e)}`);
    }
    this.render();
  }

  private busy<T>(id: string, text: string, work: () => Promise<T>): Promise<T | undefined> {
    const b = $<HTMLButtonElement>(id);
    const label = b.textContent ?? '';
    b.disabled = true;
    b.textContent = text;
    return work()
      .catch((e) => {
        this.msg(errorText(e));
        return undefined;
      })
      .finally(() => {
        b.disabled = false;
        b.textContent = label;
        this.render();
      });
  }

  private async readInvites(): Promise<string[]> {
    const tokens = $<HTMLInputElement>('send-invite').value.split(/[\s,;]+/).filter(Boolean);
    const dids: string[] = [];
    const missing: string[] = [];
    for (const t of tokens) {
      const h = normalizeHandle(t);
      const did = h ? (this.known.get(h) ?? (await resolveHandle(h).catch(() => null))) : null;
      if (did) dids.push(did);
      else missing.push(t);
    }
    if (missing.length) throw new Error(`Could not find ${missing.join(', ')}. Check the spelling, e.g. bob.bsky.social.`);
    return dids;
  }

  private async publish(): Promise<void> {
    const s = getSession();
    if (!s) return openSignIn(location.hash || '#/', 'Sign in to save this half online.');
    const p = this.payload();
    if (p.kind !== 'half') return;
    await this.busy('send-publish', 'Saving…', async () => {
      const invite = await this.readInvites();
      const pub = this.ctx.published;
      const merged = [...new Set([...(pub?.record.invite ?? []), ...invite])].slice(0, MAX_INVITES);
      const fresh = !pub || this.differs();
      const h = fresh ? await publishHalf(s, p, { invite: merged }) : await updateHalf(s, pub, { invite: merged });
      this.ctx.published = h;
      this.ctx.onSaved?.(h);
      $<HTMLInputElement>('send-invite').value = '';
      this.msg(fresh ? 'Published. Copy the online link, or post it on Bluesky.' : 'Saved.');
    });
  }

  private async copy(): Promise<void> {
    const link = $<HTMLInputElement>('send-online-link').value;
    try {
      await navigator.clipboard.writeText(link);
      this.msg('Online link copied.');
    } catch {
      $<HTMLInputElement>('send-online-link').select();
      this.msg('Press Ctrl+C (or ⌘C) to copy the selected link.');
    }
  }

  private async bluesky(): Promise<void> {
    const s = sessionForPosting();
    if (!s) return;
    await this.busy('send-bluesky', 'Posting…', async () => {
      if (this.ctx.picture) {
        await postPicture(s, this.ctx.picture);
      } else {
        const pub = this.ctx.published;
        if (!pub) return;
        const post = await postHalf(s, pub);
        if (this.ctx.editable && pub.id.did === s.did) {
          const h = await updateHalf(s, pub, { announcement: post });
          this.ctx.published = h;
          this.ctx.onSaved?.(h);
        }
      }
      this.msg('Posted on Bluesky.');
    });
  }

  private async suggest(): Promise<void> {
    const input = $<HTMLInputElement>('send-invite');
    const tokens = input.value.split(/[\s,;]+/);
    const last = tokens[tokens.length - 1] ?? '';
    const found = await suggestHandles(last);
    if (activeBox !== this || !found.length) return this.hideSuggestions();
    const list = $('send-invite-suggest');
    list.replaceChildren(
      ...found.map((a) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.textContent = a.displayName ? `${a.displayName} · @${a.handle}` : `@${a.handle}`;
        b.onclick = () => {
          this.known.set(a.handle, a.did);
          tokens[tokens.length - 1] = a.handle;
          input.value = `${tokens.filter(Boolean).join(', ')}, `;
          this.hideSuggestions();
          input.focus();
        };
        li.append(b);
        return li;
      }),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  private hideSuggestions(): void {
    $('send-invite-suggest').hidden = true;
    $('send-invite').setAttribute('aria-expanded', 'false');
  }
}

// ---------- "My pictures" ----------

function thumbnail(p: Painter): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'pixels';
  p.toCanvas(c);
  fitCanvas(c, 240, 180);
  return c;
}

const date = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** What the "My pictures" screen needs from the app shell. */
export interface MineActions {
  share: (h: OnlineHalf) => void;
  confirm: (message: string, ok: string) => Promise<boolean>;
  /** A half of yours was deleted (so drafts pointing at it can be forgotten). */
  deleted: (h: OnlineHalf) => void;
}

/** What deleting `mine` (part of `entry`) takes away, in words. */
function deleteMessage(entry: GameEntry, mine: OnlineHalf): string {
  const side = mine.payload.side;
  let text: string;
  if (entry.kind !== 'finished') {
    text = `Delete your ${side} half from your account? Its link will stop working.`;
  } else if (entry.answer === mine) {
    const other = entry.answered.author ? `@${entry.answered.author}` : 'the other artist';
    text = `Delete your ${side} half of this picture from your account? The finished picture disappears for both of you, and its links stop working. ${other}'s half stays in their account.`;
  } else {
    text = `Delete your ${side} half from your account? Every finished picture made from it disappears, for you and for whoever answered it, and its links stop working. Their halves stay in their accounts.`;
  }
  if (mine.record.announcement) text += ' The Bluesky post about it stays: delete that in Bluesky.';
  return `${text} This cannot be undone.`;
}

function deleteButton(entry: GameEntry, mine: OnlineHalf, actions: MineActions, reload: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'delete';
  b.textContent = 'Delete';
  b.onclick = async () => {
    const s = getSession();
    if (!s) return openSignIn('#/mine', 'Sign in to delete your halves.');
    if (!(await actions.confirm(deleteMessage(entry, mine), 'Delete'))) return;
    b.disabled = true;
    b.textContent = 'Deleting…';
    try {
      await deleteHalf(s, mine);
      actions.deleted(mine);
      toast('Deleted.');
      reload();
    } catch (e) {
      toast(`Could not delete: ${errorText(e)}`, 9000);
      b.disabled = false;
      b.textContent = 'Delete';
    }
  };
  return b;
}

function card(entry: GameEntry, me: string, actions: MineActions, reload: () => void): HTMLLIElement {
  const li = document.createElement('li');
  const caption = document.createElement('p');
  caption.className = 'fine';
  let art: HTMLCanvasElement;
  let href: string | null = null;
  /** The half in this entry that is a record in your own account, if any. */
  let mine: OnlineHalf | null = null;
  if (entry.kind === 'finished') {
    mine = entry.answer.id.did === me ? entry.answer : entry.answered.id.did === me ? entry.answered : null;
    const { left, right } = pairOf(entry.answer, entry.answered);
    art = thumbnail(paintPage(left, right));
    const other = entry.answered.id.did === me ? entry.answer : entry.answered;
    caption.textContent = `With @${other.author ?? 'someone'} · ${date(entry.answer.record.createdAt)}`;
    href = `#${onlinePath({ kind: 'picture', ...entry.answer.id })}`;
  } else {
    const p = entry.half.payload;
    art = thumbnail(paintChallenge(p.half, p.side, p.reveal));
    caption.textContent =
      entry.kind === 'waiting'
        ? `@${entry.half.author ?? 'someone'} drew the ${p.side} half. Draw the ${otherSide(p.side)} half.`
        : `Your ${p.side} half, waiting for someone to draw the ${otherSide(p.side)} half · ${date(entry.half.record.createdAt)}`;
    if (entry.kind === 'waiting') href = `#${onlinePath({ kind: 'half', ...entry.half.id })}`;
    else mine = entry.half;
  }
  const box = document.createElement('div');
  box.className = 'tile';
  const buttons = document.createElement('div');
  buttons.className = 'row tile-actions';
  if (href) {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'tile-main';
    a.append(art, caption);
    box.append(a);
  } else {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Share…';
    b.onclick = () => entry.kind === 'open' && actions.share(entry.half);
    box.append(art, caption);
    buttons.append(b);
  }
  if (mine) buttons.append(deleteButton(entry, mine, actions, reload));
  if (buttons.childElementCount) box.append(buttons);
  li.append(box);
  return li;
}

/** Fill the "My pictures" screen. `isCurrent` turns false when the player navigates away meanwhile. */
export async function renderMine(isCurrent: () => boolean, actions: MineActions): Promise<void> {
  const s = getSession();
  $('mine-signed-out').hidden = !!s;
  $('mine-lists').hidden = !s;
  $('mine-signout').hidden = !s;
  $('mine-who').textContent = s ? `Signed in as @${s.handle ?? s.did}` : '';
  const status = $('mine-status');
  const waiting = $('mine-waiting');
  const pictures = $('mine-pictures');
  waiting.replaceChildren();
  pictures.replaceChildren();
  $('mine-waiting-empty').hidden = true;
  $('mine-pictures-empty').hidden = true;
  if (!s) {
    status.textContent = '';
    return;
  }
  status.textContent = 'Loading your pictures…';
  let games: Awaited<ReturnType<typeof myGames>>;
  try {
    games = await myGames(s.did, s.handle);
  } catch (e) {
    if (isCurrent()) status.textContent = `Could not load your pictures: ${errorText(e)}`;
    return;
  }
  if (!isCurrent()) return;
  const reload = () => {
    if (isCurrent()) void renderMine(isCurrent, actions);
  };
  waiting.replaceChildren(...games.waiting.map((g) => card(g, s.did, actions, reload)));
  pictures.replaceChildren(...games.pictures.map((g) => card(g, s.did, actions, reload)));
  $('mine-waiting-empty').hidden = games.waiting.length > 0;
  $('mine-pictures-empty').hidden = games.pictures.length > 0;
  status.textContent = games.indexOk
    ? ''
    : 'Some invitations or answers may be missing: the index that finds them (Constellation) could not be reached. Try again later.';
}
