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

1. brings the clone to main, and rebuilds its own open PRs on main when main moved under them (a newer version, or a
   conflict): its rows applied to main's season file again, its CHANGELOG entry at main's next release. A row main
   changed meanwhile (another read got there first) is checked again; one that no longer passes is left out, and a PR
   with none left is closed;
2. takes a read-only snapshot of the live database (`VACUUM INTO` over ssh, copied down, removed from the VM);
3. takes the queue from it; skips events already in an open autopilot PR, and events read lately with nothing new
   (tried again after 3 days, left after 3 such reads until their recording or matches change);
4. reads up to `--max` events (6) with `scripts/video-frames.ts --season N --codes … --live <main's season file>`
   (`--all` for an event with rows already), then `--verify`, then `--bounds`;
5. checks every row it changed against main's (`rowProblems`, scripts/lib/autopilotRows.ts) and leaves out, with its
   reasons in the run's log, any that breaks a rule:
   - every start plausible (in order, a match apart: the server's own `plausibleStarts`);
   - every start placed or moved opens 20, 12, 5, 2 or 0 s before it on a paused frame naming the match (`opens`);
   - no new placement `unconfirmed` (only a live clip whose opening frame named nothing stays so);
   - a live clip leaves only when a frame at its opening names another match;
   - a re-read is dated after the live row;
6. opens a data PR per season file, at most 15 KB of rows each (an event's rows together), labelled
   `clip-autopilot`, with its CHANGELOG entry and version, and asks Loopy to review it. It merges like any other PR:
   the main session merges at Loopy 5/5 and green CI.

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
