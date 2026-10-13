# Deploying Control Scout (Oracle VM, next to Control Point)

Nothing was deployed overnight. This is the 15-minute morning runbook.

Control Scout runs as its **own** service on the same VM as Control Point:
user `controlscout`, code in `/opt/control-scout`, port **3100**, systemd unit
`control-scout`, nginx site `control-scout`. It never reads or changes
anything under `/opt/control-point`, its service, `.env` or nginx site.

## 1. DNS (Porkbun) — 1 minute

Add an **A record**: host `scout`, value `132.145.202.89` (the VM). Wait until
`nslookup scout.tryctrlpoint.org` returns that IP.

## 2. Ship + install — from this repo on your machine

```bash
VM=ubuntu@132.145.202.89 KEY=~/.ssh/oracle-controlpoint DOMAIN=scout.tryctrlpoint.org bash deploy/deploy.sh
```

The first run stops after creating `/opt/control-scout/.env` with blanks.

## 3. Secrets — on the VM

```bash
sudo nano /opt/control-scout/.env
```

Fill `FTC_EVENTS_USERNAME`, `FTC_EVENTS_TOKEN`, `RESEND_API_KEY` (the same
values as your local `.env`).

## 4. Data — pick one

**Fast (recommended): copy tonight's synced database** (4 seasons, ~100k
matches, already computed):

```bash
scp -i ~/.ssh/oracle-controlpoint .data/scout.db ubuntu@132.145.202.89:/tmp/scout.db
ssh -i ~/.ssh/oracle-controlpoint ubuntu@132.145.202.89 'sudo install -o controlscout -g controlscout -m 600 /tmp/scout.db /opt/control-scout/.data/scout.db && rm /tmp/scout.db'
```

**From scratch:** `sudo -u controlscout bash -c 'cd /opt/control-scout && npm run sync && npm run stats && npm run packs'`
(~15 min of FIRST requests, then ~1 min of stats).

## 5. Finish + HTTPS

```bash
VM=ubuntu@132.145.202.89 KEY=~/.ssh/oracle-controlpoint DOMAIN=scout.tryctrlpoint.org CERTBOT_EMAIL=you@example.com bash deploy/deploy.sh
```

It ends by printing `/api/health`. Then open https://scout.tryctrlpoint.org.

## After that

- **Updates:** re-run step 2 (code is replaced; `.env` and `.data` are kept).
- **Schedule (built in):** current-season sync daily, hourly on event days;
  stats + prediction ledger after each sync; offline packs rebuilt daily.
- **Logs:** `journalctl -u control-scout -f`
- **Rollback:** `git checkout <previous>` locally and re-run step 2.
- **Docker** (for the Mac mini cluster later): `docker build -t control-scout .`
  then `docker run -p 3000:3000 -v scout-data:/app/.data --env-file .env control-scout`.
