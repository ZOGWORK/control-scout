# Hosting on Render (free) + Turso — the interim host

Until the custom domain is ready for the Oracle VM ([deploy.md](deploy.md)),
Control Scout runs on Render's free plan with its database on Turso (free).
Render's free disk is wiped on every restart and the service sleeps after
15 idle minutes, so nothing durable lives on Render: the data lives in Turso.

## Service

| Setting | Value |
|---|---|
| Name / URL | `control-scout` (`srv-db6r3c0u01pc73b8ptgg`) → https://control-scout.onrender.com |
| Runtime / plan / region | Node · free · Virginia (next to the Turso US group `ftc-control-point-iad`) |
| Build | `npm ci && npm run build` |
| Start | `npx tsx server/index.ts` |
| Branch | `main` (auto-deploys on merge) |

Plain settings (set when the service was created): `NODE_ENV=production`,
`APP_URL=https://control-scout.onrender.com`,
`EMAIL_FROM=Control Scout <verify@tryctrlpoint.org>`, `CS_PACKS=off`
(no offline packs on a throwaway disk; /download says none are built).

**Secrets — paste these yourself** in Render → control-scout → Environment:
`DATABASE_URL` (`libsql://…turso.io`), `DATABASE_AUTH_TOKEN`,
`FTC_EVENTS_USERNAME`, `FTC_EVENTS_TOKEN`, `RESEND_API_KEY`.

## Database (Turso)

1. Locally: `npm run db:export` → `.data/scout-export.db` (a consistent copy in
   WAL mode, ~165 MB, all synced seasons and the prediction ledger).
2. Turso dashboard → Create database → name `control-scout`, group
   `ftc-control-point-iad` (US East, next to the Render service; a separate
   database from Control Point's) → **Upload** `.data/scout-export.db`
   (or with the CLI in WSL/macOS: `turso db import .data/scout-export.db`).
3. Copy its URL and create a token (Turso → database → Create token) into the
   Render secrets above. Saving them redeploys the service.

Migrations run on start, so the schema stays current; the scheduler syncs the
current season and updates the ledger whenever the service is awake.

## Moving to the Oracle VM later

`turso db shell control-scout .dump > scout.sql` (or keep using the local
export) and follow [deploy.md](deploy.md); the app only needs `DATABASE_URL`
pointing back at a local file.
