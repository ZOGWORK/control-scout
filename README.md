# FTC Control Scout

Free-forever FTC scouting and predictions for **every** team. Search any team,
event or match; read OPR breakdowns and trends; ask the prediction lab who
wins a what-if alliance or how likely a team is to advance from any event —
and check the public track record of how often those predictions came true.

Sister app of [Control Point](https://tryctrlpoint.org) (team management).
Same design language, and the **same prediction engine**: both apps run
[`@control-scout/predict-engine`](packages/predict-engine), one versioned
package, so predictions can never be better in one app than the other.

## Stack (and why)

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22+ · Express · TypeScript run by `tsx` | Same as Control Point: one runtime, one mental model, no build step for the server. |
| Database | SQLite through `@libsql/client` | A local file in development and on a single box; the same client talks to Turso if hosting ever needs a networked database. Zero ops. |
| Web | React 19 · Vite · Tailwind v4 · Radix (shadcn-style components copied into `src/components/ui`) · Motion · Recharts | Control Point's exact UI stack and theme tokens, so the two apps feel like family. |
| Predictions | `packages/predict-engine` (pure TS) | Runs identically on the server and in the browser — offline predictions from the lite pack need no server. |
| Deploy | Dockerfile + plain Node | Portable: Oracle VM / Render / a Mac mini cluster are all just "run the container". |

## Run it locally

```bash
npm install
cp .env.example .env        # add FIRST Events API credentials (optional but recommended)
npm run seed:scout          # optional: import a local FTC Scout cache for instant history
npm run sync                # pull events/teams/matches from FIRST (resumable)
npm run stats               # compute OPR + ratings + calibration ledger
npm run dev                 # API on :3000, web on :5173
```

`npm test` runs every test; `npm run lint` type-checks.

## How data flows

```
FIRST Events API (primary) ─┐
FTC Scout API (fallback)  ──┴─> sync job ─> SQLite ─> stats job ─┬─> REST API ─> web app
                                                                 ├─> prediction ledger (track record)
                                                                 └─> pack builder ─> /packs/*.db + latest.json
```

* **Sync** is idempotent and resumable. Finished seasons are frozen once
  complete; only the current season refreshes (daily, hourly on event days).
* **Stats** recomputes per-team, per-event OPR (ridge-regularised, quals only,
  surrogates excluded) and the engine's rating book; it also writes a
  prediction for every not-yet-played match into the **calibration ledger**
  before the match happens, and scores it afterwards.
* **Packs**: a lite pack (team ratings, < 10 MB) runs predictions fully offline;
  per-season full packs hold every event, match and team.

## Repository layout

```
packages/predict-engine/   shared prediction engine (Control Scout + Control Point)
server/                    API, sync, stats, ledger, auth
src/                       web app
scripts/                   one-off and scheduled jobs (sync, stats, packs, backtests)
docs/                      methodology and runbooks
DECISIONS.md               every judgment call made without the product owner
```

## License

GPL-3.0-only, same as Control Point. Data © FIRST and FTC Scout contributors;
see the About page for attribution.
