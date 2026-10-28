# Weekly email digest

One opt-in email on Monday mornings: your followed teams' results, the
prediction check-in, what's coming up and power rankings movement. It exists for
the weeks you don't open the app. Code: `server/digest/` (`build.ts` the data,
`template.ts` the email, `job.ts` the Monday run and send log, `prefs.ts` the
switch and unsubscribe links, `routes.ts` the API, `schedule.ts` the timing),
`src/components/settings/DigestSetting.tsx` (the switch),
`src/pages/DigestUnsubscribedPage.tsx` (where the unsubscribe link lands).

## Setup

Nothing beyond `RESEND_API_KEY`, which sign-in codes already use. Optional:

| Variable | What |
| --- | --- |
| `RESEND_WEBHOOK_SECRET` | The signing secret (`whsec_…`) of a Resend webhook pointed at `/api/digest/webhook`, sending `email.bounced` and `email.complained`. Unset: the endpoint answers 404 and bounces rest on Resend's own suppression list. |

The owner portal's **Weekly email digest** switch (`weeklyDigest` flag) stops
all sending at runtime, mid-batch too (it's checked before every account; switched back on,
the next tick finishes the week); everyone's choice is kept.

## Who gets it

Every account with a `digest_prefs` row is looked at each Monday. An email goes
out only when all three hold:

1. the switch in Settings › Notifications › Email is on (off by default),
2. the address hasn't hard-bounced,
3. the account follows at least one team: its team plus tracked teams, the same
   follows push and My team read (`user_state`), read at send time, so a team
   unfollowed during the week is gone from the next digest.

An account that follows nobody never enters the queue (no log row).

## When

Mondays at 08:00 America/New_York (`schedule.ts`), checked every five minutes by
the scheduler in `server/index.ts`. A server that was down at 08:00 catches up
later that Monday, never on Tuesday. Never on request, never on a page load.

## What it says

One week definition everywhere: Monday to Sunday before the send, by each
match's own (event-local) date. Every number comes from stored data; nothing
calls FIRST or any other service at send time.

1. **Your teams' week.** One row per team and event with a result that week:
   the event (linked), W–L–T and rank from `event_teams` (the team page's
   numbers), the playoff result (`awards` Winner/Finalist, else its alliance
   seat), and OPR at the event against the team's OPR at its previous event this
   season, with both numbers. Most recent first, then team number; at most 10
   rows, then a link to My team.
2. **Prediction check-in.** From the live ledger (`predictions`, kind `live`):
   calls on matches with a followed team that week, counted exactly as the
   track record counts them (`decidedCall` / `rightCall` in
   `server/api/accuracy.ts`: ties and 50/50 calls don't count), plus the
   season's running record for the same teams. A bad week says so. No calls:
   no section, never "0 of 0".
3. **Coming up.** Followed teams' events (roster or FIRST registration)
   starting in the next 14 days, soonest first, with dates, place and a
   countdown. Never a match time; an event without a schedule says so.
4. **Power rankings.** Only when a week was published during the reported week.
   Followed teams in it with rank and movement; when none is, the five biggest
   movers, labelled as such. That fallback never makes an email on its own.

All sections empty: no email, logged `skipped-empty`.

The subject is always `Your Control Scout week: <headline>`, the headline by
priority: a win, a final, a top-4 seed, the week's record, a perfect week of
calls, the next event, a ranking.

## The email

Table layout with inline styles, one column, a light design with a real dark
version (`prefers-color-scheme` for Apple Mail and iOS Mail, `[data-ogsc]` for
Outlook.com; Gmail's own inversion gets solid, high-contrast colours). The logo
is the only image and the name sits beside it as text, so the email reads the
same with images blocked. No tracking pixel, no UTM tags: every link is the
plain page it names. `List-Unsubscribe` and `List-Unsubscribe-Post` headers give
mail apps a one-click Unsubscribe button (RFC 8058).

## Unsubscribing

Each account has a random 256-bit token (`digest_prefs.token`). The link
`/api/digest/unsubscribe?t=…` needs no sign-in, works forwarded or on another
device, and doesn't expire: it switches the digest off in that same request and
redirects to `/digest/unsubscribed`. Turning the digest back on in Settings
issues a new token, so an older email's link can't switch it off again (it lands
on "This link isn't active" and changes nothing).

A hard bounce (`email.bounced` with bounce type `Permanent`) or a spam complaint
switches the digest off; a soft bounce changes nothing and next week tries
again. Turning the switch back on clears a recorded bounce.

## The send log

`digest_sends`: one row per account and week, written before sending, with the
status, template version, sections and subject. It is the idempotency key: a
re-run (crash, restart, second server) finds the row and sends nothing twice.
Statuses: `sending`, `sent`, `failed` (with the provider's reason, never the
address), `skipped-empty`, `skipped-toggle-off`, `skipped-bounce`, `bounced`.
Each account is read again when its turn comes, and the claim itself requires the
account to exist with the digest on, so an unsubscribe or deletion mid-batch stops
its email. One account's failure never stops the batch. Each run logs a summary line
(`digest 2026-11-02: 41 sent, 0 failed, skipped …`). Rows older than 400 days
are pruned. "Didn't get it" for one account:

```sql
SELECT week, status, sections, error FROM digest_sends
WHERE user_id = (SELECT id FROM users WHERE email = 'them@example.com') ORDER BY week DESC;
```

Both tables are private: never in the public snapshot, and deleted with the
account.
