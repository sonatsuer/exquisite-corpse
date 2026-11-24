# Exquisite Corpse

**Play it at <https://sonatsuer.github.io/exquisite-corpse/>**

A fold-and-draw game in the browser. One person draws half a picture and sends it on. The receiver sees only a thin strip of it next to the fold. They draw the other half, then unfold the page to see the chimera.

There is no server. You can play in two ways:

- **By link, with no account.** The whole picture travels inside the link, after the `#`.
- **Online, with an AT Protocol account** (an "Atmosphere" account, for example a Bluesky account). Each half is saved as a record in its author's own account. Links stay short, you can invite people by handle, and "My pictures" lists your games.

## How to play

1. Open the site and choose **Left half** or **Right half**. Draw. The shaded strip by the fold is what the next person will see, so let some lines run into it. Set its width with **Visible strip**. A warning appears while the strip is empty.
2. Click **Send…**. Optionally sign your half, then either copy the link, or publish it online (see below).
3. The receiver draws the other half and clicks **Unfold**.
4. From the finished picture you can:
   - send it back (**Send the picture…**);
   - pass your own half on to someone new as a fresh challenge;
   - download it as a PNG.

   Anyone who opens a finished picture can pass either half on.

### Playing online

1. Click **Sign in** and enter your internet handle, e.g. `alice.bsky.social`. You sign in on your account's own page, so the game never sees your password.
2. In **Send…**, the **Online** section has:
   - **Publish online**: saves the half in your account and gives a short link (`…/#/half/<account>/<record>`);
   - **Invite**: add handles, and the half appears under "Waiting for you" in their **My pictures**;
   - **Post on Bluesky** (optional): posts the strip as a teaser with the link, mentioning the people you invited, which notifies them.
3. When an online half is unfolded by a signed-in player, their half is saved as an answer to it. The finished picture then appears in both players' **My pictures**. If the half was announced on Bluesky, **Reply on Bluesky** replies to that post with the finished picture.
4. **My pictures** shows 12 pictures at a time (**Show more** loads the next ones). **Your pictures** can be filtered by artist and side, e.g. "pictures where @bob drew the right half". It also has a **Delete** button on each of your own halves. It removes the record from your account, which also removes the finished pictures made with it. The other player's half stays in their account, and Bluesky posts stay in Bluesky.

**Published halves are public.** Anyone can read the records in your account, and the game only hides the folded part as a courtesy, like not peeking under a real fold. Signing in first asks only for permission to save the game's records. The first time you post on Bluesky, it asks for permission to post as well.

### Ways to send without an account

| Option | Use it when |
|---|---|
| **Copy link** | Default. Plain ASCII, works everywhere. |
| **Copy short link** | The chat app limits message length in characters (Discord: 2,000; Telegram: 4,096). It packs 14 bits into each character by using Chinese characters, so it is about 2.3× shorter. Copy it from the dialog, not from the address bar: the browser expands each character to 9 there. |
| **Copy code** | The link does not work, or the site moved. Paste the code on the home page under **Open a half-picture**. |
| **Download file** | Email or file transfer. The PNG shows only the visible strip, and the drawing is stored inside it. Messengers that recompress photos strip that data, so send it as a file. Open it with **Open a file** or by dropping it on the page. |
| **Email…** / **Share…** | Opens your mail app or the system share sheet. |

## How the online mode works

- **Records:** each half is an `io.github.sonatsuer.corpse.half` record in its author's repository ([schema](lexicons/io/github/sonatsuer/corpse/half.json)). It holds:
  - `picture`: the same text as a long link's code;
  - `answers`: a link to the half it completes, if any;
  - `invite`: invited accounts, if any;
  - `announcement`: the Bluesky post that announced it, if any.

  A half plus the half that answers it is a finished picture.
- **Reading** needs no account: the game looks up the author's data server and reads the record directly.
- **Finding answers and invitations** uses [Constellation](https://constellation.microcosm.blue/), a free, community-run index of links between records. If it is unreachable, "My pictures" says some entries may be missing.

**Outside services the browser contacts:**

| Service | Used for | When |
|---|---|---|
| `plc.directory` and each player's data server | Account lookup; reading and saving records | Online mode only |
| `cloudflare-dns.com` (DNS over HTTPS) | Turning handles into account ids | Online mode only, when typing handles |
| `constellation.microcosm.blue` | Finding answers and invitations | Online mode only |
| `public.api.bsky.app` | Handle suggestions while typing invitations | Online mode only. If it fails, typing a full handle still works. |
| Your account's sign-in server (e.g. `bsky.social`) | Signing in | Online mode only |

Playing by link contacts none of them, and the sign-in library (about 210 KB) is only downloaded when someone signs in.

**Known issue:** `npm audit` reports a high-severity advisory in `zod` 3, used inside `@atproto/oauth-client-browser` (the newest version, 0.5.18) to check server responses. A malicious sign-in or account server could make the signed-in player's own tab run out of memory. The fix exists only in zod 4.6.6 and later, which the library does not support yet. Update the library when a release moves to zod 4.

## Development

You need Node 18 or later and Python 3 (only for the local server).

```sh
npm install
npm run watch     # bundle src/ into docs/js/ on every change (no type-check)
npm run serve     # http://127.0.0.1:8000 (ES modules do not load from file://)
npm test          # unit tests (node:test)
npm run typecheck # tsc, strict
npm run bench     # link sizes for synthetic drawings
npm run check     # type-check + bundle + tests
```

The source is TypeScript in `src/`. `tsc` type-checks it, and esbuild bundles it into `docs/js/main.js`, with the sign-in library in a separate chunk under `docs/js/chunks/` that is loaded on demand.

**Testing sign-in locally:** open the site at `http://127.0.0.1:8000`, not `localhost`. There the game uses a "loopback" client that needs no hosted metadata, so you can sign in with a real account before deploying. Records you publish there are real, and their links point to the published site.

| File | What it does |
|---|---|
| `src/codec.ts` | Link format v1: 1 header byte, one arithmetic-coded stream, CRC-16 |
| `src/arith.ts` | Binary arithmetic coder and adaptive bit models (integer-only, so results are identical in every browser) |
| `src/methods/` | The three picture methods: `strokes` (stroke list), `bitmap` (JBIG-style context model), `raw` (fallback). The encoder tries each and keeps the smallest. |
| `src/raster.ts` | The brush. Part of the link format: stroke links are redrawn with it. |
| `src/simplify.ts` | Turns pointer samples into stored stroke points: whole pixels, no other changes, so a stroke never moves after you lift the pen |
| `src/text.ts` | base64url and base16k (short link) text encodings |
| `src/atproto/` | Online mode: record format and links (`record.ts`, `links.ts`), public reads (`net.ts`), writes (`write.ts`), game logic (`game.ts`), Bluesky posts (`bsky.ts`), sign-in (`oauth.ts`, `session.ts`) |
| `src/editor.ts`, `src/share.ts`, `src/online.ts`, `src/main.ts` | UI: editor, send dialog and exports, online parts (account, online box, "My pictures"), screens and routing |
| `docs/client-metadata.json` | The sign-in client's public description, served at its own address (its `client_id`) |
| `lexicons/` | Schema of the game's record type |

### Keeping old links and records working

Links already sent and records already saved must keep opening, so these rules apply:

- Do not change `BRUSH_V1` or the stroke drawing code in `raster.ts`.
- Do not change the coders in `src/methods/` or `arith.ts`.
- Do not change `HALF_W`/`HALF_H`.
- Do not change `NSID_HALF` (`src/atproto/links.ts`) or the meaning of the record fields. Add new optional fields instead.

To improve a picture method, add a new method id (the 2-bit method field has an escape value for this) and keep the old decoder. `test/golden.json` holds frozen v1 links, and `npm test` checks that they still decode to the same pictures. Do not regenerate existing golden vectors after links are public.

Encoder-side settings are safe to change. Examples: `DEFAULT_REVEAL`, the meter thresholds, the colours.

## Deploying to GitHub Pages

There is no CI. The bundled JavaScript is committed.

1. `npm run check`, then commit, including `docs/js/`.
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/docs`.
3. `docs/.nojekyll` makes Pages serve the files as they are.

Share links and the sign-in client point to the published site:
- `SHARE_BASE` in `src/config.ts`;
- `client_id`, `client_uri`, `logo_uri` and `redirect_uris` in `docs/client-metadata.json`.

If the site moves, for example to a custom domain, change all of them. A test checks that they agree. To test links locally, set `SHARE_BASE` to `null`, and links then use the address the page is served from.

Optional: `git config core.hooksPath .githooks` enables a pre-commit hook. It runs the checks and refuses the commit when `docs/js/` is out of date with `src/`.
