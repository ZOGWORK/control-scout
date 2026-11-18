# Clip autopilot

Every event with an official recording gets frame-checked per-match clips without anyone running the frame reader
(docs/frame-timings.md) by hand. A recording the official-videos watcher links (every 6 h) is in the queue within one
coverage check (5 minutes), and the next autopilot run reads it and opens the data PR.

## The queue (`server/videos/frameQueue.ts`)

Read off the coverage check's own rows (`clip_coverage`, server/videos/coverageCheck.ts) and the frame rows themselves:

- **queued**: the event is over (its venue's last day has ended, counted in UTC days, so an American evening is never
  called over early) and a missing match sits in a video not read for this event yet, or read on or before that day
  (matches may have come after the read: read once more). Most due matches first.
- **waiting**: the event is still on, or a video's YouTube facts aren't in yet (the reader needs them).
- **read**: every readable video was read after the event; each missing match keeps its own why (what the video showed).
- **unreadable**: nothing a frame read can place: no video that day, a private video, no real start from FIRST.

Owner › Clip coverage shows each event's place (`frames`) and the queue's numbers (`frameQueue`).

## The runner (`scripts/clip-autopilot.ts`)

YouTube shows data-centre addresses a "Sign in to confirm you're not a bot" page instead of the video: measured on a
GitHub-hosted runner (the embed never loads) and already seen on the VM (#1445). So the runner is a scheduled job on a
computer at home, in a clone kept for it alone. Each run:

1. brings the clone to main, and rebuilds its own open PRs on main only when main changed one of their rows since they
   branched, they conflict, or they still carry a release (opened before data PRs dropped theirs): never to renumber.
   Its rows are applied to main's season file again and any CHANGELOG.md or package.json/lock put back to main's. A
   row main changed meanwhile (another read got there first) is checked again; one that no longer passes is left out,
   and a PR with none left is closed. Every open PR, rebuilt or not, gets the `no-changelog` label if it lacks it and a
   Loopy review request for its head unless Loopy's summary already names that head (at most once a head a day:
   `.data/autopilot/asked.json`), so a step that failed once is done on the next run;
2. takes a read-only snapshot of the live database (`VACUUM INTO` over ssh, copied down, removed from the VM);
3. takes the queue from it; skips events already in an open PR (the autopilot's, or any other PR adding rows for the
   event to a season's frame-read file: `heldElsewhere`, read again just before PRs open, where such an event's rows
   wait), events read lately with nothing new
   (tried again after 3 days, left after 3 such reads until their recording or matches change), and events whose good
   rows waited last time (read again after 6 h, doubling each wait in a row up to 3 days; waits never count toward
   the 3);
4. reads up to `--max` events (12) with `scripts/video-frames.ts --season N --codes … --live <main's season file>`
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
5. checks every row it changed against main's (`rowProblems`, scripts/lib/autopilotRows.ts) and leaves out, with its
   reasons in the run's log, any that breaks a rule:
   - every start plausible (in order, a match apart: the server's own `plausibleStarts`);
   - every start placed or moved opens 20, 12, 5, 2 or 0 s before it (or, where nothing before it names the match, 2 or 4 s after it) on a paused frame naming the match (`opens`);
   - no new placement `unconfirmed` (only a live clip whose opening frame named nothing stays so);
   - a live clip leaves only when a frame at its opening names another match;
   - a re-read is dated after the live row;
6. opens data PRs per season file, each changing that file only: no CHANGELOG entry, no version (owner's rule,
   2026-11-17), labelled `clip-autopilot` and `no-changelog`. A changed row stays on its own line and a new row goes
   just before the first row whose event code sorts after its own, so PRs from different sources don't conflict.
   Rows whose changes touch (one gap, neighbouring lines) go in one PR, and each PR's diff stays under 12 KB
   (`prChunks`, scripts/lib/autopilotRows.ts). Rows that would touch an open PR's lines, and those that don't fit under
   12 KB, wait for a later run, on the main those PRs leave; their events aren't counted as tried. A group too big
   for one PR is split at whole events. A single row whose own diff is too big for Loopy (16 KB) is never shipped:
   it's logged for the owner, and its event counts a try. Each PR gets a review request. It merges once Loopy gives 5/5 on the exact head and CI is
   green: by the runner itself at a later run (below), or by the main session.

## Merging its own PRs

At the start of each run, after rebuilding any of its PRs whose rows main changed (a rebuilt PR waits for the review
of its new head), the runner merges at most one of its own data PRs (its label, branch and mark; it runs as the
owner's GitHub account, so who opened a PR is no safeguard: the gate is), and only when nothing stops it (`scripts/lib/autopilotPr.ts` and `scripts/lib/autopilotMerge.ts`):

- Loopy's latest summary says `Confidence: 5/5` and last reviewed the PR's exact head; every check passed (5 or more);
- it changes its data file only: data PRs carry no CHANGELOG entry and no version (owner's rule, 2026-11-17), so
  there's no version to check; one opened before, still carrying CHANGELOG.md or package.json/lock, waits;
- its rows, measured from where it branched and checked against main's now: no row removed; no live start moved more
  than 2 s or dropped; a new start only where the live row had the match missing or for review; every opening 20, 12,
  5, 2 or 0 s before its start; no opening or end edge read more than 120 s from the recording's edge unless every
  frame between was clear; no video already filed under another season; starts in order within each group (quals,
  each semifinal series, a double-elimination bracket with replays after their own match, finals); every clip the
  site plays now still plays (a row gaining its first openings stops playing every start left without one). A sweep
  PR keeps the sweep's rules (`clipCheckProblems`);
- main's last commit is at least 605 s old (every merge deploys; the same spacing the main driver keeps).

It merges with `gh pr merge --merge --match-head-commit <head>` (never deleting the branch), then waits up to 20
minutes for `/api/health` to serve the merge: `ready`, and its `release` the merge commit or a main commit after it.
Gating takes minutes, so main is read again just before the merge: if it moved since the gate read it, or isn't 605 s
quiet any more (when main last moved is GitHub's record of the push, not a commit's own date), nothing merges this
run. A few seconds still pass between that read and the merge: a merge landing in them can still make two deploys
close together (the merge itself is safe: `--match-head-commit`, and the rows were checked against main moments
before). A PR whose gate can't be read (gh, git, a malformed file) waits without
stopping the PRs after it. A PR the gate stops waits, its reasons in the run's log, for the next run or the owner. `npx tsx scripts/autopilot-merge-check.ts <PR…>` prints the same gate for any PR, changing nothing;
`--no-merge` runs the autopilot without merging.

Logs: `.data/autopilot/runs/<time>.log` in the clone (every command and its output), `.data/autopilot/task.log` (the
schedule's). What it remembers between runs: `.data/autopilot/memory.json`.

## Setting it up (Windows)

Once, on a computer at home that can play YouTube, with `git`, `gh` (signed in), `node` 24 and the VM's ssh key
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
  and shipped as the coordinator's own reads (`settle`: `rowProblems`, `prChunks`, its memory), so every PR opens in
  one place;
- **sends** an idle lane its next job: up to `--max` events of its shard (`pickEvents`, with the coordinator's memory),
  a copy of this run's snapshot (gzipped), and `job.json`, then starts it. Events in a job not yet collected are held
  like an open PR's;
- **waits** on one still reading, and starts again a job not started within an hour (`laneStep`).

The coordinator keeps (rebuilds, labels, asks reviews for) the open PRs of its own shard and its lanes' (`prShard`: the
shard of a PR's first event), and alone runs the clip sweep. A lane needs its own clone, node, Playwright's Chromium
and tesseract.js, and the coordinator's ssh key; nothing else. With no flags, a computer reads the whole queue alone.

A real run always goes through `scripts/clip-autopilot-start.mjs` (plain Node). It first waits, up to 30 minutes, for 3 GB
of memory free (`AUTOPILOT_MIN_FREE_MB`; with less, processes failed to start and scheduled runs died with nothing
logged), and skips the run if it never comes. On macOS memory it can take back at once counts too (`vm_stat`: free,
inactive, speculative, purgeable). With more than 6 GB it reads in 3 lanes, else 2 (`AUTOPILOT_LANES`). It holds the run's lock, puts the clone
back to main (a killed run can leave files changed), and runs `npm ci` when main's `package-lock.json` changed, before
anything runs from `node_modules`. The runner refuses a real run its start didn't begin: on Windows, `npm ci` can't
replace `node_modules` under the running tsx (its `esbuild.exe` is held open).

To try it without opening PRs, in any checkout: `npx tsx scripts/clip-autopilot.ts --dry --max 1` reads and checks,
prints the PRs it would open, and leaves the files as they were.
