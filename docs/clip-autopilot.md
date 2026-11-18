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
3. takes the queue from it; skips events already in an open autopilot PR, events read lately with nothing new
   (tried again after 3 days, left after 3 such reads until their recording or matches change), and events whose good
   rows waited last time (read again after 6 h, doubling each wait in a row up to 3 days; waits never count toward
   the 3);
4. reads up to `--max` events (12) with `scripts/video-frames.ts --season N --codes … --live <main's season file>`
   (`--all` for an event with rows already), then `--verify`, then `--bounds`. The reader's output goes into the run's
   log as it comes (lines starting `  | `, one when each video starts and when it's done), so a long read shows it's
   working. One event may take at most a quarter of its videos' summed length, and never less than 3 hours (`--event-limit`,
   minutes, is that floor; `eventLimitMs` in scripts/lib/videoFrames.ts): real reads take 2–4% of the length (2022
   ROBUQ1's 27 hours of video read in 40 and 68 minutes), so only a stuck read gets there. Past it the event stops, the videos it finished
   keep their rows, the unfinished one gets none, and the next run reads the rest (not counted as a try). A stop with
   no new row at all is read again after 6 hours; the second such stop in a row counts as a try (then the usual 3 days,
   left after 3 tries), so a video that never gets past the limit isn't read every run. The run's log ends with every
   event stopped that way and the video it was on, to look at by hand. A whole
   reader call past its own limit (12 hours a read, a backstop over the events' own; 3 for `--verify` and `--bounds`) is stopped with its whole process
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
   it's logged for the owner, and its event counts a try. Each PR gets a review request, and merges like any other:
   the main session merges it once Loopy gives 5/5 on the exact head and CI is green.

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

A real run always goes through `scripts/clip-autopilot-start.mjs` (plain Node). It holds the run's lock, puts the clone
back to main (a killed run can leave files changed), and runs `npm ci` when main's `package-lock.json` changed, before
anything runs from `node_modules`. The runner refuses a real run its start didn't begin: on Windows, `npm ci` can't
replace `node_modules` under the running tsx (its `esbuild.exe` is held open).

To try it without opening PRs, in any checkout: `npx tsx scripts/clip-autopilot.ts --dry --max 1` reads and checks,
prints the PRs it would open, and leaves the files as they were.
