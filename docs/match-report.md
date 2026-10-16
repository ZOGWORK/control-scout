# Know your match (pre-match scouting report)

v1.6 Task 2. One page per match with everything a drive team or scout needs before it is played: the win
prediction, then every robot in the lineup grouped by alliance, with its OPR, rank, trend, watch-list flags
and (for workspace members) what the workspace's scouts noted about it.

## Where it lives

A dedicated route, not a sheet: `/events/:season/:code/match/:key`, for example
`/events/2025/USNJQ1/match/qual:0:12`. It can be shared in a team chat or opened from a link, and the
back button returns to the event. The server titles it for link previews and marks it `noindex` (thousands
of near-identical pages; the event page is the one to find). An unknown match is a 404.

It is one tap from:

- every match row (the event page's Matches, Odds and Playoffs lists, and match lists elsewhere): **Report**,
- an opened match's details: **Know your match**,
- the event page's LIVE panel, under the next match: **Know your match**.

## Data

Two requests, whatever the lineup:

| Request | Who | What |
| --- | --- | --- |
| `GET /api/events/:season/:code/matches/:key/report` | anyone, cacheable (`no-cache` with an ETag on an event day) | the match and its prediction, and per team: standing here, season OPR split (auto / driver-controlled / endgame / penalties) and world rank, event-by-event OPR trend, data flags |
| `GET /api/scout/workspaces/:id/match-report?season=&event=&teams=` | members only (401 / 403 / 503 as for reading entries), `private, no-store` | consensus per team (the Task 1 cache), which teams are on the workspace pick list, which are assigned to the asker at this event |

The workspace asked is the one the team page's consensus uses: the space remembered for the Scout page if it
is still the account's, else its first (a switcher shows with more than one). Signed out, no workspace, or a
refused answer: the report is OPR-only. It is never empty: OPR, rank, trend and data flags show for every
team, and members get **Scout this team** on any team with no entries yet.

While the event is live, the report refreshes on the event page's cadence (20 to 30 s, visible tab only).

## Watch-list flags

Rules in `src/shared/matchReport.ts`. Yours (worked out on the device, never sent):

- **Your team**: your team in Settings.
- **Assigned to you**: assigned to you at this event in the workspace (any status).
- **On your pick list**: on the workspace's shared pick list this season, or on your own shortlist.
- **Tracked**: one of your tracked teams.

From the data (this season, the same for everyone):

- **High penalties**: penalty OPR (points given away a match) in the season's top 15% of teams with 5 or
  more matches, and at least 1 point a match.
- **Inconsistent**: its alliances' non-penalty scores swing the most (standard deviation over average) in
  the season's top 15%, among teams with 5 or more qualification matches.
- **Rising**: the rise from its first event OPR this season to its latest (events with 4 or more matches,
  this one included) is in the season's top 15% among teams with two such events, and at least 15% and
  5 points. Most teams improve over a season, so only the steepest climbs get the flag.

A season with fewer than 20 teams that qualify for a rule raises no flag from it. Tap a flag to see why.
