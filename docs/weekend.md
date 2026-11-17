# This weekend

The weekend's FTC events in one place, and a team's next match. One reading of each
(`server/api/weekend.ts`), so the "This weekend" page, the team page and search never
list different events, a different match, a different time or a different call.

## Where it shows

| Surface | Reads |
|-|-|
| `/weekend` (`src/pages/WeekendPage.tsx`), linked from Home's "On the calendar" | `GET /api/weekend?which=&region=&today=` and `GET /api/teams/:number/next` |
| Team page, Upcoming (`src/pages/TeamPage.tsx`) | its match list through `src/shared/nextMatch.ts`, the function `teamNextMatch` uses |
| Search: "what FTC events are happening this weekend", "meets this weekend in New Jersey", "what's on this weekend", "next weekend", "events today", "tomorrow" | `server/api/searchEvents.ts` (the windowed answer) → `weekendEvents` / `eventCards`, shown by `server/api/answers/weekend.ts` `eventsStat` |
| Search: "4215 next match", "what's 4215's next match this weekend" | `server/api/searchQuestions.ts` → `teamNextMatch`, shown by `nextMatchCard` |

## Rules

- **The weekend is search's own.** `weekendWindow(which, today)` in `src/shared/query/time.ts`
  is `windowOf("this-weekend" | "next-weekend" | "last-weekend")`, the windows search
  reads those words as. No second definition.
- **Each event on its own calendar.** An event is in a window when any of its days is, read
  on the event's time zone (`inWeekend`, `dayAt`): a meet under way in Los Angeles at 21:00
  on Sunday is still this weekend's there, when UTC's Monday has begun. Events with no time
  zone use UTC. Search's bounded windows ("this weekend", "today", "this week") read each
  event the same way: the dates are read a week wide in SQL, then each row is checked on its
  own calendar. This is the one window rule changed; the time parser is unchanged.
- **The current season only**, said on the page. Volunteer sign-ups are not events.
- **A place as Rankings takes it**: a state (`USA:NJ`) or a whole country (`Romania`), with
  "My region" when My team is set.
- **Times are the event's**, with the zone's short name ("Sat, 3:30 PM EST"); the viewer's own
  clock is added where it differs. Never UTC.
- **A team's next match** is its next unplayed match on a posted schedule at an event that
  hasn't ended (a match over half an hour late is not next), with its alliance, partners,
  opponents and the match list's call (the logged live call, else one worked out by the same
  engine). A played match shows its score and clip, never a time.

## When there's nothing

| Case | Line |
|-|-|
| No events | "No FTC events this weekend." / "… next weekend in Romania." |
| An event this weekend, no match list yet | "{event} is this weekend: its match list isn't posted yet." |
| Its matches there all played, or the next one over half an hour late | "No more matches listed for {team} at {event} yet." |
| No match this weekend | "No matches this weekend — next event is {event} on {dates}." with the event linked |
| No upcoming event | "No matches this weekend — {team} has no upcoming event in {season}." |

Asked plainly ("when is 4215's next match"), search still answers a match scheduled after
this weekend, or "No upcoming match is scheduled …", as before; asked of this weekend, it
says the lines above.

Tests: `server/api/weekend.test.ts`.
