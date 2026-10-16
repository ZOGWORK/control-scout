# Uptime alerts (Cloudflare Worker)

Checks https://controlscout.org **every minute** and posts to the Control Point
Discord `#announcements` channel when it goes down, every 30 min while it stays
down, and once when it is back.

- **What is checked:** `GET /api/health` answers 200 with JSON `"ready": true`,
  and `GET /` answers 200 with HTML containing the app shell
  (`<div id="root">`). Both in parallel, 10 s timeout each.
- **When it alerts:** after **2 failed checks in a row** (so 1–2 minutes after
  the site goes down). A single failed check, such as a deploy restart (about
  10 s of 503), never alerts.
- **The message:** which check failed, its HTTP status (or "no response" /
  "timed out"), latency, when it started failing, and a link to the site.
  No `@` mentions are ever sent.
- **Why a Worker:** it runs on Cloudflare, not on the Oracle VM, so it still
  alerts when the whole VM (or its network) is down, which a check on the VM
  can't. Cron Triggers run every minute and are free. The state lives in one
  Durable Object (free on the Workers Free plan), so consecutive failures are
  counted reliably from one minute to the next.

The logic is in `src/uptime.ts` (tested by `src/uptime.test.ts` in the repo's
`npm test`); `src/worker.ts` is the Cloudflare wrapper.

## One-time setup (Sushil)

You need: the Cloudflare account that already holds controlscout.org, and
Manage Webhooks permission in the Control Point Discord.

1. **Create the Discord webhook.** In Discord: `#announcements` › Edit
   Channel › Integrations › Webhooks › New Webhook. Name it
   "Control Scout uptime", then **Copy Webhook URL**. Treat the URL as a
   password: anyone with it can post to the channel.
2. **Log in to Cloudflare from this folder** (opens a browser):
   ```bash
   cd deploy/uptime-worker
   npx wrangler@4 login
   ```
3. **Store the webhook URL as a secret** (paste it at the prompt; it is never
   written to a file or shown again):
   ```bash
   npx wrangler@4 secret put UPTIME_DISCORD_WEBHOOK
   ```
   On a brand new Worker, wrangler offers to create it first: answer yes.
4. **Deploy:**
   ```bash
   npx wrangler@4 deploy
   ```
   It prints the Worker's URL (`https://control-scout-uptime.<you>.workers.dev`)
   and the schedule `* * * * *`.
5. **Check it runs.** Cloudflare dashboard › Workers & Pages ›
   control-scout-uptime › Logs (or `npx wrangler@4 tail`) shows one
   `UP (0 in a row): …` line a minute. Opening the Worker's URL shows the saved
   state (`null` until the first failure; it holds no secrets).
6. **Send a test alert (optional, posts to the channel).** Temporarily point
   it at a host that doesn't answer, wait about 2 minutes for "is down",
   then put it back and wait for "is back up":
   ```bash
   npx wrangler@4 deploy --var SITE:https://controlscout.org/does-not-exist
   # … wait ~2 min, see the alert in #announcements …
   npx wrangler@4 deploy
   ```
   (Under `/does-not-exist` there is no `/api/health`, so the API check fails
   every minute.)

### Settings

| Name | Where | Default | Meaning |
| --- | --- | --- | --- |
| `UPTIME_DISCORD_WEBHOOK` | **secret** (`wrangler secret put`) | unset | Discord webhook URL. Unset: alerts are only logged, nothing is posted. |
| `SITE` | `[vars]` in `wrangler.toml` | `https://controlscout.org` | Site to check (no trailing slash). |
| `FAIL_THRESHOLD` | `[vars]` | `2` | Failed checks in a row (one a minute) before "down". |
| `REMIND_MINUTES` | `[vars]` | `30` | Minimum gap between "still down" reminders. |
| `TIMEOUT_MS` | `[vars]` | `10000` | Timeout per request. |

To rotate the webhook, delete it in Discord, make a new one and run step 3
again. To pause alerts, `npx wrangler@4 secret delete UPTIME_DISCORD_WEBHOOK`
(checks keep running and only log).

Cost: 1,440 cron runs and 1,440 Durable Object requests a day, well inside
the Workers Free plan (100,000 requests a day). Storage is written only when
the state changes, so a healthy site writes nothing.

## Trying it locally (no Cloudflare, no Discord)

`local.ts` runs the same logic from Node with the state in memory. Point it at
a local server and a local webhook receiver; nothing reaches Discord unless
you set `UPTIME_DISCORD_WEBHOOK` to a real URL yourself.

```bash
# a local app on :4061, and any HTTP server on :6061 that logs POSTs
SITE=http://localhost:4061 UPTIME_DISCORD_WEBHOOK=http://127.0.0.1:6061/hook \
  INTERVAL_SECONDS=60 npx tsx deploy/uptime-worker/local.ts
```

Stop the app: about 1–2 minutes later the receiver gets "is down". Start it
again: the next check sends "is back up". `ONCE=1` runs a single check and
exits 0 (up) or 1 (failing).

With wrangler you can also run the real Worker locally:
`npx wrangler@4 dev --test-scheduled --var SITE:http://localhost:4061`, then
`curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` once per check.

## Backup: the GitHub Actions check

`.github/workflows/uptime.yml` still runs every ~5 minutes (GitHub delays
scheduled runs, so it can be 5–15 minutes) and opens a GitHub issue labelled
`uptime` when the site is down. It keeps working if Cloudflare or this Worker
ever stops, so the two don't share a single point of failure. See
[docs/deploy.md](../../docs/deploy.md#uptime-alerts).
