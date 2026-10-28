# Deploying Control Scout (Oracle VM, next to Control Point)

Production is **https://controlscout.org** (also `www.controlscout.org`, and
`scout.tryctrlpoint.org` as a backup alias), all on one certificate.

Control Scout runs as its **own** service on the same VM as Control Point:
user `controlscout`, port **3100**, systemd unit `control-scout`, nginx site
`control-scout`. It never reads or changes anything under
`/opt/control-point`, its service, `.env` or nginx site.

```
/opt/control-scout/              root-owned
  releases/<time>-<sha>/         one build per deploy; the 3 newest are kept
  current -> releases/…          switched only after a build succeeds
  shared/.env                    secrets (root:controlscout, 640)
  shared/data/                   SQLite + packs: the only path the app can write
```

## 1. DNS

A records → `132.145.202.89` (the VM) for `controlscout.org`,
`www.controlscout.org` and `scout.tryctrlpoint.org`. Check each with
`nslookup <name>` before requesting the certificate.

## 2. First run — creates the secrets file, starts nothing

```bash
VM=ubuntu@132.145.202.89 KEY=~/.ssh/oracle-controlpoint DOMAIN=controlscout.org bash deploy/deploy.sh
```

## 3. Secrets — on the VM

```bash
sudo nano /opt/control-scout/shared/.env
```

Fill `FTC_EVENTS_USERNAME`, `FTC_EVENTS_TOKEN`, `RESEND_API_KEY` (the same
values as your local `.env`).

Set `CONTACT_TO` to the inbox that should receive messages from the `/contact`
form (sent through Resend, with Reply-To set to the sender). Without it,
messages are only stored in the `contact_messages` table:
`SELECT * FROM contact_messages ORDER BY id DESC`. The address stays on the
server and is never sent to the browser.

Set `GITHUB_REPORT_TOKEN` to file in-app error reports as GitHub issues on
`Control-Point-FTC/control-scout` (a fine-grained token with Issues read/write on
that repository only; the exact steps are in
[error-reporting.md](error-reporting.md)). Without it, reports are only stored in
the `error_reports` table. Set `OWNER_EMAILS` (comma-separated) to the accounts
allowed to read them at `GET /api/reports/errors`; everyone else gets a 404. Set
both on Render's environment too if it should file reports while it serves.

`OWNER_EMAILS` also opens the **owner portal** at `/owner` (signed in with one of
those emails): overview, usage (API requests per day, sync volume, slowest
routes, live connections), prediction health (calibration and drift), runtime
switches, the feedback inbox (contact messages, resolve or archive), error
reports, data jobs (re-sync, rebuild packs, clear caches, each confirmed and
never alongside the scheduled sync) and an audit log of everything done there.
For anyone else `/owner` is the ordinary not-found page and every
`/api/owner/*` call is a 404. The switches (`feature_flags`) take effect within
about 10 seconds on every server, with no deploy; all are on until turned off.
Request metrics are kept per route pattern and UTC day in
`request_metrics_daily` (written once a minute; a restart loses at most that
minute).

**Entry photos (Cloudflare R2).** Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (`control-scout-photos`) and `R2_ENDPOINT`
(the bucket's S3 API endpoint) to let workspace members attach photos to scout
entries. Optional: `R2_SOFT_CAP_GB` (default 9.5; new uploads stop there, under
the 10 GB free tier). Without the four required values photos are off and their
UI is hidden everywhere; nothing else changes. Bucket, CORS and token setup, the
nightly expiry and the storage guardrails: [r2-photos.md](r2-photos.md). The
owner portal's **Storage** panel shows usage against 10 GB per event, with a
confirmed, audited purge. Never set `R2_FAKE` on a server (it's ignored in
production anyway).

**Web push.** Generate a VAPID key pair once, on the VM (it prints both keys;
don't paste them anywhere but the env file):

```bash
npx web-push generate-vapid-keys
```

Put them in `/opt/control-scout/shared/.env` as `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY`, with `VAPID_SUBJECT=mailto:<a contact address>` (or an
https: URL), and restart. Any backup host (Render) gets the same three values:
subscriptions are tied to the public key, so a different or changed pair ends
them. Without all three, push stays dormant and Settings › Notifications says
it's unavailable. The owner portal's **Push notifications** switch stops all
sending without a deploy. What is sent and when: [push.md](push.md).

**Weekly email digest.** Works with the `RESEND_API_KEY` already set: Mondays at
08:00 New York time it emails everyone who turned it on in Settings. For bounce
handling, add a webhook in Resend (Webhooks → Add endpoint →
`https://controlscout.org/api/digest/webhook`, events `email.bounced` and
`email.complained`) and put its signing secret in the env file as
`RESEND_WEBHOOK_SECRET`. Without it, Resend's own suppression list still stops
sends to dead addresses. The owner portal's **Weekly email digest** switch stops
all sending without a deploy. Details: [digest.md](digest.md).

**Discord bot.** Put the bot's token in the same file as `DISCORD_BOT_TOKEN`
(optionally `DISCORD_DEV_GUILD_ID` for a test server) and redeploy: the
installer then enables and restarts its own unit, `control-scout-bot`, next to
the site. Without a token the unit stays off and the site is unaffected either
way. Setup steps and the invite link: [bot/README.md](../bot/README.md).

## 4. Data — pick one (before the service first starts)

**Fast (recommended): copy tonight's synced database** (4 seasons, ~120k
matches, already computed). `db:export` makes a consistent single-file copy
(it includes anything still in SQLite's WAL, which copying `scout.db` would miss):

```bash
npm run db:export
scp -i ~/.ssh/oracle-controlpoint .data/scout-export.db ubuntu@132.145.202.89:/tmp/scout.db
ssh -i ~/.ssh/oracle-controlpoint ubuntu@132.145.202.89 'D=/opt/control-scout/shared/data; sudo systemctl stop control-scout 2>/dev/null; sudo rm -f $D/scout.db-wal $D/scout.db-shm && sudo install -o controlscout -g controlscout -m 600 /tmp/scout.db $D/scout.db && rm /tmp/scout.db'
```

(The service is stopped first and the old WAL files removed, so the new
database is never paired with a running server's journal.)

**From scratch:** after step 5,
`sudo -u controlscout bash -c 'cd /opt/control-scout/current && npm run sync && npm run stats && npm run packs'`
(~15 min of FIRST requests, then ~1 min of stats).

## 5. Build, start, HTTPS

```bash
VM=ubuntu@132.145.202.89 KEY=~/.ssh/oracle-controlpoint DOMAIN=controlscout.org   EXTRA_DOMAINS="www.controlscout.org scout.tryctrlpoint.org" bash deploy/deploy.sh
```

It builds the release, switches `current` to it, starts the service, gets
(or keeps, or expands) the certificate for every domain using the VM's
existing Let's Encrypt account, and ends by printing `/api/health`. Then open
https://controlscout.org.

## After that

- **Updates:** re-run step 5. The new release builds
  beside the live one (the site keeps serving), `current` switches only if
  the build succeeds, and the existing certificate is re-applied.
- **Custom port:** set `PORT` in `shared/.env`; every deploy reads it from there.
- **Schedule (built in):** current-season sync daily, and on event days every 15 min on the VM (`DATA_CYCLE=child`; hourly on Render; `EVENT_DAY_SYNC_MINUTES` overrides);
  stats + prediction ledger after each sync; offline packs rebuilt daily.
- **Usage statistics** (anonymous page views from visitors who chose "Allow"; daily
  aggregates in `analytics_daily`, no IPs, user agents, cookies or IDs): on the VM,
  `cd /opt/control-scout/current && sudo -u controlscout bash -c 'set -a; . /opt/control-scout/shared/.env; set +a; npm run stats:report'`
  (`-- 7` for 7 days, `-- --json` for JSON). Remotely: set `STATS_TOKEN` (a long random string, e.g.
  `openssl rand -hex 32`) in `shared/.env`, restart, then
  `curl -H "Authorization: Bearer $STATS_TOKEN" https://controlscout.org/api/stats/summary?days=30`.
  Without `STATS_TOKEN` that endpoint answers 404.
- **IndexNow** (server/indexNow.ts): tells Bing and the other [IndexNow](https://www.indexnow.org)
  engines which pages changed, so they recrawl them within hours. Off by default. Turn it on with
  `INDEXNOW=1` in `shared/.env` and restart. It then pings `https://api.indexnow.org/indexnow`
  3 minutes after each start (a deploy), after each sync, and hourly, but **at most once an hour**:
  the main pages (`/`, `/faq`, `/power-rankings`, `/rankings`, `/teams`, `/events`, `/methodology`)
  after each new release, plus the event pages re-fetched since the last accepted ping, the teams at
  those events, and newly published power rankings weeks (never more than 10,000 URLs). A failure is
  one `indexnow:` line in the log and the same changes go out on the next try; nothing is ever thrown or
  retried in a loop. Its state is the `indexnow` row in `kv`.
  The key is public by design: engines fetch `https://controlscout.org/<key>.txt` to check it, and it's
  served whether or not pings are on. The built-in key is `DEFAULT_KEY` in server/indexNow.ts; to use
  your own, set `INDEXNOW_KEY` (8–128 of `a-z A-Z 0-9 -`, e.g. `openssl rand -hex 16`) and restart.
  Don't set `INDEXNOW` on a backup host (Render): one server pinging is enough.
  Check it: `journalctl -u control-scout | grep indexnow` (e.g. `indexnow: sent 7 URLs (HTTP 200)`).
- **Public usage on the home page** ([public-usage.md](public-usage.md)): off by default. To publish
  the opt-in page views and sessions started for the last 30 days, add `PUBLIC_USAGE_ENABLED=1` to
  `shared/.env` and restart (`sudo systemctl restart control-scout`). Remove it (or set `0`) and
  restart to stop publishing; the home page then says the figures aren't published.
- **Logs:** `journalctl -u control-scout -f`
- **Restarts without errors:** the port belongs to the `control-scout.socket` unit, not to
  the server. systemd keeps it open through every restart and hands it to each new server,
  which takes it once its data is ready. Requests during a deploy wait a few seconds instead
  of getting nginx's 502, and a stopping server finishes the requests it's serving first (up to 10 s).
  "A few seconds" holds because the server starts from its prebuilt bundle (`build/server/index.mjs`,
  made by `npm run build` through `scripts/build-server.mjs`): about 2–3 s to ready. Started through tsx
  instead, it compiled the whole server first on every start (~35 s; no compile cache survives the
  service's private /tmp or a new release folder), and every deploy's visitors waited that long.
  The build itself runs niced (CPU and disk) so it doesn't slow the live site while it runs.
  Because a request to the open socket starts the server, **stopping the site needs both units**:
  `sudo systemctl stop control-scout.socket control-scout`, then `start` both again.
- **Live scout stream:** `GET /api/scout/stream` is server-sent events (server/scout/stream.ts). The nginx
  site gives it its own `location` with `proxy_buffering off` and a 1 h `proxy_read_timeout` (the server
  sends a heartbeat every 25 s), written by `deploy/oracle-vm-setup.sh` on every update. A stopping server
  ends its streams first, and clients reconnect to the next one from where they were. The live updates
  are in-process: this works because the VM runs **one** server process. A deploy with several server
  instances would need a shared bus behind `server/scout/bus.ts` (Redis pub/sub, Postgres LISTEN/NOTIFY).
- **Rollback:** on the VM, `sudo /opt/control-scout/bin/rollback` lists the installed releases, and
  `sudo /opt/control-scout/bin/rollback <release>` switches to one and waits until it's up. For a release
  from before socket activation, it also puts back the service that release expects (the server opening
  the port itself) and stops the socket; the next deploy switches back. Don't switch `current` by hand:
  an older release can't start while the socket holds the port.
- **Docker** (for the Mac mini cluster later): `docker build -t control-scout .`
  then `docker run -p 3000:3000 -v scout-data:/app/.data --env-file .env control-scout`.

### Live predictions

The live ledger (`predictions` rows with `kind = 'live'`) is the honest track
record: after every sync, the stats job logs a call for each current-season
match that is unplayed, has a full 2v2 lineup, and starts more than a minute
from now (event-local time read in the event's time zone). A logged call is
never revised. Once the match is played, the next cycle attaches the score and
outcome. A call that turns out to be logged at or after the match's actual
start is moved to `kind = 'late'` and left out of the record. Nothing is logged
until FIRST publishes a schedule, so the ledger stays empty between event
weekends. `server/stats/live-ledger.test.ts` covers the whole path.

To check it on the VM (read-only):

```bash
cd /opt/control-scout/current && sudo -u controlscout bash -c 'set -a; . /opt/control-scout/shared/.env; set +a; npm run live:check'
```

It prints the ledger (rows, scored, unscored, rows whose `predicted_at` is at or
after the match start, which must be 0, and when a call was last logged and
last scored), the upcoming matches the next cycle would log, and stale matches
whose start has passed but which are still unplayed. During an event weekend,
"would be logged" should empty out into "rows" within an hour (event days sync
hourly), and "scored" should catch up after the matches are played.

## Auto-deploy (every push to main)

`.github/workflows/deploy.yml` deploys each push to main. It uses the same
command queue as Control Point's VM jobs.

1. The workflow appends `sudo /opt/control-scout/bin/update <sha>` to
   `commands/pending.json` in the private `sushilm20/control-point-commands`.
2. The VM's poller (`/opt/bruno-commands`, every 30 s) runs it.
3. `bin/update` (`deploy/vm-update.sh`, installed by every deploy) fetches main,
   refuses any commit that isn't on it, and installs the commit like step 5 above.
   The new release builds beside the live one and switches only if the build
   succeeds. The log is `/var/log/control-scout-deploy.log`.
4. The workflow waits until `https://controlscout.org/api/health` reports
   `"release": "<sha>"` and fails after 20 minutes if it doesn't.

One-time setup (needs Sushil, since both steps are credentials):

- **Queue token (GitHub Actions secret):** create a fine-grained token with
  repository access **only** `sushilm20/control-point-commands` and permission
  **Contents: read and write**. Save it as the `COMMANDS_REPO_TOKEN` Actions
  secret on `Control-Point-FTC/control-scout`. Until it exists, the workflow
  skips with a warning.
- **VM read access to this private repo:** pick one.
  - (a) Allow deploy keys for the Control-Point-FTC org (org settings →
    Member privileges → Deploy keys), then
    `gh repo deploy-key add <(ssh -i ~/.ssh/oracle-controlpoint ubuntu@132.145.202.89 sudo cat /opt/control-scout/deploy_key.pub) -R Control-Point-FTC/control-scout -t "Oracle VM auto-deploy (read-only)"`.
    The key pair is already on the VM, and the private half never leaves it.
  - (b) Create a fine-grained token with repository access **only**
    `Control-Point-FTC/control-scout` and **Contents: read-only**, and store it on
    the VM:
    `ssh -t -i ~/.ssh/oracle-controlpoint ubuntu@132.145.202.89 'sudo install -m 600 /dev/null /opt/control-scout/github_token && sudo nano /opt/control-scout/github_token'`.
    It's used through `GIT_ASKPASS` and never written into a URL or git config.

Manual deploys with `deploy/deploy.sh` keep working the same way.

## Rollback

The Oracle VM is the production host. Render (https://control-scout.onrender.com)
was kept to the side as a backup (Sushil, 2026-10-14). It is suspended, so the deploy
workflow no longer waits for it (2026-10-17). If it's resumed, it still serves its
pages with `X-Robots-Tag: noindex` and canonical links to controlscout.org, so
search engines never index it as a second copy. To roll back
production, switch `current` to one of the three releases the VM keeps, then
restart:

```bash
ssh -i ~/.ssh/oracle-controlpoint ubuntu@132.145.202.89 'ls -1t /opt/control-scout/releases'
ssh -i ~/.ssh/oracle-controlpoint ubuntu@132.145.202.89 'sudo ln -sfn releases/<older> /opt/control-scout/current && sudo systemctl restart control-scout'
```

The data directory is shared by every release, so a rollback keeps all data.

## Uptime alerts

Two independent checks watch production:

1. **Discord, every minute (primary).** A Cloudflare Worker,
   [deploy/uptime-worker](../deploy/uptime-worker/README.md), checks
   `/api/health` (200, `"ready": true`) and `/` (200, HTML with the app shell)
   every minute from Cloudflare, outside the VM. After 2 failed checks in a row
   (1–2 minutes) it posts to the Control Point Discord `#announcements` with
   the failing check, status and latency; a reminder at most every 30 minutes
   while it stays down; and "back up" when it recovers. The webhook URL is the
   Worker secret `UPTIME_DISCORD_WEBHOOK` (set with `wrangler secret put`,
   never committed); without it the Worker only logs. Setup steps are in that
   folder's README.
2. **GitHub issue, every ~5 minutes (backup).** Described below. It keeps
   working if Cloudflare or the Worker stops.

Neither runs on the VM, so both still alert when the whole VM is down.

`.github/workflows/uptime.yml` (logic in `.github/scripts/uptime.sh`) checks
production every 5 minutes. GitHub runs scheduled workflows best-effort, so
runs can start several minutes late.

- **What counts as up:** `https://controlscout.org/api/health` answers 200
  with `"ready": true`, and `https://controlscout.org/` answers 200 with HTML.
- **No false alarms on deploys:** each run tries 3 times, 20 s apart (30 s
  timeout each). A deploy restart (~10 s of 503 / `ready: false`) or a single
  blip passes; only a failure on every attempt counts as down.
- **Down:** the run opens an issue labelled `uptime` ("controlscout.org is
  down") with the time, each failed attempt (status, timing, body snippet) and
  where to look. While it stays down, the issue gets at most one "Still down"
  comment an hour. The run also fails.
- **Back up:** the next good run comments "Back up at … (down ~N min)" and
  closes the issue.
- **Where alerts go:** GitHub's own notification emails. Everyone watching
  the repo gets the issue and its comments, and the workflow's owner gets the
  failed-run email. There are no extra secrets or services; it uses the
  built-in `GITHUB_TOKEN`.
- **Scope:** controlscout.org (the Oracle VM, the only host). Bruno may run
  his own watcher for the VM; this one covers only controlscout.org, so the two
  don't duplicate.
- **Testing:** `CHECK_ONLY=1 bash .github/scripts/uptime.sh` runs just the
  check (exit 0 up, 1 down). `DRY_RUN=1` prints the issue calls instead of
  making them. Point either at another host with `SITE=…`.
  `bash .github/scripts/uptime.test.sh` runs the script against fake `curl`
  and `gh` (no network); CI runs it on every pull request.
