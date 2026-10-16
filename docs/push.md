# Web push

Match reminders, upsets and event starts arrive on a phone or computer even when
Control Scout is closed. Code: `server/push/` (planning, sending, the API),
`src/shared/push.ts` (shared rules), `src/lib/push.ts` (the device side),
`src/sw.template.js` (showing a push and opening it), Settings › Notifications
(the UI).

## Setup

Three environment variables, read only in `server/env.ts`:

| Variable | What |
| --- | --- |
| `VAPID_PUBLIC_KEY` | From `npx web-push generate-vapid-keys`. Sent to browsers (it's public). |
| `VAPID_PRIVATE_KEY` | From the same command. Never sent to the browser or logged. |
| `VAPID_SUBJECT` | A contact for push services: `mailto:you@example.com` or an `https:` URL. |

Generate the pair once and keep it. Every server (the VM and any backup host)
uses the same pair, because a subscription is tied to the public key: a new pair
ends every existing subscription. If any of the three is unset (or invalid),
push is **dormant**: nothing is planned or sent, `GET /api/push/config` answers
`available: false`, and Settings says notifications aren't available. The owner
portal's **Push notifications** switch (`push` flag) does the same at runtime.

## Who can turn it on

Push needs a signed-in account.

A subscription's endpoint must be on a browser push service (FCM, Mozilla,
Apple, Windows: `PUSH_HOSTS` in `src/shared/push.ts`), since the server sends
requests to it. A device's subscription belongs to the account
signed in on it, and what it follows is read from that account's synced data
(`user_state`: `myTeam`, `tracked`, `settings.notify`) each time the job runs,
so changing a tracked team or a switch on any device applies at once.

Signed-out devices can't subscribe. The alternative, storing the device's
tracked list next to its subscription, would keep a second copy of personal
data on the server with no account to see or delete it. Signed out, the in-tab
alerts (`src/lib/alerts.tsx`) still work while the app is open. Signing out
removes this device's subscription; deleting the account removes all of them.

Permission is asked only when someone taps **Turn on notifications**, never on
load. Each device is turned on separately. The settings stay dormant, with one
line saying why, when:

- the browser has no Push API;
- it's iPhone or iPad Safari outside an installed web app (push needs Control
  Scout on the Home Screen: Share, then Add to Home Screen);
- the site's notification permission is Blocked (the line says how to allow it
  in the site settings);
- the server has no VAPID keys or the owner switched push off.

**Turn off** stays available whenever the browser holds a subscription, even
with the server unreachable or push switched off: the browser unsubscribes
first, then the server is asked to forget it (if it can't be reached, the next
push to that endpoint comes back "gone" and the server deletes it then).

On a device with push on, the in-tab alerts step aside so nothing arrives twice,
but only after checking (every 5 minutes) that push can still deliver there:
switched off by the owner, the server's keys gone, permission revoked or the
subscription dropped, and the in-tab alerts take over again.

## What is sent

Each kind has its switch in `settings.notify`; a switch that's off sends nothing
of that kind.

| Kind | Switch | When |
| --- | --- | --- |
| Match reminder | `myTeamMatches` (my team), `trackedTeams` (tracked teams) | The match's scheduled start is 15 minutes away or less (and at least 1 minute). The scheduled time is FIRST's event-local time read in the event's time zone (`localToUtcMs`). No time or no zone: skipped. One push per device per match, even if the schedule moves afterwards. Several of your teams in one match: one push. |
| Upset | `upsets` | A match at a **followed event** whose pre-match call in the live ledger (`predictions`, `kind = 'live'`) gave the side that lost **65% or more**. Ties are never upsets. Only upsets scored in the last 30 minutes, and after the device subscribed. |
| Event start | `eventStart` | A **followed event** has started: its first match result is in, or its first scheduled match time has passed, whichever comes first, on the event's first day in its own time zone (an event with no time zone gets none). Once per event. |

A **followed event** is one in the account's tracked events, or one whose
roster (`event_teams`, plus anyone in its match lineups) includes the account's
team or one of its tracked teams.

A tap opens the event page on the match (`?tab=matches&match=…`), or the event
page for an event start. The service worker only ever opens paths on this site.

## How

`pushTick` runs every minute in the server process (off with
`CS_NO_SCHEDULER`). It plans every push, then for each one claims a row in
`push_sent` keyed by (subscription, kind, subject) *before* sending, so a push
goes out once however many ticks or servers see it. Then:

- **Accepted**: logged `sent`; `last_success_at` moves on.
- **404 or 410** from the push service: the device unsubscribed; its
  subscription is deleted.
- **429, 5xx or no answer**: the claim is released and the next tick tries
  again while the push is still timely.

Each planned push carries an expiry, checked against the clock at the moment
it's sent (a slow push service can take seconds per send): a match reminder
expires 1 minute before the match, so it never arrives after the start, and its
"in N min" is written when it's sent. A "gone" answer deletes only the row that
still has that endpoint, and subscription ids are never reused, so a late answer
can't remove a device that turned notifications off and on again.
- **Any other refusal**: logged `failed`, never retried.

At most 20 pushes per device in any 24 hours, counting pushes in flight on any
server (the slot is taken in the same statement as the claim); beyond that
they're logged `limited` and never sent later. The sent log keeps 7 days.

Sending uses the [`web-push`](https://www.npmjs.com/package/web-push) package
(RFC 8291 aes128gcm payload encryption and RFC 8292 VAPID), not our own
implementation: payload encryption is easy to get subtly wrong, and this package
is the standard, widely used one.

## Data

`push_subscriptions` (endpoint, the two keys, the account, the browser family
only such as "Chrome on Android", created and last-success times) and
`push_sent`. Both are private tables, never in the public snapshot. An account
keeps at most 10 devices; a new one beyond that replaces the least recently
used.

## API

| Route | Who | What |
| --- | --- | --- |
| `GET /api/push/config` | anyone | `{ available, publicKey }` |
| `POST /api/push/subscriptions` | signed in | `PushSubscription.toJSON()`; 400 if unusable, 503 while push is unavailable |
| `POST /api/push/subscriptions/check` | signed in | `{ endpoint }` → `{ subscribed }` |
| `DELETE /api/push/subscriptions` | signed in | `{ endpoint }` → `{ ok, removed }`; only your own |

Writes are JSON only. Every answer is `no-store`.
