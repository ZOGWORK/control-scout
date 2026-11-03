# Precompute-only check

Research brief item 10: prediction endpoints should read precomputed ratings, and a request should never compute ratings or OPR from scratch. This is a code inspection of `main` at f69a7936 (engine 3.3.0), plus the one fix in this PR.

## How ratings are built

Ratings come from `server/predict/engine.ts`. `ScoutForecaster.rebuild` replays the 3-season window into a `RatingBook` once per **data version**, which moves after a sync or a live result. Pages answer through `liveForecaster`: the last finished build is returned at once, and a newer one builds in the background (`yieldLoop` every 4,000 matches). Only the first build after a server start is waited for, and `server/index.ts` starts it at boot. Finished (frozen) seasons are read from the database once (`seasonData`).

OPR is solved by least squares (`solveOpr`, `solveLeastSquares`) only in background jobs: the stats job, the live lane's per-event refresh and records (`server/stats/job.ts`, `server/data/live.ts`, `server/stats/records.ts`). Those jobs write `team_event_stats`, `team_season_stats` and the records tables, which requests read.

A rebuild can be **started** by a page request when the data version has moved. For pages using `liveForecaster` it runs off the response path: the request is answered from the previous build. The one request path that uses `forecasterFor` instead, and so waits for the rebuild, is the simulated rankings (F3).

## Endpoints

| Endpoint / surface | Reads | Computes per request | Cache, debounce and caps | Verdict |
|---|---|---|---|---|
| `GET /predict/match` (Predict Lab), share card `/share/match.png`, `/predict` link previews (`seoMeta`) | The live build's book (`explain`), `team_reliability` | One match explanation (O(4 teams)) | The Lab asks only on submit, never per keystroke; the share card is cached by key + ETag and limited to 30/min for new cards | **OK** |
| `GET /predict/upcoming` | `matchViews` per event: stored `predictions` rows; unplayed matches go through `explain` | Explanations only | At most 40 events and 200 matches | **OK** |
| `GET /events/:s/:c` (event detail: field ratings, match rows, bracket, schedule difficulty) | `cachedEventDetail`: `team_event_stats` (OPR), `team_season_stats`, `book.get` per team | Lookups; the bracket is priced with `explain` per pairing | Detail kept per data version (TTL); bracket cached per posted state (200 kept); schedule difficulty cached (500 kept) | **OK** |
| `GET /predict/event` (current mode) | The live book plus `eventBook`, which folds in only this event's results the last sync hasn't stored yet (incremental, on a copy) | Monte Carlo event simulation (2,000 runs), no rating replay | `forecastMemo` (2 min, keyed by ratings version, 500 kept), limited to 30/min | **OK** (simulation, not ratings; the incremental fold is a few matches) |
| `GET /predict/event?mode=pre-event`, `GET /predict/partners?mode=pre-event` | `preEventView`: the season's ratings **replayed from its rated matches before the event's start** | Before this PR: a full replay of the season up to that day on every cache miss, and the memo is keyed per team, so each team at an event replayed again. Plus a bonus-model fit on results before the start | Memo 2 min; 30/min and 10/min | **Finding F1, reduced here** (see below) |
| `GET /predict/partners` (current) | The live book | Forced-partner simulations | `partnersMemo`, limited to 10/min | **OK** |
| Model vs field (`/events/:s/:c/disagreements`) for a **finished** event | `replayTo`: the season replayed to the event's last match | A full season replay on a miss | Stored in kv, keyed by a fingerprint of the replay's inputs and the event's seeding; rebuilt only when either changes or the engine does | **Finding F2** (replay on request, persisted) |
| `GET /events/:s/:c/simulated-rankings` | `forecasterFor` (the build for the **current** data version, not `liveForecaster`) + `eventBook` | Ranking simulation; after a data version change, the request **waits for the new build** (a full window replay) before the simulation starts | One at a time server-wide; 2.5 s simulation budget (the wait comes before it); kept per data version (200 kept) | **Finding F3** (waits on a rebuild) |
| `GET /projections/:s/:c` (+ stream) | Stored projections | None (the job simulates in the background, `server/projections/job.ts`) | ETag, `no-cache` revalidation | **OK** |
| `GET /predict/accuracy`, home track record | Stored `predictions` ledger (backtest + live) | Aggregation | Kept per data version and stats run, warmed in the background | **OK** |
| Teams, Compare, world rankings, Power Rankings | `team_season_stats`, `ranking_snapshots` (weekly replays done by the stats job, `server/stats/rankings.ts`) | None | Rankings limited to 120/min, ETag | **OK** |
| Match report | `team_season_stats`, `team_season_records`, `team_event_stats` | None | n/a | **OK** |
| Search answers (`/search?answer=1`, `server/api/answers/*`, `searchTeamStats`) | Search index, stats tables | None from ratings | 1 s input debounce (`SEARCH_DEBOUNCE_MS`); results capped at 25 (default 12); Bruno and refine limited to 20/min | **OK** |
| Records (`/records`), advancement odds there | Records tables; pre-event odds filled by the stats job (`fillAdvancementOdds` → `preEventForecasts`, one replay per season) | None | Limited to 120/min (CSV 10/min) | **OK** |
| Lite pages (`/lite/…`) | `cachedEventDetail`, `matchViews` (same as above) | Same as the rich pages | Cached like the API | **OK** |
| Event-day bundle (`/api/bundles`) | The live build's book, cut to the event's teams (`sliceBook`) | A slice of the book, no replay | Built bundles cached; limited to 30/min | **OK** |
| Offline packs (`/packs/*`) | Files written by `npm run packs` / the cycle (`server/packs/build.ts`) | None | Static files | **OK** |
| Offline / venue estimates on the device (`src/lib/localProjection`, `src/lib/offline/answer.ts`) | The pack's book (`RatingBook.fromData`) | Simulation plus an incremental fold of results the pack doesn't have yet; never a season replay | On the device | **OK** |
| Bonus-RP model (`ScoutForecaster.bonusModel`) | The season's stored results | A logistic fit on the latest 2,000 alliances, on first use | Once per build | **OK** (a small fit, kept for the build) |

## Findings

**F1, pre-event views replayed the season per request (reduced in this PR).**

The "Before the event" odds and partner scenarios need ratings as they stood the day before an event. `preEventView` built them by replaying the season's rated matches up to that day. That happened on every memo miss, and the memo key includes the team, so at one event each team's "Before the event" view replayed the season again. Every event starting on the same day did as well.

This PR adds `ScoutForecaster.bookBefore`, which keeps the replayed book per season and start instant for the build. A build's data never changes, so nothing goes stale. At most 8 books are kept. Each caller gets a copy, so a view can never change the kept book. A copy gives the same numbers: the test checks that the forecast equals a fresh build's first replay. `server/predict/engine.test.ts` checks that two teams' views at one event and two events on the same day share one replay, and that another day replays again.

What is left: the **first** ask for a given start day after each data version still replays in the request. It is limited to 30/min and memoized. Removing it completely would mean the background job storing pre-event books (or pre-event forecasts) per event. The projections job already builds one for its pre-event baseline (`server/projections/job.ts`). That is a bigger change, left as a follow-up.

**F2, a finished event's model-vs-field comparison replays on a miss.**

`finalView` in `server/api/disagreements.ts` calls `replayTo` (the season up to the event's last match) when its kv entry is missing or stale. The result is persisted with a fingerprint of everything the replay reads, so each finished event replays once per change to its inputs, not per visit. A data change before the event, such as a corrected earlier result, invalidates every later event's entry. Moving it fully off the request path would mean computing these in the stats job, which already runs weekly replays (`server/stats/rankings.ts`). Listed, not changed here.

**F3: simulated rankings wait for a rebuild after a sync.**

`simulatedRankings` (`server/projections/rankingSim.ts`) calls `forecasterFor(season)`, the build for the current data version, instead of `liveForecaster`. After a sync moves the version, the first click waits for the full window replay before its 2.5 s simulation budget starts. The wait is one rebuild per version, shared by every caller and also started by the background refresh, and the click is only offered before an event's quals start. Even so, it is a request waiting on rating computation. The likely fix is `liveForecaster` (key the kept answer by `liveVersion` alone), with a test. Listed, not changed here.

**No request solves OPR.** `solveOpr` and `solveLeastSquares` run only in the stats job, the live lane and records, all in the background.
