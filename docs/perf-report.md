# Performance: before and after (2026-10-13)

Tasks 2–5 of Sushil's list. Every number below comes from `npm run perf`
(`scripts/perf.ts`), measured the same way both times. The only exception is
the per-query timings, which come from `npm run query-profile`.

- "Local" is the production build on a dev machine.
- "VM" is https://controlscout.org (Oracle VM: 4 cores, 24 GB).
- "Render" is https://control-scout.onrender.com (free plan: 0.15 CPU, 512 MB).
- Remote runs are measured from the same machine over the internet.

## Home page (tasks 2, 3)

| | Before | After (local) | After (VM) | After (Render) |
|---|---|---|---|---|
| API data on the home page | 14.5 KB, 4 calls | 13.5 KB, 4 calls | 14.3 KB | 14.3 KB |
| API rounds (calls waiting on other calls) | 2 | **1** | 1 | 1 |
| JS downloaded (cold cache) | 1,112 KB, charts chunk included | **704 KB**, no charts chunk | 704 KB | 704 KB |
| Interactive, first visit, throttled 4G | 2,981 ms | **2,150 ms** | 2,166 ms | 2,549 ms |
| Interactive, warm, throttled 4G | 94 ms | 97 ms | 156 ms | 151 ms |
| API bytes on a repeat visit | 14.5 KB | 0.4 KB (cached 60 s, then revalidated) | 0.3 KB | 0.4 KB |

- The charts library loads only on pages that draw charts (team pages). Home,
  events and How it works don't download it.
- `/api/events?season=2026` (the full season list) went from 374.5 KB to
  283 KB by dropping fields no list uses. The home page asks only for this
  week's events (2.8 KB).
- "Rounds" counts the longest chain of calls that each start after another
  finished; answers from the browser cache don't count. Home used to be a
  lazily loaded chunk, so its calls waited for it. It's now in the main
  bundle, and all four calls start together.

## API, warm p95 (task 4; budget < 300 ms)

| Route | Before (Render) | After (local) | After (VM) | After (Render) |
|---|---|---|---|---|
| `/api/teams/4215` | ~1,000 ms | 21 ms | 32 ms | 104 ms |
| `/api/search?q=4215` | — | 4 ms | 15 ms | 39 ms |
| `/api/search?q=X Drvie` (typo) | — | 18 ms | 32 ms | 100 ms |
| `/api/events/2025/AUBRQ2` | 1,270 ms | 25–70 ms | 43 ms | 195 ms |
| `/api/teams/18360/matches?season=2025` | 711 ms | 21–180 ms | 65 ms | 190 ms |
| `/api/events?season=2026` (283 KB) | 1,125 ms | 72 ms | 67 ms | **1,020 ms** ✗ |

The query work (#19):
- `predictions` had no `(season, code)` index, so every event and team-match
  page scanned the table.
- Team match lists now start from the team's own lineup rows through a
  covering index.

In-process time fell from 69 ms to 26 ms for an event and from 184 ms to
25 ms for a team's matches. No hot route has an N+1. Most of the rest of
Render's time is its 0.15 CPU: the same handlers take 4–70 ms on real cores.

## Cold start (task 5; budget < 20 s to first paint)

| | First paint | Interactive (data on screen) |
|---|---|---|
| Local, empty disk (restores the 33 MB snapshot) | 1.8–2.4 s | 18.2–19.4 s |
| CI runner, empty disk | — | 21.0 s |
| **VM**, `systemctl restart` (data already on disk) | — | **8.7 s** to home HTML and API ready |
| **Render free**, first request after it had gone idle or redeployed | — | **25.5 s** for the first response |

**Plainly: Render free can't get cold starts under ~20 s.**
- Its disk is thrown away on every deploy and restart, so each boot restores
  the 33 MB snapshot on 0.15 CPU.
- It also sleeps after 15 minutes without traffic, so the next visitor waits
  for the whole boot. We measured 25.5 s for the first response after idle.
- The server paints quickly ("starting up" while it loads), but the data isn't
  there for that long.

The VM keeps its data on disk and has real cores: 8.7 s from restart to
ready, and it never sleeps.

## The budgets now gate every PR (task 5)

`.github/workflows/ci.yml` runs types, tests, the production build and
`npm run perf -- --budgets` on every pull request (#24). Any of these fails
the check:
- home interactive over 3 s (warm, throttled 4G);
- home data over 100 KB, or the home page downloading the charts chunk;
- a hot route's warm p95 over 300 ms;
- cold start over 20 s to first paint.

The first CI run failed on cold start (21.0 s, when the script still measured
time to interactive), which proves the gate works. `npm run audit:perf` runs
the same check locally.

## Also fixed along the way

- **Pack builds stalled requests (#22).** On the VM, the first request during
  the startup data cycle took 26.7 s: the offline pack build ran on the
  server's main thread. With `DATA_CYCLE=child` it runs in a separate
  process. Probed every 0.5 s through a full cycle, no request took over 1 s.
  The VM uses it; Render keeps the in-process cycle, because a second process
  won't fit in 512 MB (that's what the reverted worker in #13 ran into).
- **Cache headers (#18).** Public data is cached for 60 s and revalidated with
  ETags. Personal routes (any casing) and every error response are `no-store`.
