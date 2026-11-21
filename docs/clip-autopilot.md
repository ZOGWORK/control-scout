# Clip autopilot

Every event with an official recording gets frame-checked per-match clips without anyone running the frame reader
(docs/frame-timings.md) by hand. A recording the official-videos watcher links (every 6 h) is in the queue within one
coverage check (5 minutes), and the next autopilot run reads it and hands what it read to the live server, which puts
it on the site at once or, when it breaks a rule, holds it for the owner's approval. No PR, no review, no deploy.

## The queue (`server/videos/frameQueue.ts`)

Read off the coverage check's own rows (`clip_coverage`, server/videos/coverageCheck.ts) and the frame rows themselves:

- **queued**: the event is over (its venue's last day has ended, counted in UTC days, so an American evening is never
  called over early) and a missing match sits in a video not read for this event yet, or read on or before that day
  (matches may have come after the read: read once more). The current season's events first, then events with an
  official video added in the last 7 days, then the backlog of past seasons; most due matches first within each. A new
  video is read within a run or two, never behind hundreds of older events.
- **waiting**: the event is still on, or a video's YouTube facts aren't in yet (the reader needs them).
- **read**: every readable video was read after the event; each missing match keeps its own why (what the video showed).
- **unreadable**: nothing a frame read can place: no video that day, a private video, no real start from FIRST.

Owner › Clip coverage shows each event's place (`frames`) and the queue's numbers (`frameQueue`).

## The runner (`scripts/clip-autopilot.ts`)

YouTube shows data-centre addresses a "Sign in to confirm you're not a bot" page instead of the video: measured on a
GitHub-hosted runner (the embed never loads) and already seen on the VM (#1445). So the runner is a scheduled job on a
computer at home, in a clone kept for it alone. Each run:

1. brings the clone to main (its start, below);
2. takes a read-only snapshot of the live database (`VACUUM INTO` over ssh, copied down, removed from the VM);
3. lays the rows the live server serves from its database (`auto_reads`, below) over main's season files and clip
   checks, in memory and on disk for the reader (put back when the run ends), so an event whose rows live only in the
   database counts as read; takes the queue from that; skips events another session's open PR adds rows for to a
   season's frame-read file (`heldElsewhere`, read again just before a read is handed over, where such an event's rows
   wait), events listed in `.data/autopilot/skip.txt` (one `season/code` a line, `#` comments: left by hand to a session
   reading them with no PR open yet), events read lately with nothing new
   (tried again after 3 days, left after 3 such reads until their recording or matches change), and events whose good
   rows waited last time (read again after 6 h, doubling each wait in a row up to 3 days; waits never count toward
   the 3);
4. reads up to `--max` events (12) with `scripts/video-frames.ts --season N --codes … --live <the season file as live>`
   (`--all` for an event with rows already), then `--verify`, then `--bounds`. The reader's output goes into the run's
   log as it comes (lines starting `  | `, one when each video starts and when it's done), so a long read shows it's
   working. One event may take at most as long as its videos' summed length, and never less than 3 hours (`--event-limit`,
   minutes, is that floor; `eventLimitMs` in scripts/lib/videoFrames.ts): a read slower than watching is broken. Real
   reads take 3–24% of the length (2022 ROBUQ1's 22.9 hours of video in 40 and 68 minutes; ROBUQ2's 20.5 hours in 203
   minutes, its 9.8-hour video at 24%), more than twice that on a computer running 8 readers at once, so only a stuck
   read gets there. Past it the event stops, the videos it finished
   keep their rows, the unfinished one gets none, and the next run reads the rest (not counted as a try). A stop with
   no new row at all is read again after 6 hours; the second such stop in a row counts as a try (then the usual 3 days,
   left after 3 tries), so a video that never gets past the limit isn't read every run. The run's log ends with every
   event stopped that way and the video it was on, to look at by hand. A whole
   reader call past its own limit (a backstop over the events' own: a day a read, or the sum of its events' limits and an hour when that's more; 3 for `--verify` and `--bounds`) is stopped with its whole process
   tree (`scripts/lib/streamRun.ts`);
5. checks every row it changed against what's live (`rowProblems`, server/data/frameRowRules.ts, the one definition
   the server checks with too; scripts/lib/autopilotRows.ts re-exports it) and logs any rule a row breaks:
   - every start plausible (in order, a match apart: the server's own `plausibleStarts`);
   - every start placed or moved opens 20, 12, 5, 2 or 0 s before it (or, where nothing before it names the match, 2 or 4 s after it) on a paused frame naming the match (`opens`);
   - no new placement `unconfirmed` (only a live clip whose opening frame named nothing stays so);
   - a live clip leaves only when a frame at its opening names another match;
   - a re-read is dated after the live row.

   A row whose video showed the reader nothing (`nothingRead`: no start, and every match missing because no frame
   could be read or the video couldn't be played) is a failed read: never handed over, its event read again later;
6. hands the rest to the live server, one delivery per season (below). An event whose rows went live is done; one
   whose rows wait for the owner counts a try (read again after 3 days, left after 3), so it isn't read every run while
   it waits;
7. sweeps up to `--sweep` events' clock-placed clips by their first frame (`video-frames.ts --clips`, shard 0 only)
   and hands the changed `server/data/clipChecks.ts` rows over the same way, checked by `clipCheckProblems`.

## On the live server (`server/videos/autoReads.ts`)

A delivery is one JSON file, `{ kind: "frames" | "clips", season, rows, source }`, written over ssh as the app's own
user (`sudo -u controlscout`) to a dot-file in `<DATA_DIR>/auto-reads-inbox/` on the VM
(`/opt/control-scout/shared/data/auto-reads-inbox/`), then renamed to `*.json`, so the server never reads half a file.
The VM key the snapshot already uses is the only credential. The server makes the inbox at boot and looks at it once a
minute (`startAutoReadsInbox`; off with the rest of the schedule under `CS_NO_SCHEDULER`):

- each file is claimed by renaming it into `claimed/`: during a zero-gap deploy two server processes run at once, and
  only one rename of a file succeeds, so a delivery is applied once. A claim left over 30 minutes (its server stopped
  mid-file) is put back for the next poll;
- the claimed files are applied under the data lock (`withDataLock`, one writer at a time, across processes and the
  sync cycle), each row against the row the site serves now (the database's, else the code's), with the event's played
  matches in played order for the order check:
  - **no problem**: live at once (`auto_reads.live_json`), no PR, no deploy. Every reader of the frame rows and clip
    checks (frameStart, frameRow, coverage, the queue) sees it: the database's rows are laid over the code's
    (`setAutoFrameRows`, `setAutoClipChecks`; a database row replaces the code's row of the same video and event unless
    the code's was read later, `dbRowWins`), and every cache is cleared;
  - **any problem**: waits for the owner (`pending_json`, with its problems in plain words). A later read of the same
    video and event replaces it (a clean one clears it);
  - **nothing read** (`nothingRead`): dropped, logged, never shown to the owner;
- each delivery is audited (`autoReads.delivery`: what went live, what waits, what was dropped), and its file
  removed. A file that isn't a delivery goes to `rejected/`, with why beside it; one whose rows couldn't be written
  goes back into the inbox for the next poll.

**Owner › Clip coverage › Waiting for approval** lists what waits, newest first: the event, its video (opening just
before the first change), what the read changes against what's live (matches added, moved and pulled, as chips that
play that second, and the clip counts), and the rules it broke. **Approve** puts it live as read; **Reject** drops it
(what's live stays, and the event can be read again). Both name the read the owner saw, so one replaced meanwhile is
refused ("look again"), and both are audited (`autoReads.approve`, `autoReads.reject`). Every owner decision is written under the same data lock as the inbox (busy over 15 s: "try again"). The menu's Clip coverage badge
counts what waits. Rows live in the database are never in the shipped snapshot (`auto_reads` is private).

Below them, **Seen in the video, kept off the site** lists every frame row's `review` entry: a match the frames saw at
second `t` that a rule kept from being a clip (its opening frame shows another match, one frame read only, out of order
or overlapping, played twice). They're listed from the frame rows themselves, code and database alike (not through
Clip coverage, which checks videos only for some matches, so none is hidden), less those already served and those
rejected at that second. Each shows the event, the match, a button that plays the video at `t` in the app's player,
and the reason. **Approve** (`approveReview`) writes `t` into the event's live row in the database as the match's start
(the code's row copied there first), with an opening `CLIP_LEAD_S` before it where the row checks openings, out of
`review` and `missing`, and marks it `approved` (with the reason approved over, `approvedWhy`). An approved start is
served whatever the plausibility check says and never makes a neighbour implausible (`playableStarts`). A later re-read
keeps it (`carryApproved`, server/data/frameRowRules.ts, which the autopilot runs too): a re-read that drops it or
leaves it for review again gets it back, unless a frame at its opening names another match, other than the one the
owner approved it over. A read can't mark a start approved itself. **Reject** records the decision
(`review_decisions`), and the entry isn't listed again at that second. Both are audited (`autoReads.reviewApprove`,
`autoReads.reviewReject`).

Logs: `.data/autopilot/runs/<time>.log` in the clone (every command and its output), `.data/autopilot/task.log` (the
schedule's). What it remembers between runs: `.data/autopilot/memory.json`.

## Setting it up (Windows)

Once, on a computer at home that can play YouTube, with `git`, `gh` (signed in: it reads other sessions' open PRs),
`node` 24 and the VM's ssh key
(`~/.ssh/oracle-controlpoint`, or `AUTOPILOT_SSH_KEY`):

```bash
powershell -ExecutionPolicy Bypass -File scripts/clip-autopilot-task.ps1
```

It clones the repository to `~/control-scout-autopilot`, installs what the reader needs (tesseract.js beside it,
Playwright's Chromium), and registers the task "Control Scout clip autopilot", every 3 hours while you're signed in.
`-RunNow` starts a run at once; `-Remove` takes the task away. Any other always-on computer at home works the same way
(`node scripts/clip-autopilot-start.mjs` from cron).

Several computers can share the queue. An event (`season/code`) belongs to shard FNV-1a(key) mod N (`shardOf`,
scripts/lib/autopilotRun.ts), the same on every computer and every run. Only one computer needs credentials (gh signed
in, the VM's key): it runs with `--shard 0/N --lanes 1=user@host,2=user@host…` and reads shard 0 itself. The others
are **lanes**, with no credentials at all. A lane runs `--lane` (from launchd, `org.controlscout.clip-lane`, started by
its coordinator) and only reads. Each coordinator run, for every lane, over ssh:

- **collects** a finished (or failed) job: the rows each season's read changed, whether a read failed, and the events
  stopped at their limit (`.data/lane/results/<job>` there, copied to `.data/autopilot/lanes/<K>/` here). They're checked
  and handed over as the coordinator's own reads (`settle`: `rowProblems`, its memory), so every delivery is sent from
  one place;
- **sends** an idle lane its next job: up to `--max` events of its shard (`pickEvents`, with the coordinator's memory),
  a copy of this run's snapshot (gzipped), and `job.json`, then starts it. The lane lays the snapshot's live rows over
  main's files as the coordinator does. Events in a job not yet collected are held;
- **waits** on one still reading, and starts again a job not started within an hour (`laneStep`).

The coordinator alone hands reads to the server and runs the clip sweep. A lane needs its own clone, node, Playwright's Chromium
and tesseract.js, and the coordinator's ssh key; nothing else. With no flags, a computer reads the whole queue alone.

A real run always goes through `scripts/clip-autopilot-start.mjs` (plain Node). It first waits, up to 30 minutes, for 3 GB
of memory free (`AUTOPILOT_MIN_FREE_MB`; with less, processes failed to start and scheduled runs died with nothing
logged), and skips the run if it never comes. On macOS memory it can take back at once counts too (`vm_stat`: free,
inactive, speculative, purgeable). With more than 6 GB it reads in 3 lanes, else 2 (`AUTOPILOT_LANES`). It holds the run's lock, puts the clone
back to main (a killed run can leave files changed), and runs `npm ci` when main's `package-lock.json` changed, before
anything runs from `node_modules`. The runner refuses a real run its start didn't begin: on Windows, `npm ci` can't
replace `node_modules` under the running tsx (its `esbuild.exe` is held open).

To try it without handing anything over, in any checkout: `npx tsx scripts/clip-autopilot.ts --dry --max 1` reads and
checks, prints what it would hand the server, and leaves the files as they were. `--no-merge` is accepted and ignored
(nothing merges any more).
