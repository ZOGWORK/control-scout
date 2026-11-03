# Failed searches → GitHub issues

FTC One Search logs each search that found no answer as a GitHub issue on `ZOGWORK/control-scout`, labelled
`failed-search`. **The open issues with that label are the list of searches still to fix.** Visitors see nothing of
this.

**It only logs.** Nothing here fixes, assigns, closes, marks in progress, opens a pull request or merges. The owner
reads the list, directs the work, and closes an issue by hand after checking the query live.

Code: `server/searchFailures.ts`. It files through the in-app error reporter's GitHub client
(`server/errorReports.ts`: `gh`, `GITHUB_REPO`, `GITHUB_REPORT_TOKEN`), so there is one GitHub reporting path.

## Setup (Sushil)

1. **Token.** The variable is `GITHUB_REPORT_TOKEN`, the same one the error reporter uses
   ([error-reporting.md](error-reporting.md) has the steps). It needs a fine-grained token with **Issues: Read and
   write** on `ZOGWORK/control-scout` only (Metadata read-only is added by GitHub). A token made for
   `Control-Point-FTC` before the repository moved may no longer reach it: if issues don't appear, make a new one
   with resource owner `ZOGWORK`. Without a token, failures are only counted in the `search_failures` table.
2. **Labels.** Create these once under **Issues → Labels**. GitHub drops a label it won't create from a new issue.
   - `failed-search`
   - `result:no-match`, `result:team-fallback`, `result:weak`, `result:name-only`, `result:empty`, `result:ambiguous`
   - `intent:location`, `intent:opr`, `intent:rating`, `intent:record`, `intent:matches`, `intent:awards`,
     `intent:events`, `intent:next-last`, `intent:championships`, `intent:winners`, `intent:leaderboard`,
     `intent:phase`, `intent:count`, `intent:meaning`, `intent:versus`, `intent:school`
   - `dismissed` and `in-progress`. These two are for you to set by hand. Automation never sets them.
3. **Kill switch.** Turn off **Failed-search reports** in the owner console's Features tab (kill switches) to
   stop it all: no counting, no GitHub writes (a sync running stops before its next issue), no re-checks. Issues
   already filed stay as they are.

## What counts as failed

| Result type | When |
|---|---|
| `no-match` | Nothing matched (search's recovery, with no hits) |
| `empty` | A reading with no results (an events query with none, for example), with no answer card |
| `team-fallback` | The team page with "… isn't answered directly yet", for a query with a team and an intent word |
| `name-only` | Only names matched, for a query with a team number and an intent word |
| `weak` | Search flagged its result as a guess, for a query with a team and an intent word |
| `ambiguous` | Two intents matched equally (reported by the layered reader) |

Any answer counts as a success: a card, a stat answer, a leaderboard, a team page asked for by name, or a page named
outright ("privacy", "records"). Only the outcome counts, never the phrasing.

**Who decides.** The layered reader (`server/api/searchLayers.ts`) reports how it reached each answer
(`SearchOutcome`), and its `result` decides: `answered` is never filed, `name-search-only` is filed as `name-only`,
and a `weak` answer with no hits at all is a `no-match`. A `team-fallback` or `weak` result is filed only when the
query asked for a team and an intent (section 12.1); "4215 zzz" falling back to the team's page is an answer. The
intent is the reader's first intent, or both tied intents ("leaderboard / awards") when it was ambiguous. The route
and the owner's re-check both read the outcome this way (`outcomeTrace`).

When there is no outcome (a copy of the answer, or a caller outside `/api/search`), the reading is taken from the
answer itself (`readTrace`), with the intent words of the redundancy brief's section 6 (`INTENT_WORDS`).

## One issue per query

- **Key.** Search's own key (`searchKey`) of the redacted query (`keyFor`): personal data out first (so the key
  holds `[email]`, never the address), then lowercase, punctuation out, spaces collapsed, `#4215` → `4215`, then
  search's filler out (rn, right now, currently, please, and the rest of its `FILLER`), never inside a team's full
  name. "4215 opr rn" and "4215 opr right now" share one issue. Word order is kept: "4215 from where" and "4215 where
  from" are two issues. If search's key can't be worked out, the reporter's own (`reportKey`, the same steps with its
  own filler list) is used.
- **Title.** `Failed search: <key>`, the key cut at 80 characters with "…". The full query is in the body. `@` and
  `#<digit>` get a zero-width space so a title can't mention anyone or link an issue.
- **Body.** Result type, count, first seen, last seen, Reproduce link (`https://controlscout.org/search?q=<latest query as typed>`, never the key, which may answer once filler is dropped),
  owner Re-check link, key hash, then: the query as typed (the 5 latest distinct variants), the normalized query,
  the interpreted reading (team, intent words, intent, scope, filler dropped, layers attempted, layer that won, what
  search said) and the status footer. Query text sits in code fences, so no markdown, link or mention in it runs.
- **Labels at creation.** `failed-search`, `result:<type>`, and `intent:<intent>` where the intent is known.
- **Mapping.** `search_failures` (migration 71) maps key → issue number. If it's lost, the next sync searches GitHub
  for the key hash (`label:failed-search in:body`) and adopts that issue. It never opens a second issue blindly.

## Timing and limits

- **Off the search path.** `/api/search` answers first. `noteSearch()` then does in-memory work only.
- **Settle (8 s).** A query waits 8 s for the same visitor's next one. A query that the next one extends or trims is
  dropped, so the dropdown's half-typed queries ("4215 o") and a retry of the same query count once.
- **Buffer.** At most 500 distinct queries between flushes. More are dropped and counted (`counters.dropped`).
- **Flush, every minute.** The buffer is written to `search_failures` in one batch. A batch that can't be written
  goes back in the buffer for the next flush. On shutdown (a deploy), everything still in memory, settling
  or buffered, is written before the server exits.
- **Sync, every 10 minutes.** At most 20 GitHub writes per sync (create plus number, body update, reopen plus
  comment). The worst case is 120 writes an hour. Write volume grows with distinct failing queries, never with
  searches.
- **New issues.** At most 40 a day (per server). Bodies of filed issues are updated first, then new ones, the
  most-repeated failure first. The rest wait in the table, counted.
- **Rate limits.** A 403 or 429 with `Retry-After` (or no requests left) pauses all writes until then.
- **GitHub down.** Counts stay in the table and the next sync catches up. Nothing waits on GitHub, and nothing
  queues in memory past the buffer cap.
- **Per visitor.** At most 30 logged failures an hour. The IP is used in memory only and never stored.
- **Counts are searches that reached the server.** A visitor repeating a search within a few minutes may get it from
  their own browser's cache (`/api/search` is cacheable for 60 s, 300 s stale). That repeat isn't counted again, just
  as a retry within the settle window isn't: the count is roughly distinct searches, not page views.

## Privacy (the repository is public)

An issue holds query text and the outcome only: no IP address, account, device or anything else that links it to a
person. Before anything is stored, on the query as typed (before it's lowercased) and on every part of the reading:

- Tokens become `[token]`: GitHub, `sk-`, Slack, AWS, JWT, or any run of 24+ letters and digits.
- Emails become `[email]`.
- Phone numbers become `[phone]`: "+" and 8+ digits in groups (`+44 20 7946 0958`), 3-3-4 digits with
  separators, a trunk 0 and groups (`020 7946 0958`), or 10+ digits in a row. Team numbers (5 digits at most,
  never a leading 0 or "+") are kept.
- A query left with nothing but placeholders is skipped and counted (`counters.skipped`).

## Owner workflow

1. **Review.** Open [the list](https://github.com/ZOGWORK/control-scout/issues?q=is%3Aissue+is%3Aopen+label%3Afailed-search).
   Each issue shows the query, the reading, the result type, the count and the Reproduce link.
2. **Fix.** Direct the work (or point Claude at one issue). Nothing here starts it.
3. **Verify.** Open the issue's **Re-check (owner)** link while signed in to Control Scout as an owner
   (`OWNER_EMAILS`), and press **Re-check now**. It searches the query again and posts a comment: "now returns a
   direct answer" or "still fails". It **never closes** the issue. A failed re-check also adds one to the count.
4. **Close by hand** after checking live: as completed when fixed, as not planned (or label `dismissed`) when it's
   gibberish or not worth fixing.
5. **Regression.** A query closed as completed that fails again **after it was closed** reopens the same issue, with
   a comment (a comment GitHub refuses is posted on the next sync). Failures from before the close, still waiting to
   be sent, don't reopen it. One closed as not planned, or labelled `dismissed`, stays closed (its count still goes
   up in the table).

## Every automated GitHub action

1. Create an issue, with its labels.
2. Update an issue's body (count, last seen, examples).
3. Reopen an issue closed as completed whose query failed again, with a comment saying so.
4. Post a re-check comment when the owner presses Re-check.

Nothing else: no assigning, no closing, no in-progress label, no pull requests, no merges. History before the
deploy is not backfilled.
