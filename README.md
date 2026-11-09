# Half-Pic

**Play it at <https://sonatsuer.github.io/half-pic/>**

A fold-and-draw game in the browser. One person draws half a picture and sends a link. The receiver sees only a thin strip of it next to the fold. They draw the other half, then unfold the page to see the chimera.

There is no server. The whole picture travels inside the link, after the `#`. The site is a set of static files on GitHub Pages.

## How to play

1. Open the site and choose **Left half** or **Right half**. Draw. The shaded strip by the fold is what the next person will see, so let some lines run into it. Set its width with **Visible strip**. A warning appears while the strip is empty.
2. Click **Send…**, optionally sign your half, and copy the link.
3. The receiver draws the other half and clicks **Unfold**.
4. From the finished picture you can:
   - send it back (**Send the picture…**);
   - pass your own half on to someone new as a fresh challenge;
   - download it as a PNG.

   Anyone who opens a finished picture can pass either half on.

### Ways to send

| Option | Use it when |
|---|---|
| **Copy link** | Default. Plain ASCII, works everywhere. |
| **Copy short link** | The chat app limits message length in characters (Discord: 2,000; Telegram: 4,096). It packs 14 bits into each character by using Chinese characters, so it is about 2.3× shorter. Copy it from the dialog, not from the address bar: the browser expands each character to 9 there. |
| **Copy code** | The link does not work, or the site moved. Paste the code on the home page under **Open a half-picture**. |
| **Download file** | Email or file transfer. The PNG shows only the visible strip, and the drawing is stored inside it. Messengers that recompress photos strip that data, so send it as a file. Open it with **Open a file** or by dropping it on the page. |
| **Email…** / **Share…** | Opens your mail app or the system share sheet. |

## Development

You need Node 18 or later and Python 3 (only for the local server).

```sh
npm install
npm run watch     # compile src/ to docs/js/ on every change
npm run serve     # http://localhost:8000 (ES modules do not load from file://)
npm test          # unit tests (node:test)
npm run bench     # link sizes for synthetic drawings
npm run check     # build + tests
```

The source is TypeScript in `src/`. `tsc` compiles it to plain ES modules in `docs/js/`, with no bundler and no runtime dependencies.

| File | What it does |
|---|---|
| `src/codec.ts` | Link format v1: 1 header byte, one arithmetic-coded stream, CRC-16 |
| `src/arith.ts` | Binary arithmetic coder and adaptive bit models (integer-only, so results are identical in every browser) |
| `src/methods/` | The three picture methods: `strokes` (stroke list), `bitmap` (JBIG-style context model), `raw` (fallback). The encoder tries each and keeps the smallest. |
| `src/raster.ts` | The brush. Part of the link format: stroke links are redrawn with it. |
| `src/simplify.ts` | Turns pointer samples into stored stroke points: whole pixels, no other changes, so a stroke never moves after you lift the pen |
| `src/text.ts` | base64url and base16k (short link) text encodings |
| `src/editor.ts`, `src/share.ts`, `src/main.ts` | UI: editor, send dialog and exports, screens and routing |

### Keeping old links working

Links already sent must keep opening, so these rules apply:

- Do not change `BRUSH_V1` or the stroke drawing code in `raster.ts`.
- Do not change the coders in `src/methods/` or `arith.ts`.
- Do not change `HALF_W`/`HALF_H`.

To improve a method, add a new method id (the 2-bit method field has an escape value for this) and keep the old decoder. `test/golden.json` holds frozen v1 links, and `npm test` checks that they still decode to the same pictures. Do not regenerate existing golden vectors after links are public.

Encoder-side settings are safe to change. Examples: `DEFAULT_REVEAL`, the meter thresholds, the colours.

## Deploying to GitHub Pages

There is no CI. The compiled JavaScript is committed.

1. `npm run check`, then commit, including `docs/js/`.
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/docs`.
3. `docs/.nojekyll` makes Pages serve the files as they are.

Share links always point to the published site, `SHARE_BASE` in `src/config.ts`, even when made on a local test server. To test links locally, set `SHARE_BASE` to `null` (links then use the address the page is served from). Change it if the site moves, for example to a custom domain.

Optional: `git config core.hooksPath .githooks` enables a pre-commit hook. It runs the checks and refuses the commit when `docs/js/` is out of date with `src/`.
