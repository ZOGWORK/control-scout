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
