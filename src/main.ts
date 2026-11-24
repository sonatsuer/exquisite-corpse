/** App shell: hash routing, screens, game flow. */
import { loadHalf, loadPicture, pairOf, publishHalf, type OnlineHalf } from './atproto/game.js';
import { isDid, isRkey, parseHalfUri, parseOnlineRoute, type RecordId } from './atproto/links.js';
import { parseHalfRecord, payloadOf, type HalfRecord } from './atproto/record.js';
import { getSession, onSessionChange, startSession } from './atproto/session.js';
import { DecodeError, decodePayload } from './codec.js';
import { DEFAULT_REVEAL, HALF_H, HALF_W, MAX_REVEAL, MIN_REVEAL } from './config.js';
import { crc32 } from './crc.js';
import { Editor, type HistoryEntry, type Tool } from './editor.js';
import { BRUSH_V1, hasInk, redraw, seamStrip } from './raster.js';
import { COLOR, fitCanvas, Painter } from './render.js';
import {
  chimeraLines,
  codeFromFile,
  download,
  linkLevel,
  linksFor,
  methodSummary,
  paintPage,
  pngFile,
  SendDialog,
  type SendSpec,
} from './share.js';
import { initAccountUI, OnlineBox, openSignIn, postPicture, renderMine, sessionForPosting, toast } from './online.js';
import { load, save } from './storage.js';
import { parseCode, toBase64Url } from './text.js';
import { otherSide, type ChimeraPayload, type HalfContent, type HalfPayload, type Payload, type Point, type Side, type Stroke } from './types.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- drafts & settings ----------

/** An online half remembered in a draft: the record id plus its content. */
interface StoredHalf {
  did: string;
  rkey: string;
  uri: string;
  cid: string;
  record: HalfRecord;
}

interface Draft {
  history: HistoryEntry[];
  reveal?: number;
  revealed?: boolean;
  /** A new half: its published copy, if any. */
  online?: StoredHalf;
  /** Completing an online half: your published answer, if any. */
  answer?: StoredHalf;
}

const storedOf = (h: OnlineHalf): StoredHalf => ({ did: h.id.did, rkey: h.id.rkey, uri: h.ref.uri, cid: h.ref.cid, record: h.record });

function validStored(x: unknown): StoredHalf | undefined {
  const v = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const record = parseHalfRecord(v.record);
  if (!record || typeof v.did !== 'string' || !isDid(v.did) || typeof v.rkey !== 'string' || !isRkey(v.rkey)) return undefined;
  if (typeof v.uri !== 'string' || typeof v.cid !== 'string') return undefined;
  return { did: v.did, rkey: v.rkey, uri: v.uri, cid: v.cid, record };
}

function fromStored(h: StoredHalf | undefined, author: string | null): OnlineHalf | null {
  if (!h) return null;
  try {
    return { id: { did: h.did, rkey: h.rkey }, ref: { uri: h.uri, cid: h.cid }, record: h.record, payload: payloadOf(h.record), author };
  } catch {
    return null;
  }
}

const isInt = (v: unknown): v is number => Number.isInteger(v);

function validStroke(x: unknown): Stroke | null {
  if (!x || typeof x !== 'object') return null;
  const { ink, size, pts } = x as Record<string, unknown>;
  if (typeof ink !== 'boolean' || !isInt(size) || size < 0 || size >= BRUSH_V1.length || !Array.isArray(pts)) return null;
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && isInt(p[0]) && isInt(p[1]))) return null;
  return { ink, size, pts: pts as Point[] };
}

/** Drafts come from storage, which anything could have written: keep only well-formed entries. */
function validDraft(x: unknown): Draft {
  const d = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const history: HistoryEntry[] = [];
  for (const h of Array.isArray(d.history) ? d.history : []) {
    const e = (h ?? {}) as Record<string, unknown>;
    if (e.kind === 'clear') history.push({ kind: 'clear' });
    const stroke = e.kind === 'stroke' ? validStroke(e.stroke) : null;
    if (stroke) history.push({ kind: 'stroke', stroke });
  }
  const reveal = isInt(d.reveal) ? Math.min(MAX_REVEAL, Math.max(MIN_REVEAL, d.reveal)) : undefined;
  return { history, reveal, revealed: d.revealed === true, online: validStored(d.online), answer: validStored(d.answer) };
}

const loadDraft = (key: string) => validDraft(load(key));
const updateDraft = (key: string, patch: Partial<Draft>) => save(key, { ...loadDraft(key), ...patch });
const signature = () => load<string>('signature') ?? '';
const setSignature = (s: string) => save('signature', s);

function contentFrom(history: HistoryEntry[], sig: string): HalfContent {
  const strokes: HalfContent['strokes'] = [];
  for (const h of history) {
    if (h.kind === 'clear') strokes.length = 0;
    else strokes.push(h.stroke);
  }
  return { bitmap: redraw(HALF_W, HALF_H, strokes), strokes, signature: sig };
}

// ---------- screens ----------

type ScreenName = 'home' | 'draw' | 'result' | 'loading' | 'mine';
let screen: ScreenName = 'home';
/** Increases on every navigation, so slow network answers for an old screen are dropped. */
let routeToken = 0;
let teardown: (() => void) | null = null;
const send = new SendDialog();

function show(name: ScreenName): void {
  teardown?.();
  teardown = null;
  screen = name;
  for (const s of ['home', 'draw', 'result', 'loading', 'mine'] as const) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo(0, 0);
}

function fitStage(canvas: HTMLCanvasElement, stage: HTMLElement, below: HTMLElement): void {
  const top = stage.getBoundingClientRect().top + window.scrollY;
  const maxH = Math.max(220, window.innerHeight - top - below.offsetHeight - 32);
  fitCanvas(canvas, stage.clientWidth, maxH);
  below.style.setProperty('--stage-w', canvas.style.width);
}

function showLoading(text: string): void {
  show('loading');
  $('loading-text').textContent = text;
  $('loading-error').hidden = true;
  $('loading-actions').hidden = true;
}

function showLoadError(text: string): void {
  show('loading');
  $('loading-text').textContent = '';
  const e = $('loading-error');
  e.textContent = text;
  e.hidden = false;
  $('loading-actions').hidden = false;
}

// ---------- home ----------

function showHome(error?: string): void {
  show('home');
  const box = $('home-error');
  box.hidden = !error;
  box.textContent = error ?? '';
  document.title = 'Exquisite Corpse';
}

/** Validate a code and navigate to it (in the canonical base64url form). */
function openCode(text: string): void {
  try {
    const bytes = parseCode(text);
    decodePayload(bytes);
    const hash = `#${toBase64Url(bytes)}`;
    if (location.hash === hash) route();
    else location.hash = hash;
  } catch (e) {
    showHome(e instanceof DecodeError ? e.message : 'Could not open this.');
  }
}

async function openFile(file: File): Promise<void> {
  try {
    openCode(await codeFromFile(file));
  } catch (e) {
    showHome(e instanceof Error ? e.message : 'Could not open this file.');
  }
}

$('open-form').addEventListener('submit', (e) => {
  e.preventDefault();
  openCode($<HTMLTextAreaElement>('open-input').value);
});
$<HTMLInputElement>('open-file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void openFile(file);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});

// ---------- drawing ----------

let editor: Editor | null = null;

interface DrawSetup {
  side: Side;
  draftKey: string;
  hint: string;
  other: HalfPayload | null;
  /** Completing an online half: its record. */
  online?: OnlineHalf;
}

function startDrawing(setup: DrawSetup): void {
  show('draw');
  const draft = loadDraft(setup.draftKey);
  const reveal = setup.other ? setup.other.reveal : (draft.reveal ?? DEFAULT_REVEAL);
  let sendReveal = reveal;
  const canvas = $<HTMLCanvasElement>('draw-canvas');
  const fresh = canvas.cloneNode() as HTMLCanvasElement; // drop old listeners
  canvas.replaceWith(fresh);
  let timer = 0;
  let revealed = false;
  let online = draft.online;
  const persist = () =>
    save(setup.draftKey, { history: ed.getHistory(), reveal: sendReveal, revealed, online, answer: draft.answer } satisfies Draft);
  const changed = () => {
    updateToolbar();
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      persist();
      updateMeter(setup, sendReveal);
    }, 150);
  };
  const ed = new Editor(fresh, { side: setup.side, other: setup.other?.half.bitmap ?? null, reveal, history: draft.history, onChange: changed });
  editor = ed;
  $('draw-hint').textContent = setup.hint;
  $('btn-send').hidden = !!setup.other;
  $('btn-unfold').hidden = !setup.other;

  // The visible strip is chosen while drawing a new half; when completing, the sender chose it.
  const slider = $<HTMLInputElement>('strip-reveal');
  $('strip-control').hidden = !!setup.other;
  slider.min = String(MIN_REVEAL);
  slider.max = String(MAX_REVEAL);
  const setReveal = (r: number) => {
    sendReveal = r;
    slider.value = String(r);
    $<HTMLOutputElement>('strip-reveal-out').value = `${r} px`;
    ed.setReveal(r);
  };
  setReveal(sendReveal);
  slider.oninput = () => {
    setReveal(Number(slider.value));
    changed();
  };

  updateToolbar();
  updateMeter(setup, sendReveal);
  const fit = () => fitStage(fresh, $('draw-stage'), $('draw-actions'));
  fit();
  window.addEventListener('resize', fit);

  const onSend = () =>
    openSend(
      { kind: 'half', side: setup.side, content: ed.content(signature()), reveal: sendReveal, signatureEditable: true },
      (s) => {
        setReveal(s.reveal);
        setSignature(s.signature);
        persist();
        updateMeter(setup, sendReveal);
      },
      new OnlineBox({
        published: fromStored(online, getSession()?.handle ?? null),
        link: 'half',
        editable: true,
        onSaved: (h) => {
          online = storedOf(h);
          persist();
        },
      }),
    );
  const onUnfold = async () => {
    const author = setup.online?.author ? `@${setup.online.author}` : 'the other artist';
    const saving = setup.online && getSession();
    const message = ed.isEmpty
      ? 'Your half is empty. Unfold the page anyway?'
      : saving
        ? `Unfold the page? Your half will be saved in your account (public), so ${author} can see the finished picture. You cannot change it after this.`
        : 'Unfold the page? You cannot change your half after this.';
    if (!(await confirmDialog(message, 'Unfold'))) return;
    ed.locked = true;
    revealed = true;
    persist();
    const mine = ed.content(signature());
    if (!setup.online) return showUnfolded(setup.other!, mine, true);
    let answer: OnlineHalf | null = null;
    if (saving) {
      const button = $<HTMLButtonElement>('btn-unfold');
      button.disabled = true;
      button.textContent = 'Saving…';
      answer = await publishAnswer(setup.online, mine).catch((e) => {
        toast(`Could not save your half online: ${e instanceof Error ? e.message : e}`, 9000);
        return null;
      });
      button.disabled = false;
      button.textContent = 'Unfold';
      if (answer) updateDraft(setup.draftKey, { answer: storedOf(answer) });
    }
    showUnfolded(setup.other!, mine, true, { challenge: setup.online, answer, draftKey: setup.draftKey });
  };
  $('btn-send').onclick = onSend;
  $('btn-unfold').onclick = () => void onUnfold();

  teardown = () => {
    clearTimeout(timer);
    persist();
    window.removeEventListener('resize', fit);
    ed.destroy();
    editor = null;
  };
}

function updateToolbar(): void {
  if (!editor) return;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === editor.tool));
  }
  const size = editor.sizes[editor.tool];
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-size]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.size) === size));
  }
  $<HTMLButtonElement>('btn-undo').disabled = !editor.canUndo;
  $<HTMLButtonElement>('btn-clear').disabled = editor.isEmpty;
}

/** One meter line: "<label>: 901 characters · short link: 387". */
function meterLine(label: string, p: Payload): HTMLSpanElement {
  const { link, shortLink } = linksFor(p);
  const part = (text: string) => {
    const s = document.createElement('span');
    s.className = 'part'; // never broken inside; lines wrap at the separator
    s.textContent = text;
    return s;
  };
  const line = document.createElement('span');
  line.append(part(`${label}: ${link.length.toLocaleString()} characters`), ' · ', part(`short link: ${shortLink.length.toLocaleString()}`));
  line.dataset.level = linkLevel(link.length);
  return line;
}

/** Link sizes under the canvas: the half you are drawing, or, when completing, the finished picture and your half. */
function updateMeter(setup: DrawSetup, reveal: number): void {
  if (!editor) return;
  const meter = $('meter');
  const note = $('strip-note');
  const mine = editor.content(signature());
  meter.title = editor.isEmpty ? '' : `Your half. ${methodSummary(mine)}`;
  if (setup.other) {
    note.hidden = true;
    const theirs = setup.other.half;
    const [left, right] = setup.side === 'left' ? [mine, theirs] : [theirs, mine];
    meter.replaceChildren(
      meterLine('Finished picture', { kind: 'chimera', left, right }),
      meterLine('Your half on its own', { kind: 'half', side: setup.side, reveal: DEFAULT_REVEAL, half: mine }),
    );
    return;
  }
  if (editor.isEmpty) {
    note.hidden = true;
    meter.textContent = 'Empty half';
    return;
  }
  note.hidden = hasInk(seamStrip(mine.bitmap, setup.side, reveal));
  meter.replaceChildren(meterLine('Link', { kind: 'half', side: setup.side, reveal, half: mine }));
}

function setTool(tool: Tool): void {
  if (!editor) return;
  editor.tool = tool;
  updateToolbar();
}

function setSize(size: number): void {
  if (!editor) return;
  editor.sizes[editor.tool] = Math.max(0, Math.min(BRUSH_V1.length - 1, size));
  updateToolbar();
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-size]')) b.addEventListener('click', () => setSize(Number(b.dataset.size)));
$('btn-undo').addEventListener('click', () => editor?.undo());
$('btn-clear').addEventListener('click', () => editor?.clear());

document.addEventListener('keydown', (e) => {
  if (screen !== 'draw' || !editor || document.querySelector('dialog[open]')) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    editor.undo();
  } else if (!mod && !e.altKey) {
    if (e.key === 'b' || e.key === 'B') setTool('pen');
    else if (e.key === 'e' || e.key === 'E') setTool('eraser');
    else if (e.key === '[') setSize(editor.sizes[editor.tool] - 1);
    else if (e.key === ']') setSize(editor.sizes[editor.tool] + 1);
  }
});

// ---------- results ----------

interface ResultAction {
  label: string;
  primary?: boolean;
  run: () => void | Promise<void>;
}

/**
 * The finished page. With `unfold`, it starts as the person completing it last
 * saw it: their half plus the strip, the rest of the other half folded away
 * behind the page. That part then swings out from behind, around the fold.
 */
function showResult(
  left: HalfContent,
  right: HalfContent,
  hint: string,
  actions: ResultAction[],
  unfold: { side: Side; reveal: number } | null,
): void {
  show('result');
  const canvas = $<HTMLCanvasElement>('result-canvas');
  const page = paintPage(left, right);
  const flap = $('result-flap');
  const timers: number[] = [];
  const finish = () => {
    page.toCanvas(canvas);
    flap.hidden = true;
    flap.className = 'flap';
  };
  if (!unfold) {
    finish();
  } else {
    // The page as it is while folded: the folded-away columns are empty.
    const foldW = HALF_W - unfold.reveal;
    const foldX = unfold.side === 'left' ? 0 : HALF_W + unfold.reveal;
    const folded = paintPage(left, right);
    folded.fill(foldX, 0, foldW, HALF_H, 0); // transparent
    folded.toCanvas(canvas);
    // The folded-away part, on its own surface, hinged at the fold.
    const other = unfold.side === 'left' ? left : right;
    const part = new Painter(foldW, HALF_H);
    part.bitmap(other.bitmap, 0, 0, COLOR.paper, COLOR.ink, unfold.side === 'left' ? 0 : unfold.reveal, foldW);
    part.toCanvas($<HTMLCanvasElement>('result-flap-canvas'));
    flap.className = `flap ${unfold.side}`;
    flap.style.left = `${(foldX / (2 * HALF_W)) * 100}%`;
    flap.style.width = `${(foldW / (2 * HALF_W)) * 100}%`;
    flap.hidden = false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      timers.push(window.setTimeout(finish, 400));
    } else {
      timers.push(window.setTimeout(() => flap.classList.add('open'), 700)); // show it folded first
      timers.push(window.setTimeout(finish, 700 + 1300));
    }
  }
  $('result-hint').textContent = hint;
  const bar = $('result-actions');
  bar.replaceChildren(
    ...actions.map((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      b.addEventListener('click', () => void a.run());
      return b;
    }),
  );
  const fit = () => fitStage(canvas, $('result-stage'), bar);
  fit();
  window.addEventListener('resize', fit);
  teardown = () => {
    timers.forEach(clearTimeout);
    finish();
    window.removeEventListener('resize', fit);
  };
}

async function downloadChimera(left: HalfContent, right: HalfContent): Promise<void> {
  const { code } = linksFor({ kind: 'chimera', left, right });
  download(await pngFile(paintPage(left, right), chimeraLines(left, right), code), 'exquisite-corpse-finished.png');
}

/** Your half as an answer to an online half, saved in your account. */
function publishAnswer(challenge: OnlineHalf, mine: HalfContent): Promise<OnlineHalf> {
  const s = getSession();
  if (!s) return Promise.reject(new Error('You are not signed in.'));
  const payload: HalfPayload = { kind: 'half', side: otherSide(challenge.payload.side), reveal: DEFAULT_REVEAL, half: mine };
  return publishHalf(s, payload, { answers: challenge.ref });
}

async function replyOnBluesky(picture: { answer: OnlineHalf; answered: OnlineHalf }): Promise<void> {
  const s = sessionForPosting();
  if (!s) return;
  try {
    await postPicture(s, picture);
    toast('Posted on Bluesky.');
  } catch (e) {
    toast(`Could not post on Bluesky: ${e instanceof Error ? e.message : e}`, 9000);
  }
}

interface OnlineUnfold {
  challenge: OnlineHalf;
  answer: OnlineHalf | null;
  draftKey: string;
}

/** After completing a challenge: the full picture, with ways to send it back or pass your half on. */
function showUnfolded(challenge: HalfPayload, mine: HalfContent, animate: boolean, online?: OnlineUnfold): void {
  const mySide = otherSide(challenge.side);
  const pair = () => {
    const me = { ...mine, signature: signature() };
    return mySide === 'left' ? { left: me, right: challenge.half } : { left: challenge.half, right: me };
  };
  const { left, right } = pair();
  if (online) return showUnfoldedOnline(online, pair, mySide, animate);
  const who = challenge.half.signature || 'the other artist';
  showResult(
    left,
    right,
    `Unfolded! Send the finished picture back to ${who}, or pass your ${mySide} half on to someone new.`,
    [
      {
        label: 'Send the picture…',
        primary: true,
        run: () => openSend({ kind: 'chimera', ...pair(), mySide }, (s) => setSignature(s.signature)),
      },
      {
        label: `Pass your ${mySide} half on…`,
        run: () =>
          openSend(
            { kind: 'half', side: mySide, content: pair()[mySide], reveal: DEFAULT_REVEAL, signatureEditable: true },
            (s) => setSignature(s.signature),
          ),
      },
      { label: 'Download picture', run: () => downloadChimera(pair().left, pair().right) },
      { label: 'New picture', run: () => void (location.hash = '#/') },
    ],
    animate ? { side: challenge.side, reveal: challenge.reveal } : null,
  );
}

function showUnfoldedOnline(
  online: OnlineUnfold,
  pair: () => { left: HalfContent; right: HalfContent },
  mySide: Side,
  animate: boolean,
): void {
  const { challenge, answer } = online;
  const who = challenge.author ? `@${challenge.author}` : 'the other artist';
  const { left, right } = pair();
  const actions: ResultAction[] = [];
  if (answer) {
    const picture = { answer, answered: challenge };
    actions.push({
      label: 'Send the picture…',
      primary: true,
      run: () =>
        openSend({ kind: 'chimera', ...pair(), mySide }, (s) => setSignature(s.signature), new OnlineBox({ published: answer, link: 'picture', editable: false, picture })),
    });
    if (challenge.record.announcement) actions.push({ label: 'Reply on Bluesky', run: () => replyOnBluesky(picture) });
    actions.push({
      label: `Pass your ${mySide} half on…`,
      run: () =>
        openSend(
          { kind: 'half', side: mySide, content: pair()[mySide], reveal: DEFAULT_REVEAL, signatureEditable: true },
          (s) => setSignature(s.signature),
          new OnlineBox({ published: answer, link: 'half', editable: true, onSaved: (h) => updateDraft(online.draftKey, { answer: storedOf(h) }) }),
        ),
    });
  } else {
    actions.push({
      label: 'Save online',
      primary: true,
      run: async () => {
        if (!getSession()) return openSignIn(location.hash, `Sign in to save your half online, so ${who} can see the finished picture.`);
        try {
          const a = await publishAnswer(challenge, pair()[mySide]);
          updateDraft(online.draftKey, { answer: storedOf(a) });
          toast('Saved online.');
          showUnfoldedOnline({ ...online, answer: a }, pair, mySide, false);
        } catch (e) {
          toast(`Could not save your half online: ${e instanceof Error ? e.message : e}`, 9000);
        }
      },
    });
    actions.push({ label: 'Send as a link…', run: () => openSend({ kind: 'chimera', ...pair(), mySide }, (s) => setSignature(s.signature)) });
  }
  actions.push({ label: 'Download picture', run: () => downloadChimera(pair().left, pair().right) });
  actions.push({ label: 'New picture', run: () => void (location.hash = '#/') });
  const hint = answer
    ? `Unfolded! Your half is saved online, and ${who} can see the finished picture in "My pictures". Send it, or pass your ${mySide} half on.`
    : `Unfolded! Save your half online so ${who} can see the finished picture, or send it as a link.`;
  showResult(left, right, hint, actions, animate ? { side: challenge.payload.side, reveal: challenge.payload.reveal } : null);
}

/** A finished picture saved online: an answer and the half it answers. */
async function openOnlinePicture(id: RecordId, token: number): Promise<void> {
  showLoading('Opening the picture…');
  let pic: Awaited<ReturnType<typeof loadPicture>>;
  try {
    pic = await loadPicture(id);
  } catch (e) {
    if (token === routeToken) showLoadError(e instanceof Error ? e.message : 'Could not open this picture.');
    return;
  }
  if (token !== routeToken) return;
  const { answer, answered } = pic;
  const { left, right } = pairOf(answer, answered);
  const leftHalf = answer.payload.side === 'left' ? answer : answered;
  const rightHalf = leftHalf === answer ? answered : answer;
  const names = [...new Set([answered.author, answer.author].filter((n): n is string => !!n))].map((n) => `@${n}`);
  document.title = 'A finished picture · Exquisite Corpse';
  const passOn = (h: OnlineHalf) => () =>
    openSend(
      { kind: 'half', side: h.payload.side, content: h.payload.half, reveal: h.payload.reveal, signatureEditable: false },
      () => {},
      new OnlineBox({ published: h, link: 'half', editable: false }),
    );
  showResult(
    left,
    right,
    `A finished picture${names.length ? ` by ${names.join(' and ')}` : ''}. You can pass either half on as a new challenge.`,
    [
      {
        label: 'Send this picture…',
        primary: true,
        run: () => openSend({ kind: 'chimera', left, right, mySide: null }, () => {}, new OnlineBox({ published: answer, link: 'picture', editable: false, picture: pic })),
      },
      { label: 'Pass the left half on…', run: passOn(leftHalf) },
      { label: 'Pass the right half on…', run: passOn(rightHalf) },
      { label: 'Download picture', run: () => downloadChimera(left, right) },
      { label: 'New picture', run: () => void (location.hash = '#/') },
    ],
    null,
  );
}

/** Someone's online half: draw the other half (or see the result, if you already did). */
async function openOnlineHalf(id: RecordId, token: number): Promise<void> {
  showLoading('Opening the half…');
  let half: OnlineHalf;
  try {
    half = await loadHalf(id);
  } catch (e) {
    if (token === routeToken) showLoadError(e instanceof Error ? e.message : 'Could not open this half.');
    return;
  }
  if (token !== routeToken) return;
  const payload = half.payload;
  const mySide = otherSide(payload.side);
  const draftKey = `draft:o:${id.did}:${id.rkey}`;
  const draft = loadDraft(draftKey);
  document.title = `Draw the ${mySide} half · Exquisite Corpse`;
  if (draft.revealed) {
    const answer = fromStored(draft.answer, getSession()?.handle ?? null);
    return showUnfolded(payload, contentFrom(draft.history, signature()), false, { challenge: half, answer, draftKey });
  }
  const own = getSession()?.did === id.did;
  const who = half.author ? `@${half.author}` : 'Someone';
  startDrawing({
    side: mySide,
    draftKey,
    other: payload,
    online: half,
    hint: own
      ? `This is your own ${payload.side} half. You can draw the ${mySide} half yourself, or send the link to someone.`
      : `${who} drew the ${payload.side} half and folded it away. You can only see the edge by the fold. Draw the ${mySide} half, then unfold the page.`,
  });
}

/** After deleting one of your halves: forget drafts that still point at it. */
function forgetDeleted(h: OnlineHalf): void {
  const same = (s?: StoredHalf) => s?.did === h.id.did && s.rkey === h.id.rkey;
  for (const side of ['left', 'right'] as const) {
    const key = `draft:new:${side}`;
    if (same(loadDraft(key).online)) updateDraft(key, { online: undefined });
  }
  const target = h.record.answers ? parseHalfUri(h.record.answers.uri) : null;
  if (target) {
    const key = `draft:o:${target.did}:${target.rkey}`;
    if (same(loadDraft(key).answer)) updateDraft(key, { answer: undefined });
  }
}

function showMine(token: number): void {
  show('mine');
  document.title = 'My pictures · Exquisite Corpse';
  void renderMine(() => token === routeToken && screen === 'mine', {
    share: (h) =>
      openSend(
        { kind: 'half', side: h.payload.side, content: h.payload.half, reveal: h.payload.reveal, signatureEditable: true },
        (s) => setSignature(s.signature),
        new OnlineBox({ published: h, link: 'half', editable: true }),
      ),
    confirm: confirmDialog,
    deleted: forgetDeleted,
  });
}

function showChimera(p: ChimeraPayload): void {
  const names = [p.left.signature, p.right.signature].filter(Boolean);
  showResult(
    p.left,
    p.right,
    `A finished picture${names.length ? ` by ${names.join(' and ')}` : ''}. You can pass either half on as a new challenge.`,
    [
      {
        label: 'Pass the left half on…',
        run: () => openSend({ kind: 'half', side: 'left', content: p.left, reveal: DEFAULT_REVEAL, signatureEditable: false }, () => {}),
      },
      {
        label: 'Pass the right half on…',
        run: () => openSend({ kind: 'half', side: 'right', content: p.right, reveal: DEFAULT_REVEAL, signatureEditable: false }, () => {}),
      },
      { label: 'Download picture', run: () => downloadChimera(p.left, p.right) },
      { label: 'New picture', primary: true, run: () => void (location.hash = '#/') },
    ],
    null,
  );
}

// ---------- dialogs ----------

function openSend(spec: SendSpec, onSettings: (s: { reveal: number; signature: string }) => void, online: OnlineBox | null = null): void {
  send.open(spec, { reveal: DEFAULT_REVEAL, signature: signature() }, onSettings, online);
}

function confirmDialog(message: string, ok: string): Promise<boolean> {
  const d = $<HTMLDialogElement>('confirm');
  $('confirm-text').textContent = message;
  $('confirm-ok').textContent = ok;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

// ---------- routing ----------

function route(): void {
  const token = ++routeToken;
  send.close();
  for (const id of ['confirm', 'signin']) {
    const d = $<HTMLDialogElement>(id);
    if (d.open) d.close();
  }
  const h = location.hash.slice(1);
  if (!h || h === '/') return showHome();
  if (h === '/mine') return showMine(token);
  const online = parseOnlineRoute(h);
  if (online) return void (online.kind === 'half' ? openOnlineHalf(online, token) : openOnlinePicture(online, token));
  const draw = /^\/draw\/(left|right)$/.exec(h);
  if (draw) {
    const side = draw[1] as Side;
    document.title = `Draw the ${side} half · Exquisite Corpse`;
    return startDrawing({
      side,
      draftKey: `draft:new:${side}`,
      other: null,
      hint: `Draw the ${side} half. The shaded strip by the fold is all the next person will see, so let some lines run into it.`,
    });
  }
  if (h.startsWith('/')) return showHome();

  let payload;
  let bytes: Uint8Array;
  try {
    bytes = parseCode(h);
    payload = decodePayload(bytes);
  } catch (e) {
    return showHome(e instanceof DecodeError ? e.message : 'Could not open this link.');
  }
  if (payload.kind === 'chimera') {
    document.title = 'A finished picture · Exquisite Corpse';
    return showChimera(payload);
  }
  const mySide = otherSide(payload.side);
  const draftKey = `draft:c:${crc32(bytes).toString(16)}`;
  const draft = loadDraft(draftKey);
  document.title = `Draw the ${mySide} half · Exquisite Corpse`;
  if (draft.revealed) return showUnfolded(payload, contentFrom(draft.history, signature()), false);
  const who = payload.half.signature || 'Someone';
  startDrawing({
    side: mySide,
    draftKey,
    other: payload,
    hint: `${who} drew the ${payload.side} half and folded it away. You can only see the edge by the fold. Draw the ${mySide} half, then unfold the page.`,
  });
}

// ---------- start ----------

initAccountUI();
onSessionChange(() => {
  if (screen === 'mine') showMine(++routeToken);
});
window.addEventListener('hashchange', route);
startSession()
  .catch(() => ({ returnTo: null, error: null }))
  .then(({ returnTo, error }) => {
    if (error) toast(error, 9000);
    if (returnTo && returnTo !== '#' && returnTo !== location.hash) location.hash = returnTo; // routes via hashchange
    else route();
  });
