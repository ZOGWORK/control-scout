# Public usage figures

The home page's "Control Scout, in use" panel reads `GET /api/public-usage`. It
publishes two numbers about the site itself, nothing about any visitor:

| Field | What it counts | What it isn't |
| --- | --- | --- |
| `totals.pageViews`, `daily[].pageViews` | Page loads recorded by `POST /api/collect` | All traffic: only browsers whose visitor chose "Allow" send them, and browsers sending Do Not Track or Global Privacy Control, bots and automated browsers are never counted |
| `totals.sessionStarts`, `daily[].sessionStarts` | The first recorded page of a browser tab's session (a `sessionStorage` flag) | People: one person with two tabs starts two sessions, and a browser blocking storage may start one per page |

Days are UTC. The window is the last 30 days, today included (`to`), and today is
still partial. If counting began inside the window, `measuredFrom` is the first
recorded day and the series starts there: earlier days weren't measured, so they
are left out rather than shown as zeroes. A day after that with no views is a
real zero.

## Publishing

Off by default. Set `PUBLIC_USAGE_ENABLED=1` (or `true`) in the server's
environment (`shared/.env` on the VM; see [deploy.md](deploy.md)) and restart.

| State | Response | Panel |
| --- | --- | --- |
| Not set, or anything but `1`/`true` | `status: "unavailable"`, `reason: "not-published"`, `totals: null` | Says the figures aren't published |
| On, nothing ever recorded | `reason: "no-data"`, `totals: null` | Says nothing has been recorded yet |
| On, the aggregates can't be read | `reason: "error"`, `totals: null` (not cached) | Says they couldn't be loaded, with a retry |
| On, recorded | `status: "available"`, `totals` and `daily` | The figures, dated |

An unavailable answer is never a zero. The response is read from the daily
aggregate table at most once a minute (shared by everyone) and carries
`generatedAt` and `measuredThrough`.

## What stays private

Only the two sums above are read for this endpoint. The route, referrer, screen
and language breakdowns stay in the owner's `GET /api/stats/summary`, which still
needs `Authorization: Bearer <STATS_TOKEN>` (404 when no token is set). The
collector, consent banner, DNT/GPC handling and bot filter are unchanged.
