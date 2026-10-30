# Schedule difficulty

FTC qualification schedules are random 2v2 draws. One team can meet the strongest robots twice while another
plays beside them. Schedule difficulty puts a number on that luck for every team at an event, and always says
it in words: *"Opponents average +38 over the field's, partners −12. 3rd-hardest of 24."*

## How it's worked out

Code: `src/shared/scheduleDifficulty.ts` (pure, used by the server, the offline packs and the device).

Per team, from the engine's ratings (non-penalty points per robot) and the posted qualification schedule:

- **opponents** = mean rating of its scheduled opponents − the field's mean rating
- **partners** = mean rating of its scheduled partners − the field's mean rating
- **difficulty** = opponents − partners (points; above 0 = harder than average)

Details:

- **The field's mean leaves out the team itself.** A random draw never pairs a team with itself, so a strong
  team's opponents are on average a little weaker than the whole field. Against the field-without-itself, every
  team's expected difficulty under a random schedule is 0.
- **Normalised across the field:** `rank` (1 = hardest of `of`) and `z` (standard deviations from the field's
  mean difficulty). The word on the chip comes from `z`: Hard (≥ 1), Tough (≥ 0.4), Average, Kind (≤ −0.4),
  Easy (≤ −1).
- **Ratings** are read exactly as the Monte Carlo projections read them (`rankingInput` in
  `src/shared/projectionInput.ts`): the season's rating book with any fresh results from this event folded in.
  A team with no result yet this season gets the engine's existing prior (its last-season rating carried over,
  or the rookie prior). Nothing new is invented.
- **Surrogate appearances** don't count toward a team's rank, so they're left out of that team's own schedule.
- **Two views.** `full` over every qualification match. Once quals are under way, `remaining` over the matches
  still to play (null before the first result, after the last, and once the event's last day has passed).
- No figure without a posted schedule (the simulator's random stand-in schedule is never rated), or for a
  field under 6 teams.

## Where it shows

- **Event page, Rankings tab:** every team, hardest first, with the plain line. Mid-event, "Still to play"
  leads and "Full schedule" is one tap away; each row also names the other view's rank.
- **Team page:** one card per event of the season with a posted schedule.
- **API:** `GET /api/events/:season/:code` → `scheduleDifficulty` (the whole field);
  `GET /api/teams/:number` → `schedule` (that team, per event). Server helpers in
  `server/predict/scheduleDifficulty.ts`: `eventSchedule(season, code)` (cached per data version) and
  `seasonScheduleDifficulty(f, leanEventInputs(season))` for a whole season. Anything with a `Forecaster` and an
  `EventInput` can call `eventScheduleDifficulty(f, ev)` directly.
- **Offline packs:** a `team_schedule_difficulty` table in each season pack (`src/shared/packSchema.ts`),
  computed when the pack is built (about 12 s for a full season). Older packs without it show no figure.

## Does it explain anything? Measured on past seasons

`npm run schedule:eval` (`scripts/schedule-difficulty-eval.ts`), run 2026-10-30 on the local database.

Every finished 2023, 2024 and 2025 event with all qualification matches played and at least 12 ranked teams,
league meets left out (their FIRST rank is the league's running standing): 1,794 events, 43,170 team finishes.

Per team: **rating rank** = its place in the field by the engine's rating; **qual rank** = its official rank;
**gap** = (qual rank − rating rank) / (field − 1), so + means it finished lower than its rating said. Then the
correlation of the gap with the team's full-schedule difficulty (z). 95% intervals from 400 bootstrap
resamples of whole events (a field's teams aren't independent).

| Ratings used | r | R² (share of the gap explained) | Places per 1 SD of schedule | Hardest quarter | Easiest quarter |
|---|---|---|---|---|---|
| At each event's start (no hindsight; what the site would have shown that morning) | **0.216** [0.205, 0.229] | **4.7%** | **+2.0** | +2.3 places | −2.5 places |
| Season-end (hindsight; a steadier measure of each robot's real strength) | **0.325** [0.312, 0.337] | **10.6%** | **+2.3** | +2.9 places | −2.9 places |

By season (start ratings / season-end ratings, R²): 2023 3.9% / 9.8%, 2024 4.9% / 11.9%, 2025 5.1% / 10.0%.

Reading it: a schedule one standard deviation harder than its field's average costs a team about 2 places in the
final qualification ranking against where its rating would put it. Teams with the hardest quarter of schedules
finished on average 2.3–2.9 places below their rating rank, the easiest quarter 2.5–2.9 places above. The rest of
the gap is everything else: rating error (much bigger with start-of-event ratings, which is why the hindsight
row explains more), match-to-match variance, bonus ranking points, penalties and breakdowns.

### Variants compared on the same teams

| Formula | R², start ratings | R², season-end ratings |
|---|---|---|
| opponents − partners (shipped; the owner's spec) | 4.7% | 10.6% |
| 2 × opponents − partners (weights both opponents) | 4.7% | 10.8% |
| opponents only | 3.0% | 7.3% |
| −partners only | 3.4% | 7.5% |

Both halves matter, and weighting opponents twice adds nothing measurable without hindsight, so the shipped
formula stays the simple one that reads as one plain line.
