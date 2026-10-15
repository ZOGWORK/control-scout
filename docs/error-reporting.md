# In-app error reporting → GitHub issues

When the app hits an error it shows a small prompt, "Something broke — report it?",
under the top bar. **Report** sends one sanitized report; **Dismiss** sends nothing.
Visitors can also write a report in **Settings → About → Report a bug**. The server
groups reports by fingerprint and, when a token is set, files them as GitHub issues on
`Control-Point-FTC/control-scout`.

## Setup (Sushil)

### 1. Create the token

1. Sign in to GitHub as an account with write access to `Control-Point-FTC/control-scout`.
2. Open **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token** (https://github.com/settings/personal-access-tokens/new).
3. **Token name:** `control-scout error reports`. **Expiration:** your choice (a year is fine; put a
   reminder in the calendar to rotate it).
4. **Resource owner:** `Control-Point-FTC`. If the organization requires approval for fine-grained
   tokens, an org owner approves it under **Organization settings → Personal access tokens → Pending
   requests**.
5. **Repository access:** **Only select repositories** → `Control-Point-FTC/control-scout`. Nothing else.
6. **Permissions → Repository permissions:**
   - **Issues: Read and write**. This is the only one to set.
   - **Metadata: Read-only** is added automatically and is required. Leave every other permission at
     **No access** (no Contents, no Pull requests, no Actions, no Administration, no account permissions).
7. **Generate token** and copy it (it starts with `github_pat_`). GitHub shows it once.

### 2. Create the labels (once)

Issues are filed with the labels `bug` and `auto-reported`. `bug` already exists. Create
`auto-reported` under **Issues → Labels → New label** (any colour; e.g. `#6e7781`, description
"Filed by the in-app error reporter"). Create it by hand rather than relying on the token: GitHub
silently drops a label it won't create from a new issue, so the issue would arrive without it.

### 3. Set the environment

On the VM, in `/opt/control-scout/shared/.env` (and on Render's environment, if it should file too):

```bash
GITHUB_REPORT_TOKEN="github_pat_..."   # the token from step 1
OWNER_EMAILS="you@example.com"         # who may read the stored reports (comma-separated)
```

Restart the service. The token is read only in `server/env.ts`, never sent to the browser and never
logged. Never commit it, and never paste it into an issue or PR.

**Without a token** everything still works: reports are stored in the `error_reports` table and listed
for owners at `GET /api/reports/errors`; nothing is filed. Adding the token later files new reports from
then on (a stored fingerprint gets its issue on its next report).

## What a report contains

Exactly `{ message, stack, route, appVersion, timestamp, userAgent }`, nothing else:

| Field | What it is |
| --- | --- |
| `message` | The error's name and message, e.g. `TypeError: x is undefined` (from Settings: `Bug report: <their words>`) |
| `stack` | The error's stack trace (from Settings: the last error this visit hit, if any) |
| `route` | The page's path, without query string or fragment |
| `appVersion` | The web app's package version + commit, e.g. `0.1.0+4498100` |
| `timestamp` | When it happened (device clock) |
| `userAgent` | The browser's user-agent string |

**Never included:** scout entries, notes, the shortlist, settings, storage, cookies, account or session
details. The report is built from the error object and the page address alone.

**Sanitized twice**, in the browser and again on the server (`src/shared/errorReport.ts`, tested in
`errorReport.test.ts`): email addresses, bearer tokens, JWTs, `github_pat_`/`ghp_`/`re_`/`sk_` keys,
`token=`/`session=`/`password=`/`code=`-style values, URL query strings and fragments, UUIDs (scout entry
ids), long opaque ids, phone-number-like digit runs, JSON bodies echoed in a message and long quoted
strings (likely user text) are replaced with `[redacted]`. Lengths are capped. No IP address or account
id is stored with a report.

## Fingerprints and dedupe

Fingerprint = SHA-256 of the **normalized message** plus the **first 3 stack frames**:

- message: origins dropped, numbers → `N`, quoted values → `'?'`, hashed asset names
  (`TeamPage-B3xk9_Qa.js` → `TeamPage.js`), lowercased;
- frames: `function@file` with the origin, query, line and column dropped and the build hash removed.

So the same bug in the next build, on the backup host, or for a different team, keeps one fingerprint.

## How issues are filed

Filing happens in the background after the report request has been answered (`202`), so a slow or
failing GitHub never slows the app.

- **New fingerprint** → a new issue titled `[auto] <message>` with labels `bug` and `auto-reported`; the
  body has the occurrence count, the fingerprint, the message, the stack and an environment block (route,
  app version, server release, browser, time). Everything from the report sits inside code fences, so it
  can't render links or @mention anyone.
- **Same fingerprint, issue open** → the count goes up in the database, and at most **once a day** a
  comment says "Seen N more times since <date> (T in total)" with the latest occurrence's environment.
  The comment goes out with the first report after the 24 hours are up.
- **Never duplicates**: before opening an issue the server claims the row with a conditional `UPDATE`
  (`filing_at`); only the server that wins the claim files. A claim older than 10 minutes (a filer that
  died) can be taken over. The daily comment is claimed the same way (`last_comment_at`).
- **Issue closed as completed** (or deleted) and the error comes back → when the next comment is due, a
  **new** issue is opened that links the old one ("#N was closed as completed; this is the same error
  again"). A fix that didn't hold is a regression worth its own issue.
- **Issue closed as not planned** → it stays closed and nothing more is posted for that fingerprint. Reports
  are still counted in the database.
- **GitHub down or the token wrong** → the report stays stored; the reason (status code only) is logged as
  `[reports] stored, not filed on GitHub: …`, and the next report of that fingerprint tries again.

## Limits and safety

- `POST /api/reports/error`: JSON only; **5 reports an hour per signed-in account, 20 an hour per IP when
  signed out** (`429` with `Retry-After` beyond that). The limiter is in memory and bounded like the
  contact form's: expired keys are swept once it tracks 10,000 keys.
- The browser prompts at most 3 times per page load, one prompt at a time, and each distinct error once.
  Browser-extension errors, `ResizeObserver` loop warnings, cross-origin "Script error." and aborted
  requests are ignored.
- **Recursion guard:** the whole browser pipeline runs inside try/catch, and while it is building,
  prompting or sending, new errors are ignored; sending can't throw or reject; if the prompt itself fails to
  render, reporting switches off for that page load. On the server the route and the background filing
  each catch everything: a broken report path answers `503` and logs a line, never another report.

## Trying it locally

In development (`npm run dev`), add `?debug-error` to any page's address: it throws a test error half a
second after loading, so the prompt appears. Production builds don't contain this. Without
`GITHUB_REPORT_TOKEN` in your local `.env`, a report is only stored in your local database.

## For the owner portal

`GET /api/reports/errors?limit=50` (max 200), for signed-in accounts whose email is in `OWNER_EMAILS`
(everyone else, and everyone when it's unset, gets `404`). Most recently seen first:

```json
{ "reports": [{
  "fingerprint": "…", "message": "TypeError: …", "count": 12,
  "firstSeen": "2026-10-15T10:00:00.000Z", "lastSeen": "2026-10-16T08:12:00.000Z",
  "issueNumber": 101, "issueUrl": "https://github.com/Control-Point-FTC/control-scout/issues/101",
  "issueState": "open", "lastCommentAt": "2026-10-16T08:12:00.000Z",
  "sample": { "message": "…", "stack": "…", "route": "/teams/18360", "appVersion": "0.1.0+4498100", "timestamp": "…", "userAgent": "…" }
}] }
```

Server code can call `listErrorReports(limit)` from `server/errorReports.ts` directly, and `ownerOf(req)` /
`isOwnerEmail(email)` from `server/owner.ts` gate any other owner-only route the same way.
