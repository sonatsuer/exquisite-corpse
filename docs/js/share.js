/** Sending pictures: the send dialog, links, codes, PNG files, email, Web Share. */
import { clampSignature, encodePayload, methodSizes } from './codec.js';
import { HALF_H, HALF_W, LINK_DANGER, LINK_WARN, MAX_REVEAL, MIN_REVEAL, SHARE_BASE } from './config.js';
import { addTextChunk, readTextChunk } from './png.js';
import { hasInk, seamStrip } from './raster.js';
import { COLOR, fitCanvas, Painter } from './render.js';
import { toBase16k, toBase64Url } from './text.js';
export const PNG_KEYWORD = 'halfpic';
export function shareBase() {
    return SHARE_BASE ?? location.origin + location.pathname;
}
export const linkFor = (code) => `${shareBase()}#${code}`;
export const linkLevel = (length) => (length > LINK_DANGER ? 'danger' : length > LINK_WARN ? 'warn' : 'ok');
export function linksFor(p) {
    const bytes = encodePayload(p);
    const code = toBase64Url(bytes);
    return { bytes, code, link: linkFor(code), shortLink: linkFor(toBase16k(bytes)) };
}
/** Tooltip text: what each method would cost for this half. */
export function methodSummary(c) {
    const s = methodSizes(c);
    const parts = [`bitmap ${s.bitmap} B`, `raw ${s.raw} B`];
    if (s.strokes !== null)
        parts.unshift(`strokes ${s.strokes} B`);
    return `Picture data: ${parts.join(' · ')} (smallest is used)`;
}
/** Why a half would make a poor challenge, or null if the receiver will see something to continue. */
export function stripProblem(half, side, reveal) {
    if (!hasInk(half.bitmap))
        return 'This half is empty, so the next person will have nothing to continue.';
    if (!hasInk(seamStrip(half.bitmap, side, reveal))) {
        return 'Nothing is drawn in the visible strip, so the next person will see a blank edge with nothing to connect to. Draw into the shaded strip, or make the strip wider.';
    }
    return null;
}
/** What the receiver of a half sees: the sender's half folded away except the strip, and an empty half. */
export function paintChallenge(half, side, reveal) {
    const p = new Painter(HALF_W * 2, HALF_H);
    const senderX = side === 'left' ? 0 : HALF_W;
    p.fill(side === 'left' ? HALF_W : 0, 0, HALF_W, HALF_H, COLOR.paper);
    p.fill(senderX, 0, HALF_W, HALF_H, COLOR.flap);
    const stripX = side === 'left' ? HALF_W - reveal : HALF_W;
    p.bitmap(seamStrip(half.bitmap, side, reveal), stripX, 0, COLOR.stripPaper);
    p.fill(side === 'left' ? stripX - 1 : stripX + reveal, 0, 1, HALF_H, COLOR.flapEdge);
    return p;
}
export function paintPage(left, right) {
    const p = new Painter(HALF_W * 2, HALF_H);
    p.bitmap(left.bitmap, 0, 0);
    p.bitmap(right.bitmap, HALF_W, 0);
    return p;
}
/** A PNG of `p`, scaled up, with caption lines under it and the payload code inside. */
export async function pngFile(p, lines, code) {
    const S = 4;
    const lineH = 34;
    const canvas = document.createElement('canvas');
    canvas.width = p.w * S;
    canvas.height = p.h * S + 28 + lines.length * lineH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const small = document.createElement('canvas');
    p.toCanvas(small);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, p.w * S, p.h * S);
    ctx.fillStyle = '#1A1A1A';
    lines.forEach((line, i) => {
        ctx.font = `${i === 0 ? '700' : '400'} 24px system-ui, sans-serif`;
        ctx.fillText(line, 24, p.h * S + 20 + (i + 0.75) * lineH, canvas.width - 48);
    });
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the PNG'))), 'image/png'));
    const withCode = addTextChunk(new Uint8Array(await blob.arrayBuffer()), PNG_KEYWORD, code);
    return new Blob([withCode], { type: 'image/png' });
}
export function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
/** The payload code stored in a Half-Pic PNG. */
export async function codeFromFile(file) {
    const code = readTextChunk(new Uint8Array(await file.arrayBuffer()), PNG_KEYWORD);
    if (!code) {
        throw new Error('This file has no Half-Pic drawing inside. If it came through a messenger, the picture was probably compressed: ask for it to be sent as a file.');
    }
    return code;
}
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        const t = document.createElement('textarea');
        t.value = text;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.append(t);
        t.select();
        const ok = document.execCommand('copy');
        t.remove();
        return ok;
    }
}
function flash(button, text) {
    const label = button.dataset.label ?? button.textContent ?? '';
    button.dataset.label = label;
    button.textContent = text;
    setTimeout(() => (button.textContent = label), 1600);
}
export function chimeraLines(left, right) {
    const by = [left.signature && `left: ${left.signature}`, right.signature && `right: ${right.signature}`].filter(Boolean);
    return [`A Half-Pic chimera${by.length ? ` (${by.join(', ')})` : ''}`, `Open this file at ${shareBase()} to pass a half on.`];
}
const el = (id) => document.getElementById(id);
/** The "Send" dialog. One instance; open() fills it for a half or a chimera. */
export class SendDialog {
    dialog = el('send');
    title = el('send-title');
    preview = el('send-preview');
    caption = el('send-caption');
    revealRow = el('send-reveal-row');
    reveal = el('send-reveal');
    revealOut = el('send-reveal-out');
    sigRow = el('send-sig-row');
    sig = el('send-sig');
    link = el('send-link');
    len = el('send-len');
    shortLen = el('send-short-len');
    warning = el('send-warning');
    stripWarning = el('send-strip-warning');
    shareBtn = el('send-share');
    spec = null;
    links = null;
    onSettings = null;
    constructor() {
        this.reveal.min = String(MIN_REVEAL);
        this.reveal.max = String(MAX_REVEAL);
        this.reveal.addEventListener('input', () => this.update(true));
        this.sig.addEventListener('input', () => this.update(true));
        this.link.addEventListener('focus', () => this.link.select());
        this.shareBtn.hidden = typeof navigator.share !== 'function';
        const on = (id, f) => {
            const b = el(id);
            b.addEventListener('click', () => void f(b));
        };
        on('send-copy', async (b) => flash(b, (await copyText(this.links.link)) ? 'Copied ✓' : 'Copy failed'));
        on('send-copy-short', async (b) => flash(b, (await copyText(this.links.shortLink)) ? 'Copied ✓' : 'Copy failed'));
        on('send-code', async (b) => flash(b, (await copyText(this.links.code)) ? 'Copied ✓' : 'Copy failed'));
        on('send-file', async () => download(await this.file(), this.fileName()));
        on('send-email', () => this.email());
        on('send-share', () => this.share());
    }
    open(spec, settings, onSettings) {
        this.spec = spec;
        this.onSettings = onSettings;
        const isHalf = spec.kind === 'half';
        this.title.textContent = isHalf ? `Send the ${spec.side} half` : 'Send the finished picture';
        this.caption.textContent = isHalf ? 'What they will see' : 'What they will get';
        this.revealRow.hidden = !isHalf;
        this.reveal.value = String(isHalf ? spec.reveal : settings.reveal);
        const sigEditable = isHalf ? spec.signatureEditable : spec.mySide !== null;
        this.sigRow.hidden = !sigEditable;
        this.sig.value = sigEditable ? settings.signature : '';
        this.update(false);
        if (!this.dialog.open)
            this.dialog.showModal();
    }
    close() {
        if (this.dialog.open)
            this.dialog.close();
    }
    settings() {
        return { reveal: Number(this.reveal.value), signature: clampSignature(this.sig.value) };
    }
    payload() {
        const spec = this.spec;
        const { reveal, signature } = this.settings();
        if (spec.kind === 'half') {
            const half = spec.signatureEditable ? { ...spec.content, signature } : spec.content;
            return { kind: 'half', side: spec.side, reveal, half };
        }
        const sign = (side, c) => (spec.mySide === side ? { ...c, signature } : c);
        return { kind: 'chimera', left: sign('left', spec.left), right: sign('right', spec.right) };
    }
    update(changed) {
        const p = this.payload();
        this.links = linksFor(p);
        this.revealOut.value = `${this.reveal.value} px`;
        const blank = p.kind === 'half' ? stripProblem(p.half, p.side, p.reveal) : null;
        this.stripWarning.hidden = !blank;
        this.stripWarning.textContent = blank ?? '';
        const painter = p.kind === 'half' ? paintChallenge(p.half, p.side, p.reveal) : paintPage(p.left, p.right);
        painter.toCanvas(this.preview);
        fitCanvas(this.preview, Math.min(320, window.innerWidth - 64), 200);
        this.link.value = this.links.link;
        const n = this.links.link.length;
        const ns = this.links.shortLink.length;
        this.len.textContent = `${n.toLocaleString()} characters`;
        this.len.dataset.level = linkLevel(n);
        this.shortLen.textContent = `${ns.toLocaleString()} characters`;
        const level = linkLevel(n);
        this.warning.hidden = level === 'ok';
        this.warning.textContent =
            level === 'danger'
                ? 'This link is very long, and some chat apps cut long messages. Use the short link, the code or the file instead.'
                : `This link is longer than ${LINK_WARN.toLocaleString()} characters, the message limit in some chat apps (Discord). The short link is ${ns.toLocaleString()} characters.`;
        if (changed)
            this.onSettings?.(this.settings());
    }
    fileName() {
        const p = this.payload();
        return p.kind === 'half' ? `half-pic-${p.side}-half.png` : 'half-pic-chimera.png';
    }
    file() {
        const p = this.payload();
        if (p.kind === 'half') {
            return pngFile(paintChallenge(p.half, p.side, p.reveal), [
                `Half-Pic: ${p.half.signature || 'someone'} drew the ${p.side} half and folded it away.`,
                `Draw the other half: go to ${shareBase()}`,
                'and choose "Open a file" with this picture.',
            ], this.links.code);
        }
        return pngFile(paintPage(p.left, p.right), chimeraLines(p.left, p.right), this.links.code);
    }
    text() {
        const p = this.payload();
        const l = this.links;
        const fallback = `If the link does not open: go to ${shareBase()} and paste this code into "Open a half-picture":\n\n${l.code}\n`;
        if (p.kind === 'half') {
            return {
                subject: 'Half a picture for you',
                body: `I drew the ${p.side} half of a picture and folded it away. Draw the other half:\n\n${l.link}\n\n${fallback}`,
            };
        }
        return { subject: 'Our finished picture', body: `Here is the finished picture:\n\n${l.link}\n\n${fallback}` };
    }
    email() {
        const { subject, body } = this.text();
        const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        if (href.length > 1900) {
            this.warning.hidden = false;
            this.warning.textContent = 'This email is long; some mail apps cut it. If the link arrives broken, send the file as an attachment instead.';
        }
        const a = document.createElement('a');
        a.href = href;
        a.click();
    }
    async share() {
        const { subject, body } = this.text();
        try {
            const file = new File([await this.file()], this.fileName(), { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] }))
                await navigator.share({ files: [file], title: subject, text: body });
            else
                await navigator.share({ title: subject, text: body });
        }
        catch (e) {
            if (!(e instanceof DOMException && e.name === 'AbortError')) {
                this.warning.hidden = false;
                this.warning.textContent = 'Sharing did not work here. Copy the link instead.';
            }
        }
    }
}
