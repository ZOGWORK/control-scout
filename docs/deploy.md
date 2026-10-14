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
- **Schedule (built in):** current-season sync daily, hourly on event days;
  stats + prediction ledger after each sync; offline packs rebuilt daily.
- **Logs:** `journalctl -u control-scout -f`
- **Rollback:** on the VM,
  `sudo ln -sfn releases/<older> /opt/control-scout/current && sudo systemctl restart control-scout`.
- **Docker** (for the Mac mini cluster later): `docker build -t control-scout .`
  then `docker run -p 3000:3000 -v scout-data:/app/.data --env-file .env control-scout`.

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

## Render: the rollback host

https://control-scout.onrender.com stays up as the rollback target (Sushil,
2026-10-13), and every update applies to it too. Render rebuilds from main on
its own, and the `render` job in `deploy.yml` waits until its `/api/health`
reports the same commit (from `RENDER_GIT_COMMIT`). If that job fails, check
the service's deploys in the Render dashboard; auto-deploy must stay on for
main.

To fail over, point DNS for `controlscout.org` and `www` at Render (add them
as custom domains there first), or send people to the onrender.com URL. Render
free sleeps after 15 minutes idle and takes ~25 s or more to wake (see
`docs/perf-report.md`), so it's a fallback, not a twin.

## Uptime alerts

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
- **Scope:** only controlscout.org (the Oracle VM). Render, the rollback host,
  is not checked because the free plan sleeps when idle. Bruno may run his own
  watcher for the VM; this one covers only controlscout.org, so the two don't
  duplicate.
- **Testing:** `CHECK_ONLY=1 bash .github/scripts/uptime.sh` runs just the
  check (exit 0 up, 1 down). `DRY_RUN=1` prints the issue calls instead of
  making them. Point either at another host with `SITE=…`.
  `bash .github/scripts/uptime.test.sh` runs the script against fake `curl`
  and `gh` (no network); CI runs it on every pull request.
