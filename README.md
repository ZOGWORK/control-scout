<p align="center">
  <img src="brand/wordmark-master.png" alt="Control Scout" width="420" />
</p>

<h3 align="center">Free-forever FTC scouting and predictions for <em>every</em> team.</h3>

<p align="center">
  <strong><a href="https://controlscout.org">Live Demo — controlscout.org</a></strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white" alt="Node.js 22" />
  <img src="https://img.shields.io/badge/SQLite-libSQL-003B57?logo=sqlite&logoColor=white" alt="SQLite via libSQL" />
  <img src="https://img.shields.io/badge/License-GPL--3.0-blue" alt="GPL-3.0" />
</p>

Search any team, event or match; read OPR breakdowns and trends; ask the
prediction lab who wins a what-if alliance or how likely a team is to advance
from any event — and check the public track record of how often those
predictions came true.

Sister app of [Control Point](https://tryctrlpoint.org) (team management).
Same design language, and the **same prediction engine**: both apps run
[`@control-scout/predict-engine`](packages/predict-engine), one versioned
package, so predictions can never be better in one app than the other.

## Screenshots

<!-- Screenshots are captured from the live app with `npm run shots` (see AGENTS.md). -->

| Home | Team page |
|---|---|
| <img src="docs/screenshots/home.png" alt="Control Scout home" /> | <img src="docs/screenshots/team.png" alt="Control Scout team page" /> |

## Features

**Scout**
- Instant search across every team, event and match
- Team pages with full season history and event results
- Event pages with rankings, matches and insights

**Analyze**
- OPR breakdowns (auto, teleop, endgame) computed by least squares over quals only
- Season trends and per-event performance charts
- Stat tables with sorting and CSV export

**Predict**
- Prediction lab: what-if alliances, head-to-head win odds
- Advancement likelihood for any team at any event
- Public calibration ledger — every prediction scored against reality

**Access**
- Free forever, no paywall
- No account needed for core features; personal data stays on your device
- Offline data packs (lite < 10 MB for predictions, full packs per season)

## Stack (and why)

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22+ · Express · TypeScript run by `tsx` | Same as Control Point: one runtime, one mental model, no build step for the server. |
| Database | SQLite through `@libsql/client` | A local file in development and on a single box; the same client talks to Turso if hosting ever needs a networked database. Zero ops. |
| Web | React 19 · Vite · Tailwind v4 · Radix (shadcn-style components copied into `src/components/ui`) · Motion · Recharts | Control Point's exact UI stack and theme tokens, so the two apps feel like family. |
| Predictions | `packages/predict-engine` (pure TS) | Runs identically on the server and in the browser — offline predictions from the lite pack need no server. |
| Deploy | Plain Node on the Oracle VM (Dockerfile too) | Portable: the VM or a Mac mini cluster are all just "run the app". |

## Run it locally

```bash
npm install
cp .env.example .env        # add FIRST Events API credentials (optional but recommended)
npm run seed:scout          # optional: import a local FTC Scout cache for instant history
npm run sync                # pull events/teams/matches from FIRST (resumable)
npm run stats               # compute OPR + ratings + calibration ledger
npm run packs               # optional: build the offline packs served at /packs
npm run dev                 # API on :3000, web on :5173
```

`npm test` runs every test; `npm run lint` type-checks.

`npm run sync` needs FIRST credentials (it lists events from FIRST, and falls
back to FTC Scout per event when FIRST has no data for one). Without them, the
app still starts but shows empty states until data arrives via `seed:scout` or
a copied database. Without a Resend key, sign-in is hidden and everything
personal stays on the device.

### Tools

| Command | What it does |
|---|---|
| `npm run shots -- /teams/18360 --both` | Screenshots for PRs (real servers, 2x, waits for data). See [AGENTS.md](AGENTS.md). |
| `npm run audit` | The self-audit sweep: every route at desktop + mobile, console, overflow, labels, loading and API-down states ([docs/self-audit.md](docs/self-audit.md)). |
| `npm run db:export` | A consistent single-file copy of the database (for moving it to a server). |

## Hosting

* https://controlscout.org runs on the Oracle VM next to Control Point:
  [docs/deploy.md](docs/deploy.md) (deploys, rollback, alerts). A `Dockerfile`
  runs anywhere else. (Render was retired on 2026-10-14.)

## How data flows

```
FIRST Events API (primary) ─┐
FTC Scout API (fallback)  ──┴─> sync job ─> SQLite ─> stats job ─┬─> REST API ─> web app
                                                                 ├─> prediction ledger (track record)
                                                                 └─> pack builder ─> /packs/*.db + latest.json
```

FTC New Jersey's events page (newjerseyftc.com) is a third, provisional source: the sync stores its
registered teams and event details apart from FIRST's data (`event_provisional`), and the event page
shows them, labelled, only until FIRST posts the event's team list or schedule (`server/data/provisional.ts`).

* **Sync** is idempotent and resumable. Finished seasons are frozen once
  complete; only the current season refreshes (daily, every 15 min on event days on the VM).
* **Stats** recomputes per-team, per-event OPR (least squares, quals only,
  surrogates excluded) and the engine's rating book; it also writes a
  prediction for every not-yet-played match into the **calibration ledger**
  before the match happens, and scores it afterwards.
* **Packs**: a lite pack (team ratings, < 10 MB) runs predictions fully offline;
  per-season full packs hold every event, match and team.
  **Downloaded online, run only offline:** returning visitors get the lite pack
  in the background (`src/lib/packSync.tsx`, rules in `src/lib/packPolicy.ts`)
  and "Save offline" stores a season, but both only store bytes. Nothing opens,
  decodes or queries a pack (and sql.js never loads) while the server answers;
  the app switches to them only when the browser is offline or a read the pack
  could answer gets a network error or no answer within 4 s, shows an
  "Offline, showing saved data" badge, and switches back on the next server
  answer (`src/lib/api.ts`).

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
