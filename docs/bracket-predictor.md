# Playoff bracket predictor

Once an event posts its alliances, the Playoffs tab shows a call for every series, each alliance's odds of winning the event and reaching the final, and its **danger match**: the series it is most likely to lose. The odds update with every posted result. Live mode already refreshes the page every ~30 s.

Code: `src/shared/bracketOdds.ts` (the model, pure), `server/api/bracket.ts` (live ratings, cache), `src/components/PlayoffBracket.tsx` (UI), `scripts/bracket-replay.ts` (the measurement below).

## How it works

- **No new model.** A single playoff match is the engine's own call at level `playoff`: the forecaster's `explain`, the same number the match rows show. At that level alliances add up with no overlap. Each pair is priced both ways round and averaged, so red/blue order doesn't matter. A three-robot alliance fields its two strongest robots by rating, as the engine's event simulator does.
- **Series.** A best-of-N series is priced from that single-match chance and the current series score. Ties are replayed, so they don't count.
- **Championship odds.** 10,000 simulated runs over the bracket. Series already decided keep their real winners, and a series in progress starts from its real score. Runs are seeded from the posted results, so a page refresh with nothing new shows the same numbers. The server caches the result per posted state and ratings version. The 30-second live refresh only simulates again when a result or the ratings change.
- **Danger match.** Among an alliance's series still to play, the one it most often loses across the simulations, counting every opponent it could meet there. The card names its likeliest opponent in that series and the alliance's chance of winning the series when it plays it.

## Formats, read from what was posted

| Event | Format |
|---|---|
| 2 alliances | One best-of-3 final |
| 2024–25 on, 4 / 6 / 8 alliances | The engine's double-elimination brackets (`BRACKETS`): single matches; the grand final is replayed once if the lower-bracket alliance wins it |
| 2023–24, 4 alliances | Semifinals 1 v 4 and 2 v 3, then a final, all best-of-3 (posted as series 1, 2 and 0) |
| Anything else (3, 5, 7 alliances; posted results that don't fit the expected slots) | **Series calls only**: each posted series priced on its own, no championship odds, and a note says why |

A double-elimination event that numbers its series from 0 is shifted to the bracket's positions. Before alliances are posted, the tab says so. With alliances posted but no playoff schedule yet, the odds come from the alliances alone and a banner says the schedule isn't up.

## Measured accuracy (walk-forward)

`npm run bracket:replay -- 2023 2024 2025 --runs 2000` replays every finished playoff of 2023–24, 2024–25 and 2025–26 in the local database. Before each series' first match it uses the ratings rebuilt from earlier matches only, including that event's quals and earlier playoff series. The bracket sees only what was posted by then: earlier results, and the line-up of the series about to start. Later series' line-ups would give away who got there, so they're left out. The data covers 1,566 events and 10,598 series. Eight events had a format the predictor can't map, and one bracket never finished.

**Series calls**

| | Series | Favourite won | Brier | Higher seed won |
|---|---:|---:|---:|---:|
| All | 10,598 | **77.9%** | **0.151** | 71.8% |
| First round | 3,700 | 81.5% | 0.128 | 76.3% |
| Later rounds | 6,898 | 76.0% | 0.163 | 69.3% |
| Double elimination (2024–25 on) | 9,106 | 77.5% | 0.154 | 71.0% |
| Semifinals + final (2023–24) | 1,269 | 81.5% | 0.123 | 78.0% |
| 2-alliance final | 133 | 74.4% | 0.159 | 70.7% |
| Unknown format (calls only) | 90 | 70.0% | 0.182 | 57.8% |

"Higher seed won" is the naive call for comparison: the model beats it by about six points.

**Championship odds.** Calibration before the first playoff match: 7,370 alliance-events, Brier 0.072.

| Predicted | Alliances | Mean predicted | Won the event |
|---|---:|---:|---:|
| 0–5% | 4,111 | 0.8% | 1.2% |
| 5–15% | 827 | 9.2% | 10.8% |
| 15–30% | 559 | 21.7% | 21.1% |
| 30–50% | 431 | 39.4% | 38.3% |
| 50–70% | 411 | 59.8% | 58.4% |
| 70–100% | 1,031 | 88.6% | 86.7% |

Taken again before every later series (45,062 alliance-snapshots, Brier 0.066), the odds stay calibrated: 90.1% predicted vs 89.0% won in the top bucket.

An earlier version of the replay passed later series' line-ups to the bracket with their scores hidden. That leaked who reached each round and flattered the championship numbers (Brier 0.055). The figures above are from the corrected replay.

**Caveats.** The engine's fitted parameters were fitted on these seasons. This is the same in-sample caveat as the engine's own backtest track record. The replay prices matches without the partnership history (the live page has it), and it runs 2,000 simulations per snapshot instead of 10,000. Rerun `npm run bracket:replay -- --write` after an engine change. It regenerates `src/shared/bracketAccuracy.ts`, the line the Playoffs tab shows.
