# Control Scout Lite (venue mode)

A text-first rendering of the pages people open at a venue on one bar of signal. It is a rendering mode, not a
second app: the server builds plain HTML from the same functions the API answers with, trimmed to the fields
the page shows. Same data, same predictions, same brand (black and gold, the C-mark), the app's five themes and
its text size.

| Lite page | Full page | Data |
|---|---|---|
| `/lite/events/:season/:code` | `/events/:season/:code` | `cachedEventDetail` → `liteEvent` |
| `/lite/events/:season/:code/match/:key` | `/events/:season/:code/match/:key` | `matchDetail` → `liteMatch` |
| `/lite/teams/:number[?season=]` | `/teams/:number[?season=]` | `teamProfile` + `matchViews` → `liteTeam` |
| `/lite/picklist?space=&season=` | `/scout?space=&tab=data&view=picklist&season=` | `readPickList` + `teamSummaries` → `litePicks` |

Code: `src/shared/lite.ts` (the address rule, both ways, and the thresholds), `server/lite/trim.ts` (trimming),
`server/lite/render.ts` (stylesheet, layout primitives and pages), `server/lite/routes.ts` (routes, `?lite=1`,
Lite on/off), `src/shared/themeTokens.ts` (the themes' colours and the cookies), `src/lib/liteCookies.ts` (the
app writing them), `src/lib/liteSuggest.ts` and `src/components/layout/LiteSuggest.tsx` (the in-app offer),
`server/bootShell.ts` (the first paint's offer).

## Rules

- **No images, no charts, no scripts.** Tables instead of charts, system fonts, one inline stylesheet, and one
  inline SVG (the C-mark, markup in the page). The page's CSP is `default-src 'none'; style-src 'unsafe-inline'`,
  so nothing else can load.
- **Never a trap.** Every Lite page has a gold "Full version" button at the top right, including 404s and errors.
- **Shared formatting.** Numbers, dates, win odds and award names come from `src/shared/format.ts`, which the
  app's `src/lib/format.ts` re-exports, so the two renderings can't drift. Calls show their confidence word.
- **Caching.** Public pages: `public, max-age=60, stale-while-revalidate=300` with an ETag, like the API;
  `no-cache` on an event day (the event is live, or the team has unplayed matches). Every Lite page sends
  `Vary: Cookie` (it follows the theme, text size and Lite cookies), and so does a full page that has a Lite twin
  (`pageVary`: with Lite on, its page load is a redirect). The pick list is `private, no-store` and
  needs the same gate as its API: signed in (401), the workspace's scouting switched on (403), a member (403).
- **Search engines** get a canonical link to the full page.
- **Budget:** under 30 KB gzipped per page (the test holds an 80-match event to it).

## Theme and text size

Lite runs no script, so it can't read the app's settings from localStorage. The app mirrors them into cookies
(`path=/; max-age=31536000; samesite=lax`) whenever they change and once when it starts:

| Cookie | Values | Lite draws |
|---|---|---|
| `cs-theme` | `light`, `dim`, `dark`, `midnight`, `system` (absent: dark, the app's default) | `<html class="light|dim|midnight">`; System is `class="sys"`, Light or Dark by `prefers-color-scheme` |
| `cs-text-size` | `s`, `l`, `xl` (absent: Default) | `<html data-text-size>`, scaling the root font size as the app does (14 px on phones, 16 px wider, × 0.9 / 1.125 / 1.25) |

The colours are `src/shared/themeTokens.ts`; `src/shared/themeTokens.test.ts` holds each one equal to
`src/index.css`'s value in that theme and every text colour to 4.5:1 on the surfaces it sits on.

## Layout primitives (`server/lite/render.ts`)

Phone (390 px) first: 16 px gutters, 24 px between sections, 12 px rounded cards, table cells padded 10 × 12 px
with numbers right-aligned. Every link carries one of `LITE_TAP_CLASSES` (`btn`, `cell`, `row`, `chip`), each at
least 44 px tall; `lite.test.ts` checks the stylesheet and every link on every page. A new Lite page composes:

| Function | What it draws |
|---|---|
| `header(full, view)` | C-mark, "Control Scout Lite", the gold Full version button (every page, via `liteDocument`) |
| `stickyNote(full)` | While Lite is on: what that means, and Turn off Lite |
| `title(h1, sub)` | The page title and the muted line under it |
| `section(title, inner)` | A titled block, 24 px from the previous one |
| `card(inner)` | A padded box on the card colour |
| `note(text)` | A small muted explanation line |
| `stats([stat(value, label, cls?)])` | Number tiles, two a row on a phone, three wider |
| `table(head, rows, empty)` + `cellLink(href, main, sub)` | A table in a card; a cell that is a 44 px link (number bold gold, name under it) |
| `list(rows, empty)` + `listRow(href, cells, one?)` | Rows that are whole links, at least 56 px tall (matches, workspaces) |
| `chips([{href, text}])` | Small 44 px link buttons in a wrapping row (alliance teams, seasons, back to the event) |
| `button(href, text, primary?)` | A 44 px button; primary is gold, one per screen |

## Triggers

1. `?lite=1` on a full page's address (302 to its twin), or the `/lite/…` address itself.
2. "Control Scout Lite" in the footer of a page with a twin.
3. The static first paint (before the app's code runs) shows "Slow connection? Open Control Scout Lite" after
   `LITE_BOOT_S` (10 s), by CSS alone. The app's first render removes it.
4. In the app (`liteSuggest.ts`), while `navigator.onLine` is true: the page's own data (event, team, match,
   pick list) still missing after `LITE_SLOW_MS` (8 s), or `LITE_FAILS` (3) requests that couldn't reach the
   server within a minute. A page's data arriving quickly again withdraws the offer; "Not now" holds for the
   browser session.
5. Lite on (below).

## Lite on / off (sticky)

| Endpoint | Does |
|---|---|
| `GET /lite/on?next=<path>` | Sets `cs-lite=1` (a year), then 302 to `next` |
| `GET /lite/off?next=<path>` | Clears `cs-lite`, then 302 to `next` (a `/lite/…` path goes to its full page) |

`next` must be a path on this site; anything else goes to `/`. Plain links, no script, so the settings screen and
Lite pages can both use them. They work even while the owner has Lite switched off, so turning it off is never
out of reach.

While `cs-lite=1`: a page load (`Sec-Fetch-Mode: navigate`, or `Accept: text/html` from a browser that sends no
Sec-Fetch headers) of a full page that has a Lite twin 302s to the twin, on the server before the app's HTML.
Pages without a twin open normally, and moving around inside the app (no page load) stays in the app. On a Lite
page the header's Full version opens the full page this once (`?lite=0`, which the redirect skips), and a note
under the header offers Turn off Lite (`/lite/off?next=<the full page>`). Without the cookie, Lite's footer offers
Always open Lite (`/lite/on?next=<this page>`).

## Owner toggle

`venueLightMode` (owner console, Features tab; global, on by default). Off: every `/lite/…` address except
`/lite/on` and `/lite/off` 302s to its full page, `?lite=1` and the Lite-on redirect are ignored, and the footer
link, the in-app offer and the first paint's offer are hidden.

## No signal at all

The offline pack keeps that job. The service worker answers a failed `/lite/…` navigation with a redirect to its
full page, which opens from the cached app and reads the pack. (With Lite on and no signal, that full page's own
load fails too, so the cached app opens; there is no loop.)
