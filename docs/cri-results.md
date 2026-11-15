# Chicago Robotics Invitational results

FIRST lists the Chicago Robotics Invitational (FPECRI, a Premier Event) but publishes no teams, matches or awards
for it. CRI posts its full results on its own site, results.chicagoroboticsinvitational.com, which reads a public
JSON API (`/api/v1/{season}/events/{slug}/teams|matches|rankings|alliances|awards`, and `/matches/{name}` for one
match's split). Scout imports them as the event's ordinary results.

## What is imported

- Every CRI edition the site lists (`/api/v1/seasons`, offseason seasons named `YYYY-YYYY…cri`) whose season Scout
  covers and has a CRI-named event for. As of 2026-11-15: **2025–26 (DECODE)** and **2024–25 (INTO THE DEEP)**, both
  FPECRI. The site's 2023, 2022 and 2021 editions have no event on Scout (FIRST never listed them), and 2018 is
  before Scout's seasons; the sync reports them as skipped.
- Teams, qualification and playoff matches with each alliance's auto / TeleOp / endgame / penalty split, standings
  (ranking points, tie-breaker, record), alliances (captain, two picks, a fourth member as the backup) and awards.
  CRI's own awards (Star Image, Water Tower, Loop…) keep their names; Winning and Finalist Alliance are filed as
  FIRST's types; an alliance award goes to every member alike.
- Practice matches are left out. The per-alliance score sheets are not used: the site has posted both alliances'
  sheets identical in some matches.

Code: `server/sources/cri.ts` (read + parse), `server/data/criResults.ts` (when and whether to write),
`server/data/criResults.test.ts` (real responses in `server/sources/fixtures/cri-*.json`).

## Quirks

- 2025–26's rankings are numbered from the bottom on the API (its rank 1 went 1–7 with the fewest ranking points; its
  rank 38 captained the 1st alliance). When the posted rank 1 has fewer ranking points than the last team, the
  numbers are turned around. 2024–25's are posted the right way and kept.
- `penalty` on a match page is what that alliance gave away; the opponent's total includes it (Scout's `pen`).
- Match times come with the venue's offset and are stored as the venue's wall clock, FIRST's own format, so clip
  placement reads them like FIRST's. 2024–25 has no match times on the site.
- A match without its page keeps its totals and is marked as having no breakdown.

## Never over FIRST

- The importer only writes an event whose stored results are its own (source `cri`) or that has none. Once FIRST
  posts matches for the event, its write replaces these and the importer leaves the event alone from then on.
- A FIRST (or fallback) read of the event that comes back with no matches and no rankings keeps the stored CRI
  results and refreshes only the event's own row (`keepsSiteResults` in `server/sync.ts`).

## Politeness

- Read from the data cycle at most once a week (`CRI_EVERY_MS`), only on the data host (FIRST credentials set). The
  week counts from a read that finished with nothing failed. Each attempt is marked before it starts, so a read that
  failed, or that a deploy stopped midway, is tried again after `CRI_RETRY_MS` (6 hours), never sooner.
- One request at a time with a pause (1.5 s; 0.6 s for the small per-match pages). The lists and match pages are
  cached in `kv` (`cri:raw:<season>:<code>`); an unchanged site costs the lists alone, and a match page is read again
  only when that match's totals change. The first read is about 140 requests (~2 minutes); later weeks ~15.

## On the page

The event page says "Results from chicagoroboticsinvitational.com", linked to the event's page on the site, and the
source line under the summary names the site and says FIRST has not published the results. Stats for a season the
importer wrote are rebuilt in the same cycle.
