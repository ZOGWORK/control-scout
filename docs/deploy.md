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
