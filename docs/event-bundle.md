# Event-day bundle and frozen match-day snapshots

One tap before leaving for the venue downloads one bundle for one event. It holds what a team needs at the
venue when the signal drops, and says everywhere what time its data is from.

## What's in it

| Section | What | Where it's used with no signal |
| --- | --- | --- |
| `event` | The event detail exactly as `/api/events/:season/:code` serves it: teams, schedule, rankings, alliances, the predictions made for its matches | The event page (`lib/offline/answer.ts` answers the read from the bundle) |
| `ratings` | The season's rating book cut to the event's teams (`sliceBook`) | Predictions in the browser with the lite pack's engine, when the lite pack isn't on the device (`lib/offline/predict.ts`) |
| `reports` | A frozen Know your match report for each of your team's matches (up to 24), static HTML | `/events/:season/:code/match/:key` with no signal (or, for a report the bundle holds, no answer in 4 s) |
| `picklist` | The workspace pick list, static HTML (members only) | `/bundle/:season/:code/picklist` when the live list doesn't load |
| `rules` | The question-box rules reference for the season (`src/shared/rules`), static HTML, while the `rulesReference` switch is on; pluggable (`setRulesProvider`) | The bundle page |
| `venue` | Venue card: name, venue and address, dates, time zone, event site (from the event's own data) | The bundle page |

A typical event measured on the local data: 20 teams, 31 matches, 8 reports, 16 KB gzipped; 28 teams, 46 matches,
10 reports, 21 KB; a 48-team championship with 13 reports, 32 KB.

## The event pack

Two more sections make the whole event work with no signal, with the same numbers as online:

| Section | What | Where it's used with no signal |
| --- | --- | --- |
| `api` | The server's own JSON for API GET paths (`PackApi`): for every team in the field and every lineup, `/api/teams/N` (with and without `?season=`), its season matches, report cards and schedule difficulty; for every match, its detail and its Know your match report; the event's projections and pick ratings | Team pages, match pages, the opened match on the event page, the pick helper (`lib/offline/answer.ts` `packAnswer`) |
| `compare` | Each team's Compare column for the season (`compareBlockOf`) and the latest season it has results in | `/api/compare` for any of the pack's teams (`compareFromPacks`) |

- The list of paths is one array, `PACK_READS` in `server/packs/eventApi.ts`. Each path is read through the function its
  route calls (`server/api/reads.ts`, `teams.ts`, `matchReport.ts`, …), in process: never a re-implementation. Another
  page's data goes in by adding an entry there.
- Keys are `packPath()`s (`src/shared/eventBundle.ts`): decoded, lower-cased, the query sorted, so the app's request
  finds its answer however it spells it. An answer identical to another is stored once (`same`); a route's 404 is kept
  as such (`errors`), so offline says the same thing.
- Broken packs don't ship: `assertComplete` fails the build when a team of the event (or a match on its schedule) is
  missing.
- Compare offline is assembled by `compareFromParts` (`src/shared/compare.ts`), the function the server's
  `compareTeams` calls too, from the pack's columns and the teams' season matches. A team in no saved pack: "Team X
  isn't in your downloaded event packs".
- A match two of the event's teams played is the same JSON in both teams' lists: each is stored once (`pool`), the
  lists holding indexes, and `packLookup` gives the lists back whole (`poolMatches`, about 20–25% smaller).
- A pack is built once per data version (`packApi`, kept up to 10 minutes), not on every manifest look. After a sync,
  the packs of events asked for in the last two days are built again in the background (`rewarmPacks`, on the
  server's 15-second tick), so the next look doesn't wait for one.
- A manifest whose build takes longer than `PREPARE_MS` (2.5 s; a cold pack after a sync takes 5–15 s on a warm
  server) answers `202 {preparing: true, retryAfterMs}` at once and the build goes on; the app asks again every few
  seconds, up to 90 s (`fetchBundleManifest`). No request is held open on venue wifi.
- Match videos are never in the pack: with the page from the pack (or the browser offline) the match's video buttons
  say "Needs a connection" (`components/MatchClip.tsx`).
- The manifest lists the paths (`apiPaths`), kept with the saved bundle, so `lib/api.ts` knows which reads a pack
  can answer (they get the offline timeout) without opening it.

Measured on the local data (gzipped, 2025 season): USMIMIQ1, 34 teams and 54 matches, 22 KB before the pack, 168 KB
with it (280 paths; 207 KB before the match pool); USCHSCMPRDCA, a 48-team division with 98 matches, 31 KB before,
277 KB with it (438 paths; 369 KB before the pool). The event page offers it in one tap: "Download for offline · <size>".

## Endpoints

- `GET /api/bundles/:season/:code/manifest?team=N&workspace=ID`: the manifest (`BundleManifest`): contents, each
  section's version and size, the bundle's version, size and SHA-256, the event's teams.
- `GET /api/bundles/:season/:code/file?team=N&workspace=ID&v=VERSION`: the bundle, gzipped JSON (`EventBundle`).

Both are `private, no-store`. With `workspace`, the signed-in account must be a member right now
(`workspaceAccess`): 401 signed out, 403 otherwise. A build is kept 5 minutes per asker so the file is the one the
manifest described; if the data moved on meanwhile, the device asks for the manifest again and downloads that.
Both follow the `offlinePacks` feature toggle.

## Versions and updates

Each section's version hashes its contents, leaving out keys that only say when something was computed
(`predictedAt`, `checkedAt`, the rating book's clock). The bundle's version hashes the sections' versions, so the
same data gives the same version. The Download page asks for each saved bundle's manifest and offers Update, or
Update all, when the version differs, as it does for season packs.

## On the device

One bundle per event: the bytes in IndexedDB (`bundle:<season>:<CODE>` in the packs store), the list in
localStorage (`cs-event-bundles`). Downloading again replaces it. Nothing is decoded until a page needs it with no
signal or the bundle page opens. Remove one, or every finished event's, on the Download page.

## Snapshots

`server/packs/snapshotHtml.ts` renders the reports and pick list at build time: every value escaped, no scripts,
no external resources, a `default-src 'none'` CSP, the app's colours in light and dark, and the snapshot time
printed in the page itself (in the event's time zone). The app shows them in a sandboxed frame (no
`allow-scripts`) under `SnapshotBanner`: "Snapshot from 07:12, may be stale", the age, ticking, and past two hours a
plain warning to check the live version first.

## The rule

Live data always wins. A bundle answers only when the server can't be reached (or doesn't answer in
`OFFLINE_TIMEOUT_MS`); the first live answer replaces it (`lib/api.ts`).
