# Entry photos (Cloudflare R2)

Workspace members attach photos (robot photos at pit scouting, match photos
too) to shared scout entries: up to 6 per entry. The images live in a private
Cloudflare R2 bucket; their records live in the app database (`entry_photos`).
Entry text is never stored in R2 and is never deleted by anything below.

Code: `server/scout/photos.ts` (routes, cap, expiry, meter), `server/scout/r2.ts`
(config and S3 calls), `server/scout/sigv4.ts` (request signing),
`server/scout/fakeR2.ts` (local stand-in), `src/lib/photos.ts` (compression and
upload), `src/components/scout/EntryPhotos.tsx` (strip and fullscreen viewer),
`src/components/owner/StoragePanel.tsx` (owner portal).

## Environment

Set on the server only (`/opt/control-scout/shared/.env` on the VM, Render's
environment if it should serve photos too). Read in `server/env.ts` and nowhere
else; never logged, never sent to the browser.

| Variable | Required | Value |
| --- | --- | --- |
| `R2_ACCESS_KEY_ID` | yes | the API token's Access Key ID |
| `R2_SECRET_ACCESS_KEY` | yes | the API token's Secret Access Key |
| `R2_BUCKET` | yes | `control-scout-photos` |
| `R2_ENDPOINT` | yes, or `R2_ACCOUNT_ID` | the S3 API endpoint, `https://<account id>.r2.cloudflarestorage.com` |
| `R2_ACCOUNT_ID` | when `R2_ENDPOINT` is unset | the Cloudflare account id (the endpoint is derived from it) |
| `R2_PUBLIC_URL` | no | not used: the bucket stays private, so photos are always shown through short-lived signed URLs. A public URL would make every photo world-readable. |
| `R2_SOFT_CAP_GB` | no | new uploads stop at this many GB stored (default `9.5`, at most 10) |

Missing any required value: photos are off. Every `/api/scout/photos/*` route
answers 404, `GET /api/flags` reports `photos: false`, and the app shows no photo
UI anywhere (buttons, thumbnails, viewer). Nothing else changes and nothing
errors. The owner portal's **Switches** panel has an **Entry photos** switch
(`photos` flag) that does the same without touching the env.

## Bucket setup (done 2026-10-15; the steps, to reproduce it)

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**. Name
   `control-scout-photos`, location Automatic, storage class **Standard**. Leave
   public access **off** (no r2.dev subdomain, no custom domain).
2. The bucket → **Settings** → **CORS policy** → **Add CORS policy**, and paste:

   ```json
   [
     {
       "AllowedOrigins": ["https://controlscout.org"],
       "AllowedMethods": ["GET", "PUT", "DELETE"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   The browser PUTs each photo straight to R2, so the app's origin must be
   listed. Another origin that serves the app with photos on (a backup host)
   needs adding here too; `www.` redirects to the apex, so it doesn't.
3. **R2 Object Storage** → **Manage R2 API Tokens** (Account details → API
   tokens) → **Create Account API token** (or a user token). Name
   `control-scout-photos`; permissions **Object Read & Write**; **Apply to
   specific buckets only** → `control-scout-photos`; no expiry (or rotate it
   on a schedule). Create, then copy the **Access Key ID** and **Secret Access
   Key** (shown once) into the server env above. The page also shows the S3
   endpoint, `https://<account id>.r2.cloudflarestorage.com`: that's
   `R2_ENDPOINT`.
4. Restart the service. `GET /api/flags` now says `"photos": true`.

## How it works

**Adding a photo** (any member, on any workspace entry that has synced):

1. The device compresses the photo: decoded upright, drawn on a canvas at most
   1600 px on the long edge, encoded as JPEG at 0.8 (lower if still over 4 MB).
   Re-encoding keeps only pixels, so EXIF (GPS, camera serial, time) never
   leaves the device.
2. `POST /api/scout/photos/presign {workspaceId, entryUuid, bytes}`: the server
   checks the session and workspace membership, that the entry is on the
   server, then in **one SQL statement** reserves the photo: a `pending` row is
   inserted only if the entry has fewer than 6 photos, the member has fewer
   than 12 uploads in flight, and stored + reserved bytes stay under the soft
   cap. Racing uploads therefore can't overshoot the cap. It answers a 10-minute
   presigned PUT URL for `photos/<season>/<eventCode>/<entryUuid>/<photoUuid>.jpg`
   (Content-Type `image/jpeg` is part of the signature).
3. The browser PUTs the JPEG to R2.
4. `POST /api/scout/photos/<id>/complete`: the server HEADs the object. Missing:
   the reservation is released (409). Larger than declared: the object is
   deleted (413). Otherwise the row becomes `ready` with the stored byte size
   (the meter), and the entry is republished.

**Viewing**: thumbnails and the fullscreen viewer load
`GET /api/scout/photos/<id>?workspaceId=…`, which checks membership and
redirects to a 15-minute presigned GET (cached privately for 13 minutes).
Thumbnails are lazy-loaded; tap one for fullscreen (swipe or arrow keys to move).

**Removing**: whoever added the photo, the entry's author, or a workspace admin
(the same shape as the entry delete rule, docs/shared-accounts.md; the server
enforces it, and the button only shows for them, from `/api/auth/me`'s
`controlPoint.accountId` and role). The R2 object is
deleted first; if R2 can't be reached the photo stays and the member is told.

**Live**: every photo change gives the entry a new `seq` and bumps its
`photosRev` (the entry's text and `updatedAt` are untouched), so it streams to
the other members (`/api/scout/stream`) and reaches pulls like any edit. Each
entry carries `photos`, `photoExpired` and `photosRev`; devices take the
server's photo list whenever its `photosRev` is newer, even while their own text
edit waits to sync.

**Personal entries have no photos** (a decision): photos are for shared pit
scouting, where the team sees them; it keeps R2 to workspaces, whose
membership Control Point vouches for. The photo UI never shows on Personal.

## Storage guardrails (R2 free tier: 10 GB)

GB here means 10^9 bytes, the cautious reading of the free tier.

- **Expiry, nightly**: once a day after 08:00 UTC (one server only; the
  `photos:nightly-day` row in `kv` is the claim), photos whose event ended
  **more than 2 days ago** are deleted from R2: the event's end date comes from
  the synced `events` table and is refreshed every night; when it's unknown, a
  photo goes **14 days after upload**. The row stays as `expired`, the entry is
  republished with `photoExpired: true`, and the app shows "Photo expired"
  instead of a broken image. The same job deletes photos of deleted entries,
  releases uploads never finished (also every 15 minutes), deletes bucket
  objects with no record (after 6 hours), and lists the bucket to total it.
  Respects `CS_NO_SCHEDULER`.
- **Meter**: each photo's stored byte size is recorded at upload; stored plus
  reserved bytes are the usage the cap and the warnings read. The nightly job
  also records the bucket's own total (`kv` `photos:maintenance`).
- **7 GB**: an info notice in the owner portal's **Storage** panel.
- **9 GB**: a prominent warning on every owner portal panel, plus an owner alert
  (below).
- **Soft cap, 9.5 GB** (`R2_SOFT_CAP_GB`): new uploads are refused with "Photo
  storage is full — ask your admin to free space". Never silently grows into
  paid usage.
- **Owner portal → Storage**: used GB of 10 GB, per-event breakdown (photos,
  size, end date, when they go), a **Purge** per event (confirmation dialog;
  deletes that event's images in every workspace, entries show "photo
  expired"), and **Run cleanup now** (the nightly job on demand). Both are
  written to the audit log (`storage.purge`, `storage.maintenance`).

### Owner alert hand-off (for the owner inbox, Task 14)

Until the owner inbox exists, the 9 GB notification is a row in
`owner_alerts` plus the portal's warning banner:

- `kind = 'photo-storage'`, `level = 'warning'`, `title` "Photo storage
  approaching the 10 GB free tier limit", `body` "… — purge an event or uploads
  will pause. X GB of 10 GB used; new uploads stop at Y GB.", `details` JSON
  `{usedBytes, softCapBytes}`.
- At most one open alert per kind (`resolved_at IS NULL`, a partial unique
  index). Raising it again refreshes its text and `updated_at`; when usage drops
  back under 9 GB it's resolved (`resolved_at` set). Raised and resolved by
  `checkStorageAlerts()` in `server/scout/photos.ts` (after each upload, purge,
  nightly run and portal visit). Helpers: `server/portal/alerts.ts`.
- **Task 14**: read `SELECT * FROM owner_alerts WHERE resolved_at IS NULL AND
  inbox_item_id IS NULL`, create an inbox item (and its notification) for each,
  and set `inbox_item_id` to the item's id, so each alert notifies exactly once.
  When an alert's `resolved_at` is set, the inbox can close its item.

## Local development and tests

The real bucket only allows `https://controlscout.org`, and tests must never
touch it. Locally, set `R2_FAKE=1` (ignored in production): the API server then
mounts an in-process stand-in for R2 at `/__fake-r2` that implements presigned
PUT, GET, HEAD, DELETE and ListObjectsV2, checks every signature and expiry like
R2, and answers CORS for the app's origin. Objects stay in memory, or on disk
with `R2_FAKE_DIR=.data/fake-r2`. The endpoint defaults to
`http://localhost:<PORT>/__fake-r2`.

The tests (`server/scout/photos.test.ts`) run against it. Under vitest, `r2()`
refuses any endpoint that isn't localhost, so even a `.env` with the real
secrets can't reach the bucket from a test.

## Why no AWS SDK

Every call photos make is a presigned URL (the browser's PUT, viewing, and the
server's HEAD, DELETE and bucket listing), so the whole S3 client is one SigV4
query-signing function (`server/scout/sigv4.ts`, ~60 lines on `node:crypto`),
checked against AWS's published example in `sigv4.test.ts`.
`@aws-sdk/client-s3` plus the presigner would add several MB of dependencies
and cold-start time for the same few requests.
