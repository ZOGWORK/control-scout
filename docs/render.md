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
(no offline packs on a throwaway disk; /download says none are built), and
`NPM_CONFIG_INCLUDE=dev` (with `NODE_ENV=production` set, `npm ci` would
otherwise skip Vite and the other build tools).

**Secrets — paste these yourself** in Render → control-scout → Environment:
`DATABASE_URL` (`libsql://…turso.io`), `DATABASE_AUTH_TOKEN`,
`FTC_EVENTS_USERNAME`, `FTC_EVENTS_TOKEN`, `RESEND_API_KEY`.

## Database (Turso)

1. Turso dashboard → Create Database → name `control-scout`, group
   `ftc-control-point-iad` (US East, next to the Render service; separate from
   Control Point's databases). Copy its URL and create a token.
2. From this repo (one command, the token stays on your machine):

   ```bash
   npm run db:export
   PUSH_DATABASE_URL=libsql://control-scout-….turso.io PUSH_DATABASE_AUTH_TOKEN=… npm run db:push
   ```

   `db:push` creates the schema from our migrations, copies the public data
   (~1M rows: teams, events, matches, stats, the prediction ledger) and
   rebuilds search. Local accounts, sessions and scouting stay here. Re-runnable.
3. Put the same URL and token into the Render secrets above
   (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`). Saving redeploys the service.

Migrations run on start, so the schema stays current; the scheduler syncs the
current season and updates the ledger whenever the service is awake.

## Moving to the Oracle VM later

Bring Turso's current data back into a local file, then follow
[deploy.md](deploy.md) step 4 as written (it uploads `.data/scout-export.db`):

```bash
turso db shell control-scout .dump > scout.sql
rm -f .data/scout-export.db && sqlite3 .data/scout-export.db < scout.sql
```

On the VM the app reads the local file (`DATABASE_URL` in `shared/.env`), so
no Turso settings carry over.
