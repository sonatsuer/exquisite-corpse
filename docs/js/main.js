/** App shell: hash routing, screens, game flow. */
import { DecodeError, decodePayload } from './codec.js';
import { DEFAULT_REVEAL, HALF_H, HALF_W, MAX_REVEAL, MIN_REVEAL } from './config.js';
import { crc32 } from './crc.js';
import { Editor } from './editor.js';
import { BRUSH_V1, hasInk, redraw, seamStrip } from './raster.js';
import { COLOR, fitCanvas, Painter } from './render.js';
import { chimeraLines, codeFromFile, download, linkLevel, linksFor, methodSummary, paintPage, pngFile, SendDialog, } from './share.js';
import { load, save } from './storage.js';
import { parseCode, toBase64Url } from './text.js';
import { otherSide } from './types.js';
const $ = (id) => document.getElementById(id);
const isInt = (v) => Number.isInteger(v);
function validStroke(x) {
    if (!x || typeof x !== 'object')
        return null;
    const { ink, size, pts } = x;
    if (typeof ink !== 'boolean' || !isInt(size) || size < 0 || size >= BRUSH_V1.length || !Array.isArray(pts))
        return null;
    if (!pts.every((p) => Array.isArray(p) && p.length === 2 && isInt(p[0]) && isInt(p[1])))
        return null;
    return { ink, size, pts: pts };
}
/** Drafts come from storage, which anything could have written: keep only well-formed entries. */
function validDraft(x) {
    const d = (x && typeof x === 'object' ? x : {});
    const history = [];
    for (const h of Array.isArray(d.history) ? d.history : []) {
        const e = (h ?? {});
        if (e.kind === 'clear')
            history.push({ kind: 'clear' });
        const stroke = e.kind === 'stroke' ? validStroke(e.stroke) : null;
        if (stroke)
            history.push({ kind: 'stroke', stroke });
    }
    const reveal = isInt(d.reveal) ? Math.min(MAX_REVEAL, Math.max(MIN_REVEAL, d.reveal)) : undefined;
    return { history, reveal, revealed: d.revealed === true };
}
const loadDraft = (key) => validDraft(load(key));
const signature = () => load('signature') ?? '';
const setSignature = (s) => save('signature', s);
function contentFrom(history, sig) {
    const strokes = [];
    for (const h of history) {
        if (h.kind === 'clear')
            strokes.length = 0;
        else
            strokes.push(h.stroke);
    }
    return { bitmap: redraw(HALF_W, HALF_H, strokes), strokes, signature: sig };
}
let screen = 'home';
let teardown = null;
const send = new SendDialog();
function show(name) {
    teardown?.();
    teardown = null;
    screen = name;
    for (const s of ['home', 'draw', 'result'])
        $(`screen-${s}`).hidden = s !== name;
    window.scrollTo(0, 0);
}
function fitStage(canvas, stage, below) {
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const maxH = Math.max(220, window.innerHeight - top - below.offsetHeight - 32);
    fitCanvas(canvas, stage.clientWidth, maxH);
    below.style.setProperty('--stage-w', canvas.style.width);
}
// ---------- home ----------
function showHome(error) {
    show('home');
    const box = $('home-error');
    box.hidden = !error;
    box.textContent = error ?? '';
    document.title = 'Half-Pic';
}
/** Validate a code and navigate to it (in the canonical base64url form). */
function openCode(text) {
    try {
        const bytes = parseCode(text);
        decodePayload(bytes);
        const hash = `#${toBase64Url(bytes)}`;
        if (location.hash === hash)
            route();
        else
            location.hash = hash;
    }
    catch (e) {
        showHome(e instanceof DecodeError ? e.message : 'Could not open this.');
    }
}
async function openFile(file) {
    try {
        openCode(await codeFromFile(file));
    }
    catch (e) {
        showHome(e instanceof Error ? e.message : 'Could not open this file.');
    }
}
$('open-form').addEventListener('submit', (e) => {
    e.preventDefault();
    openCode($('open-input').value);
});
$('open-file').addEventListener('change', (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (file)
        void openFile(file);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file)
        void openFile(file);
});
// ---------- drawing ----------
let editor = null;
function startDrawing(setup) {
    show('draw');
    const draft = loadDraft(setup.draftKey);
    const reveal = setup.other ? setup.other.reveal : (draft.reveal ?? DEFAULT_REVEAL);
    let sendReveal = reveal;
    const canvas = $('draw-canvas');
    const fresh = canvas.cloneNode(); // drop old listeners
    canvas.replaceWith(fresh);
    let timer = 0;
    let revealed = false;
    const persist = () => save(setup.draftKey, { history: ed.getHistory(), reveal: sendReveal, revealed });
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
    const slider = $('strip-reveal');
    $('strip-control').hidden = !!setup.other;
    slider.min = String(MIN_REVEAL);
    slider.max = String(MAX_REVEAL);
    const setReveal = (r) => {
        sendReveal = r;
        slider.value = String(r);
        $('strip-reveal-out').value = `${r} px`;
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
    const onSend = () => openSend({ kind: 'half', side: setup.side, content: ed.content(signature()), reveal: sendReveal, signatureEditable: true }, (s) => {
        setReveal(s.reveal);
        setSignature(s.signature);
        persist();
        updateMeter(setup, sendReveal);
    });
    const onUnfold = async () => {
        const message = ed.isEmpty
            ? 'Your half is empty. Unfold the page anyway?'
            : 'Unfold the page? You cannot change your half after this.';
        if (!(await confirmDialog(message, 'Unfold')))
            return;
        ed.locked = true;
        revealed = true;
        persist();
        showUnfolded(setup.other, ed.content(signature()), true);
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
function updateToolbar() {
    if (!editor)
        return;
    for (const b of document.querySelectorAll('[data-tool]')) {
        b.setAttribute('aria-pressed', String(b.dataset.tool === editor.tool));
    }
    const size = editor.sizes[editor.tool];
    for (const b of document.querySelectorAll('[data-size]')) {
        b.setAttribute('aria-pressed', String(Number(b.dataset.size) === size));
    }
    $('btn-undo').disabled = !editor.canUndo;
    $('btn-clear').disabled = editor.isEmpty;
}
/** One meter line: "<label>: 901 characters · short link: 387". */
function meterLine(label, p) {
    const { link, shortLink } = linksFor(p);
    const part = (text) => {
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
function updateMeter(setup, reveal) {
    if (!editor)
        return;
    const meter = $('meter');
    const note = $('strip-note');
    const mine = editor.content(signature());
    meter.title = editor.isEmpty ? '' : `Your half. ${methodSummary(mine)}`;
    if (setup.other) {
        note.hidden = true;
        const theirs = setup.other.half;
        const [left, right] = setup.side === 'left' ? [mine, theirs] : [theirs, mine];
        meter.replaceChildren(meterLine('Finished picture', { kind: 'chimera', left, right }), meterLine('Your half on its own', { kind: 'half', side: setup.side, reveal: DEFAULT_REVEAL, half: mine }));
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
function setTool(tool) {
    if (!editor)
        return;
    editor.tool = tool;
    updateToolbar();
}
function setSize(size) {
    if (!editor)
        return;
    editor.sizes[editor.tool] = Math.max(0, Math.min(BRUSH_V1.length - 1, size));
    updateToolbar();
}
for (const b of document.querySelectorAll('[data-tool]'))
    b.addEventListener('click', () => setTool(b.dataset.tool));
for (const b of document.querySelectorAll('[data-size]'))
    b.addEventListener('click', () => setSize(Number(b.dataset.size)));
$('btn-undo').addEventListener('click', () => editor?.undo());
$('btn-clear').addEventListener('click', () => editor?.clear());
document.addEventListener('keydown', (e) => {
    if (screen !== 'draw' || !editor || document.querySelector('dialog[open]'))
        return;
    const t = e.target;
    if (t.closest('input, textarea, select'))
        return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        editor.undo();
    }
    else if (!mod && !e.altKey) {
        if (e.key === 'b' || e.key === 'B')
            setTool('pen');
        else if (e.key === 'e' || e.key === 'E')
            setTool('eraser');
        else if (e.key === '[')
            setSize(editor.sizes[editor.tool] - 1);
        else if (e.key === ']')
            setSize(editor.sizes[editor.tool] + 1);
    }
});
/**
 * The finished page. With `unfold`, it starts as the person completing it last
 * saw it: their half plus the strip, the rest of the other half folded away
 * behind the page. That part then swings out from behind, around the fold.
 */
function showResult(left, right, hint, actions, unfold) {
    show('result');
    const canvas = $('result-canvas');
    const page = paintPage(left, right);
    const flap = $('result-flap');
    const timers = [];
    const finish = () => {
        page.toCanvas(canvas);
        flap.hidden = true;
        flap.className = 'flap';
    };
    if (!unfold) {
        finish();
    }
    else {
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
        part.toCanvas($('result-flap-canvas'));
        flap.className = `flap ${unfold.side}`;
        flap.style.left = `${(foldX / (2 * HALF_W)) * 100}%`;
        flap.style.width = `${(foldW / (2 * HALF_W)) * 100}%`;
        flap.hidden = false;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            timers.push(window.setTimeout(finish, 400));
        }
        else {
            timers.push(window.setTimeout(() => flap.classList.add('open'), 700)); // show it folded first
            timers.push(window.setTimeout(finish, 700 + 1300));
        }
    }
    $('result-hint').textContent = hint;
    const bar = $('result-actions');
    bar.replaceChildren(...actions.map((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = a.label;
        if (a.primary)
            b.className = 'primary';
        b.addEventListener('click', () => void a.run());
        return b;
    }));
    const fit = () => fitStage(canvas, $('result-stage'), bar);
    fit();
    window.addEventListener('resize', fit);
    teardown = () => {
        timers.forEach(clearTimeout);
        finish();
        window.removeEventListener('resize', fit);
    };
}
async function downloadChimera(left, right) {
    const { code } = linksFor({ kind: 'chimera', left, right });
    download(await pngFile(paintPage(left, right), chimeraLines(left, right), code), 'half-pic-chimera.png');
}
/** After completing a challenge: the full picture, with ways to send it back or pass your half on. */
function showUnfolded(challenge, mine, animate) {
    const mySide = otherSide(challenge.side);
    const pair = () => {
        const me = { ...mine, signature: signature() };
        return mySide === 'left' ? { left: me, right: challenge.half } : { left: challenge.half, right: me };
    };
    const { left, right } = pair();
    const who = challenge.half.signature || 'the other artist';
    showResult(left, right, `Unfolded! Send the finished picture back to ${who}, or pass your ${mySide} half on to someone new.`, [
        {
            label: 'Send the picture…',
            primary: true,
            run: () => openSend({ kind: 'chimera', ...pair(), mySide }, (s) => setSignature(s.signature)),
        },
        {
            label: `Pass your ${mySide} half on…`,
            run: () => openSend({ kind: 'half', side: mySide, content: pair()[mySide], reveal: DEFAULT_REVEAL, signatureEditable: true }, (s) => setSignature(s.signature)),
        },
        { label: 'Download picture', run: () => downloadChimera(pair().left, pair().right) },
        { label: 'New picture', run: () => void (location.hash = '#/') },
    ], animate ? { side: challenge.side, reveal: challenge.reveal } : null);
}
function showChimera(p) {
    const names = [p.left.signature, p.right.signature].filter(Boolean);
    showResult(p.left, p.right, `A finished picture${names.length ? ` by ${names.join(' and ')}` : ''}. You can pass either half on as a new challenge.`, [
        {
            label: 'Pass the left half on…',
            run: () => openSend({ kind: 'half', side: 'left', content: p.left, reveal: DEFAULT_REVEAL, signatureEditable: false }, () => { }),
        },
        {
            label: 'Pass the right half on…',
            run: () => openSend({ kind: 'half', side: 'right', content: p.right, reveal: DEFAULT_REVEAL, signatureEditable: false }, () => { }),
        },
        { label: 'Download picture', run: () => downloadChimera(p.left, p.right) },
        { label: 'New picture', primary: true, run: () => void (location.hash = '#/') },
    ], null);
}
// ---------- dialogs ----------
function openSend(spec, onSettings) {
    send.open(spec, { reveal: DEFAULT_REVEAL, signature: signature() }, onSettings);
}
function confirmDialog(message, ok) {
    const d = $('confirm');
    $('confirm-text').textContent = message;
    $('confirm-ok').textContent = ok;
    d.returnValue = '';
    d.showModal();
    return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}
// ---------- routing ----------
function route() {
    send.close();
    const confirm = $('confirm');
    if (confirm.open)
        confirm.close();
    const h = location.hash.slice(1);
    if (!h || h === '/')
        return showHome();
    const draw = /^\/draw\/(left|right)$/.exec(h);
    if (draw) {
        const side = draw[1];
        document.title = `Draw the ${side} half · Half-Pic`;
        return startDrawing({
            side,
            draftKey: `draft:new:${side}`,
            other: null,
            hint: `Draw the ${side} half. The shaded strip by the fold is all the next person will see, so let some lines run into it.`,
        });
    }
    if (h.startsWith('/'))
        return showHome();
    let payload;
    let bytes;
    try {
        bytes = parseCode(h);
        payload = decodePayload(bytes);
    }
    catch (e) {
        return showHome(e instanceof DecodeError ? e.message : 'Could not open this link.');
    }
    if (payload.kind === 'chimera') {
        document.title = 'A finished picture · Half-Pic';
        return showChimera(payload);
    }
    const mySide = otherSide(payload.side);
    const draftKey = `draft:c:${crc32(bytes).toString(16)}`;
    const draft = loadDraft(draftKey);
    document.title = `Draw the ${mySide} half · Half-Pic`;
    if (draft.revealed)
        return showUnfolded(payload, contentFrom(draft.history, signature()), false);
    const who = payload.half.signature || 'Someone';
    startDrawing({
        side: mySide,
        draftKey,
        other: payload,
        hint: `${who} drew the ${payload.side} half and folded it away. You can only see the edge by the fold. Draw the ${mySide} half, then unfold the page.`,
    });
}
window.addEventListener('hashchange', route);
route();
