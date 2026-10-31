# Light version (venue mode)

A text-first rendering of the pages people open at a venue on one bar of signal. It is a rendering mode, not a
second app: the server builds plain HTML from the same functions the API answers with, trimmed to the fields
the page shows.

| Light page | Full page | Data |
|---|---|---|
| `/lite/events/:season/:code` | `/events/:season/:code` | `cachedEventDetail` → `liteEvent` |
| `/lite/events/:season/:code/match/:key` | `/events/:season/:code/match/:key` | `matchDetail` → `liteMatch` |
| `/lite/teams/:number[?season=]` | `/teams/:number[?season=]` | `teamProfile` + `matchViews` → `liteTeam` |
| `/lite/picklist?space=&season=` | `/scout?space=&tab=data&view=picklist&season=` | `readPickList` + `teamSummaries` → `litePicks` |

Code: `src/shared/lite.ts` (the address rule, both ways, and the thresholds), `server/lite/trim.ts` (trimming),
`server/lite/render.ts` (HTML), `server/lite/routes.ts` (routes and `?lite=1`), `src/lib/liteSuggest.ts` and
`src/components/layout/LiteSuggest.tsx` (the in-app offer), `server/bootShell.ts` (the first paint's offer).

## Rules

- **No images, no charts, no scripts.** Tables instead of charts, system fonts, one inline stylesheet. The page's
  CSP is `default-src 'none'; style-src 'unsafe-inline'`, so nothing else can load.
- **Never a trap.** Every light page has a "Full version" button at the top right, including 404s and errors.
  Nothing makes light mode sticky: links between light pages stay light, everything else is the full app.
- **Shared formatting.** Numbers, dates, win odds and award names come from `src/shared/format.ts`, which the
  app's `src/lib/format.ts` re-exports, so the two renderings can't drift. Calls show their confidence word.
- **Caching.** Public pages: `public, max-age=60, stale-while-revalidate=300` with an ETag, like the API;
  `no-cache` on an event day (the event is live, or the team has unplayed matches). The pick list is
  `private, no-store` and needs the same gate as its API: signed in (401), the workspace's scouting switched
  on (403), a member (403).
- **Search engines** get a canonical link to the full page.
- **Budget:** low tens of KB gzipped per page (the test holds an 80-match event under 30 KB).

## Triggers

1. `?lite=1` on a full page's address (302 to its twin), or the `/lite/…` address itself.
2. "Light version" in the footer of a page with a twin.
3. The static first paint (before the app's code runs) shows "Slow connection? Open the light version" after
   `LITE_BOOT_S` (10 s), by CSS alone. The app's first render removes it.
4. In the app (`liteSuggest.ts`), while `navigator.onLine` is true: the page's own data (event, team, match,
   pick list) still missing after `LITE_SLOW_MS` (8 s), or `LITE_FAILS` (3) requests that couldn't reach the
   server within a minute. A page's data arriving quickly again withdraws the offer; "Not now" holds for the
   browser session.

## Owner toggle

`venueLightMode` (owner console, Features tab; global, on by default). Off: every `/lite/…` address 302s to its
full page, `?lite=1` is ignored, and the footer link, the in-app offer and the first paint's offer are hidden.

## No signal at all

The offline pack keeps that job. The service worker answers a failed `/lite/…` navigation with a redirect to its
full page, which opens from the cached app and reads the pack.
