# Official result changes

Delayed or corrected official results reach Control Scout with the next sync,
but on their own they just overwrite what was there. This records what changed
so the event page and match details can show it (timeline only: no alerts).

## What is recorded

Every detail write of an event (the background cycle and the live fast lane
both go through `syncEvent` → `writeEventBundle` in
`server/data/resultChanges.ts`) compares the stored matches with the incoming
ones and writes a row per real change into `result_changes` (migration 33), in
the same transaction as the event's rows:

| kind | when | before / after |
| --- | --- | --- |
| `posted` | a match with no result now has one (or appears already played in a watched event) | null / the result |
| `revised` | a posted result's values changed: totals, non-penalty, auto, TeleOp, endgame, penalties, tips, bonus RPs, disqualified teams | both results; `fields` lists what moved |
| `revised` (`fields: ["result"]`) | the same feed withdrew a posted result | the result / null |
| `schedule` | an unplayed match's scheduled time or field moved, or a lineup changed | time, field and both lineups |

Each row keeps the feed the new value came from (`source`: FIRST primary or the
FTC Scout fallback), the feed of the value it replaced (`prev_source`) and when
the sync saw it (`checked_at`, not when FIRST changed it).

Rules that keep it honest:

- **Idempotent.** The same data polled again compares equal and adds nothing.
  Each row also has a UNIQUE `diff_key` (match, kind, the previous change's
  key, new value: the same in every copy of the database, unlike ids). The batch opens with a guard that fails it as a whole if
  the event's `detail_synced_at` is no longer the one read before diffing
  (another writer stored it in between: `npm run sync` holds no writer lease),
  and the write then reads and diffs again (3 attempts, then the event's sync
  fails and the next poll retries). A bundle is never saved without its changes.
- **No invented history.** The first detail write of an event after deploy is
  its baseline (`result_watch.since`); the UI says changes weren't tracked
  before then. No backfill.
- **Feed switches aren't revisions.** When the stored value came from the
  other feed, only totals and lineups are compared (the two split breakdowns
  differently). A value one side doesn't report (null) is never a revision.
- **Estimates aren't revisions.** FIRST can post totals before the breakdown;
  that split is an estimate (`matches.breakdown = 0`), so until both sides
  have a reported breakdown only totals are compared.
- **A lagging feed doesn't erase history.** When the other feed lists a scored
  match as unplayed, no withdrawal is recorded and the result is held in
  `result_watch.missing`; when a feed reports it again it's compared with the
  held result (not posted again).
- **Actual start isn't a reschedule.** FIRST replaces the scheduled time with
  the actual start once a match is played, so time is only compared while the
  match is unplayed.
- **Matches missing from a write are left alone** (a fallback feed may list
  fewer); nothing is recorded for them, but their last stored state is kept in
  `result_watch.missing` (up to 300 per event), so when one comes back it is
  compared with what it was rather than shown as newly posted.
- **The prediction ledger is never touched.** Calls logged before a match keep
  their values (`resultChanges.test.ts` checks the `predictions` rows are
  byte-identical after revisions).
- **Public data only.** The tables hold official match data; no scouting,
  accounts or workspace data. Both are in `PUBLIC_TABLES` (snapshot).

Season names for the values (bonus RPs, endgame) come from
`resultFieldLabels` in `server/data/seasons.ts`.

## Retention

The newest **500 changes per event** (`RESULT_CHANGES_PER_EVENT`). An event has
up to ~150 matches, so that covers several corrections per match; older rows
are dropped in the same transaction and counted in `result_watch.pruned`, which
the API returns so the UI can say so.

`npm run db:push` copies `result_watch` and `result_changes` with the matches;
for each watched event the target's history is replaced by the source's (so
the cap and `pruned` stay true there).

## API

- `GET /api/events/:season/:code/result-changes`
- `GET /api/events/:season/:code/matches/:key/result-changes` (`key` = `qual:0:12`)

Both return `ResultChangesView` (`src/shared/api.ts`): `trackedSince`,
`lastChecked`, `labels`, `changes` (newest first), `cap`, `pruned`.
`Cache-Control: no-cache` (revalidated with the ETag).

## Cost

Measured locally on a 150-match event (file database, 60 writes each): plain
bundle write median 90.8 ms / p95 144.7 ms; with the diff and no change
90.3 / 127.2 ms; with a revision every write 62.6 / 94.1 ms — the diff (two
indexed reads of one event) is within the noise of the write itself. Migration
32 is metadata-only on `matches` (`ALTER TABLE … ADD COLUMN`): migrations 7–33
applied to the 119k-match snapshot in 178 ms (after syncing with main, which added 30–32).
