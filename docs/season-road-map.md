# Season road map

The team page's **Season road map** (`src/components/RoadMap.tsx`, served by
`GET /api/teams/:number/roadmap?season=`, built in `server/api/roadmap.ts`)
lists a team's events in date order with their advancement state. Where the
team's home region has an encoded ruleset for the season, it also shows FIRST's
official advancement points at each event and a **What's needed next** panel for
the next stop.

## The rule: no number without an encoded ruleset

A "what's needed" figure is only ever computed from a ruleset in
`server/data/roadmapRules.ts` for that exact region and season. Every other
region gets the neutral view: results so far, FIRST's published advancement
lists (advanced / didn't take a slot / pending), and the next event. Every
encoded ruleset shows its sources and season on the page.

## What's encoded (2026–27, BIOBUZZ)

Sources read 2026-10-30.

| Region | Code | Path | Sources |
| --- | --- | --- | --- |
| New Jersey | USNJ | League meets → league tournament (4 leagues, 2 tournaments each) → New Jersey Championship → FIRST Championship / Premier | [Important season dates](https://newjerseyftc.com/important-season-dates.html), [2026/2027 events](https://newjerseyftc.com/upcoming-events.html) |
| Michigan | USMI | League meets / qualifiers → qualifier or league tournament → Michigan Championship NW or SE → FIRST Championship / Premier | [2026–2027 FTC season events](https://firstinmichigan.us/FTC/events/); which championship each event feeds: FTC Events advancement configuration |
| Iowa | USIA | League meets (3–5 per team) → league tournament → Iowa Championship → FIRST Championship / Premier | [Season events and deadlines](https://engineering.uiowa.edu/first-tech-challenge-season-events-deadlines) |

Every region also uses FIRST's rules from the
[2026–27 Competition Manual](https://ftc-resources.firstinspires.org/ftc/game/manual)
(version TU07):

- **Section 4.1, Table 4-1**: qualification points 16 (top seed) down to 2;
  alliance selection 21 − the alliance number or draft pick number; playoffs
  40 / 20 / 10 / 5; Inspire 60 / 30 / 15; other judged awards 12 / 6 / 3.
  Table 4-3's 28-team sample is checked against the formula in
  `server/api/roadmap.test.ts`.
- **Section 4**: a team advances only from events in its home region, and only
  from its first three entry-level events (qualifiers and league tournaments).
- **Section 14**: a league tournament's ranking adds each team's best 10 league
  meet matches.
- **Table 13-2**: playoff alliances by event size (2 / 4 / 6 / 8).

**Not encoded** (neutral view): every other region. Texas's and Washington's
region sites refused automated reads on 2026-10-30, and no region page found
publishes 2026–27 slot counts yet; FIRST says regional allocations go up on
FTC Events in early December.

## The numbers

- **Points earned** are FIRST's own, from
  `GET /v2.0/{season}/advancement/{code}/points` (2025–26 on). The `points`
  tuple is in Table 4-2 order: total, judged award, playoff, alliance
  selection, qualification, then tiebreak averages. The sync stores the first
  five in `advancement_points` (migration 60) with each event's other data. A
  failed request keeps what's stored.
- **Last team in** at an event: the lowest official total among teams with
  `FIRST` status (not declined) on FIRST's advancement list.
- **Target** ("~54 points"): last season's median of that "last team in" figure
  across the region's advancing events at the same level. 2025–26 used the same
  points system. At a regional championship it's the median for the last team
  inside the FIRST Championship share (`fcmpReserved`); the any-slot figure
  (Premier events included) is shown next to it. Each ruleset stores these
  numbers in `lastSeason`, read from FTC Events on 2026-10-30.
- **Finishes that reach it**: the fewest points each finish guarantees on its
  own under Table 4-1, with the worst qualification rank, at an event the size
  of the next stop's roster (else last season's typical size). They're a guide,
  not a guarantee: points add up across categories.
- **Slots** for this season appear once FIRST publishes them (by alliance
  selection at the latest).

## Next stop

- Registered events come from FIRST's registrations (`event_registrations`).
- A league team with no registration yet gets its league's remaining
  tournaments from the calendar, since every league team plays one.
- A team that took a slot (or is on a championship roster) is aimed at its
  regional championship's FIRST Championship share. A team past that needs
  nothing more from the road map.

## Updating for a new season

1. Re-read the Competition Manual's Sections 4 and 14 and add a `POINTS_SYSTEMS`
   entry for the season. If the table changed, check `routes()` and the
   qualification formula (`qualPoints` in the engine) against it.
2. For each region, re-read its season page, copy the region's block with the
   new `season`, and update levels, championships, `feeds` and `sources`.
3. Refresh `lastSeason` from the finished season: for each advancing event, the
   slot count, FIRST's points list size, and the lowest total among `FIRST`
   rows. For championships, also `fcmpReserved` and the lowest total inside that
   share.
4. Set `checked`, update this page's table, and add a test in
   `server/api/roadmap.test.ts` for anything new.
