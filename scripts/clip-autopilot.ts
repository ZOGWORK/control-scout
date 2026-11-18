// The clip autopilot: reads the frames of every recording the frame-read queue says is due, with nobody running the
// reader by hand, and ships what it reads as data PRs for the usual review (docs/clip-autopilot.md).
//
// YouTube refuses data-centre addresses (GitHub's runners and the VM both get its "confirm you're not a bot" page), so
// this runs on a computer at home, from a clone of its own, on a schedule (scripts/clip-autopilot-task.ps1). Each run:
//   1. (its start, scripts/clip-autopilot-start.mjs: one run at a time, the clone and its dependencies at main) rebuilds
//      its own open PRs on main when main changed their rows, they conflict, or they still carry a release, then
//      merges one of them that passes the merge gate (scripts/lib/autopilotMerge.ts: Loopy 5/5 on its head, every check
//      passed, its rows safe) and waits for it live;
//   2. takes a read-only snapshot of the live database (VACUUM INTO over ssh: the VM's database is never written);
//   3. takes the queue from that snapshot (server/videos/frameQueue.ts), most missing first;
//   4. reads each picked event with scripts/video-frames.ts (--live main's season file), then --verify, then --bounds;
//   5. checks every row it changed (scripts/lib/autopilotRows.ts): a row that breaks a rule is left out, logged;
//   6. opens data PRs per season file, each diff under 12 KB: its data file only (no CHANGELOG, no version; labelled
//      no-changelog), each new row just before the first row whose code sorts after it; asks Loopy to review it (and
//      labels and asks again on later runs until that lands: at most once a head a day);
//   7. sweeps the live clips the clock places (video-frames.ts --clips): each read paused at its first second, pulled
//      only where that frame names another match, confirmed where it names its own, left as it is where it names none;
//      shipped as server/data/clipChecks.ts PRs, checked by scripts/lib/autopilotClips.ts.
//
//   node scripts/clip-autopilot-start.mjs [--max 12] [--sweep 4] [--db snapshot.db]   (a real run)
//   npx tsx scripts/clip-autopilot.ts --dry [--max 1] [--sweep 0] [--db snapshot.db]  (a dry run, any checkout)
//   --max N   events read per run (default 12)
//   --sweep N events whose clock clips are checked per run (default 4; 0: no sweep)
//   --db F    read this snapshot instead of taking one
//   --shard K/N  this computer's shard of the queue (default 0/1, all of it): several computers each read only the
//             events in their own shard (shardOf), keep only the open PRs their shard opened, and only shard 0 sweeps,
//             so no two read the same event or open PRs for it
//   --lanes K=user@host,…  computers with no credentials reading shard K for this one (their runs: --lane): each run
//             collects what a lane read (checked and shipped here, as this computer's own reads) and sends it its next
//             job, a copy of the snapshot and the events to read, over ssh
//   --lane    a lane's run: reads the job its coordinator left in .data/lane (no gh, no VM, no PR), its rows and
//             whether each read stopped or failed left there to collect
//   --dry     in the current checkout: read and check, print the PRs it would open, leave the files as they were
//   --no-merge  open and rebuild its PRs, never merge one
//   AUTOPILOT_SSH (ubuntu@132.145.202.89), AUTOPILOT_SSH_KEY (~/.ssh/oracle-controlpoint), TESSERACT_JS: passed on.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { applyRows, changedRows, fileRows, prChunks, prMarker, readMarker, rowKey, rowProblems, type Keyed, type Row } from "./lib/autopilotRows";
import { askDue, forgetSettled, frameFileSeason, heldElsewhere, holdCodes, laneResults, laneStep, needsRebuild, overLimit, parseLanes, parseShard, pickEvents, prShard, readOutcome, remember, rememberTimeout, rememberWait, rowsDelta, shardOf, type LaneJob, type Memory } from "./lib/autopilotRun";
import { loopySummary, reviewedSha, type IssueComment } from "./lib/autopilotMerge";
import { clipCheckProblems, clipsDelta } from "./lib/autopilotClips";
import { prGate } from "./lib/autopilotPr";
import { mainQuiet, mainStill, pickMerge, servesMerge } from "./lib/autopilotMergeStep";
import { streamRun } from "./lib/streamRun";
import type { ClipCheck } from "../server/data/clipChecks";

const argv = process.argv.slice(2);
// A flag that takes a value and was given none (last, or followed by another flag) is refused, never read as its
// default: a bare --shard would read the whole queue beside the other computers.
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v == null || v.startsWith("--")) { console.error(`--${k}: needs a value`); process.exit(2); }
  return v;
};
for (const a of argv) if (a.startsWith("--") && !["--max", "--sweep", "--db", "--shard", "--lanes", "--lane", "--dry", "--no-merge"].includes(a)) { console.error(`${a}: not a flag (--max N, --sweep N, --db F, --shard K/N, --lanes K=user@host,…, --lane, --dry, --no-merge)`); process.exit(2); }
const MAX = Number(opt("max") ?? 12), SWEEP = Number(opt("sweep") ?? 4), DRY = argv.includes("--dry"), DB = opt("db"), MERGE = !argv.includes("--no-merge");
/** Main's last commit at least this old before a merge (each merge deploys; merges spaced, owner's rule). */
const MAIN_QUIET_MS = 605_000;
/** How long a merge is waited for on the live site. */
const LIVE_WAIT_MS = 20 * 60_000;
const HEALTH_URL = process.env.AUTOPILOT_HEALTH ?? "https://controlscout.org/api/health";
if (!Number.isInteger(MAX) || MAX < 1) { console.error("--max: a whole number, 1 or more"); process.exit(2); }
if (!Number.isInteger(SWEEP) || SWEEP < 0) { console.error("--sweep: a whole number, 0 or more"); process.exit(2); }
const SHARD = parseShard(opt("shard"));
if (!SHARD) { console.error("--shard: K/N, 0 <= K < N (this computer's shard of N)"); process.exit(2); }
const LANES = parseLanes(opt("lanes"), SHARD), LANE = argv.includes("--lane");
if (typeof LANES === "string") { console.error(`--lanes: ${LANES}`); process.exit(2); }
if (LANE && (LANES.length || DRY || DB)) { console.error("--lane: a lane reads only the job it was sent (no --lanes, --dry or --db)"); process.exit(2); }

const DIR = ".data/autopilot", STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync(join(DIR, "runs"), { recursive: true });
const LOG = join(DIR, "runs", `${STAMP}.log`);
const log = (s: string) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); appendFileSync(LOG, `${line}\n`); };
const LABEL = "clip-autopilot", BRANCH = "clip-autopilot/";
const seasonFile = (season: number) => `server/data/frameTimings/${season}.ts`;
/** The first-frame sweep's rows (one per video and event). */
const CLIPS_FILE = "server/data/clipChecks.ts";

/** A command, its output to the log; throws on failure unless `ok` is set. */
function sh(cmd: string, args: string[], o: { ok?: boolean; timeoutMs?: number; quiet?: boolean; shell?: boolean; input?: string } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: o.timeoutMs ?? 600_000, maxBuffer: 64 << 20, env: process.env, shell: o.shell, input: o.input });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!o.quiet) appendFileSync(LOG, `$ ${cmd} ${args.join(" ")}\n${out}\n`);
  // No status: killed by a signal (an out-of-memory kill, the timeout) or never started; a failure either way.
  const code = r.status ?? 1;
  if (code && !o.ok) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed (${code}): ${out.trim().split("\n").slice(-3).join(" | ")}`);
  return { code, out: r.stdout ?? "" };
}
const git = (...a: string[]) => sh("git", a).out.trim();
/** A tsx script (the frame reader), its output into the run's log line by line as it comes ("  | "), so a read that
 *  takes hours shows it's working (the reader says when each video starts and is done), not only that it's alive. Past
 *  `timeoutMs` its whole process tree is stopped (streamRun): tsx runs the script in a child process, which a kill of
 *  tsx alone would leave reading. Its exit is 1 when stopped. */
async function tsx(args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  appendFileSync(LOG, `$ tsx ${args.join(" ")}\n`);
  let err = "";
  const r = await streamRun(process.execPath, ["node_modules/tsx/dist/cli.mjs", ...args], {
    timeoutMs,
    onLine: (l, from) => { appendFileSync(LOG, `  | ${l}\n`); if (from === "err") err += `${l}\n`; },
    onTimeout: () => log(`  the reader ran past ${Math.round(timeoutMs / 60_000)} min: stopped (${args.slice(1, 5).join(" ")})`),
  });
  return { code: r.code, out: r.out, err };
}

// --- Run from its start ------------------------------------------------------------------------------------------
// A real run is started by scripts/clip-autopilot-start.mjs, which holds the run's lock (CLIP_AUTOPILOT_LOCK: its text) and
// has brought the clone and its dependencies to main: npm ci can't replace node_modules under this process. A dry run
// opens nothing and works in the current checkout, so it needs neither.
const LOCK = join(DIR, "lock");
if (!DRY) {
  let held = "";
  try { held = readFileSync(LOCK, "utf8"); } catch { /* no lock: not started by the start */ }
  if (!process.env.CLIP_AUTOPILOT_LOCK || held !== process.env.CLIP_AUTOPILOT_LOCK) { log("a real run starts with: node scripts/clip-autopilot-start.mjs (it holds the run's lock, and brings the clone and its dependencies to main)"); process.exit(2); }
}

const MEMORY_FILE = join(DIR, "memory.json");
const memory: Memory = existsSync(MEMORY_FILE) ? JSON.parse(readFileSync(MEMORY_FILE, "utf8")) : {};
/** The last Loopy ask on each open PR (by number): its head and when (askDue). */
const ASKED_FILE = join(DIR, "asked.json");
const asked: Record<string, { head: string; at: string }> = existsSync(ASKED_FILE) ? JSON.parse(readFileSync(ASKED_FILE, "utf8")) : {};
/** The PRs open this run (listed, and opened by it), by number; null until the list is read. Declared here, before the
 *  exit handler that reads it, so an early exit finds it set. */
let openNow: Set<string> | null = null;
/** Files a read may have written, as they were before it: put back however the run ends. */
const restore = new Map<string, string>();
// However the run ends (done, stopped, or thrown): what it tried keeps its retry and give-up counts, and every file a
// read wrote is put back, so the clone is never left with changes.
process.on("exit", () => {
  // A dry run opens no PR: what it "would open" or didn't find never counts toward the real runs' retries.
  if (!DRY) {
    writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 1));
    // Asks kept for open PRs only: a closed or merged PR's is never read again. Before the list was read: all kept.
    const keep = openNow;
    writeFileSync(ASKED_FILE, JSON.stringify(keep ? Object.fromEntries(Object.entries(asked).filter(([n]) => keep.has(n))) : asked, null, 1));
  }
  for (const [file, text] of restore) writeFileSync(file, text);
});

const mainText = (path: string) => (DRY ? readFileSync(path, "utf8") : git("show", `origin/main:${path}`) + "\n");

/** Open autopilot PRs: number, branch, and the rows (season, video|event; the file, for a sweep PR) their mark names. */
function openPrs(): { number: number; branch: string; head: string; labels: string[]; season: number; rows: string[]; file?: string; mergeable: string }[] {
  const list = JSON.parse(sh("gh", ["pr", "list", "--state", "open", "--label", LABEL, "--limit", "100", "--json", "number,headRefName,headRefOid,labels,body,mergeable"], { quiet: true }).out || "[]");
  return list.flatMap((p: any) => {
    const m = readMarker(String(p.body ?? ""));
    return m && String(p.headRefName).startsWith(BRANCH) ? [{ number: p.number, branch: p.headRefName, head: String(p.headRefOid), labels: (p.labels ?? []).map((l: { name: string }) => l.name), ...m, mergeable: String(p.mergeable) }] : [];
  });
}

/** Events other open PRs (another session's, not the autopilot's) bring frame-read rows for: held like the autopilot's
 *  own, so no event gets a second PR (heldElsewhere). Read when the queue is picked, and again just before PRs open, as
 *  a read takes hours and another PR may have opened meanwhile. A file GitHub shows no patch for (too big) is read at
 *  the PR's head and its rows compared with main's. Whatever can't be read (the list, one PR, one file) is logged, and
 *  only that holds nothing: the rest still do. */
function othersHold(): Map<string, number> {
  if (DRY) return new Map();
  let list: { number: number; headRefOid: string; files?: { path: string }[] }[];
  try {
    list = JSON.parse(sh("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefOid,files"], { quiet: true }).out || "[]");
  } catch (e) {
    log(`other open PRs couldn't be listed (${(e as Error).message}); none held off this time`);
    return new Map();
  }
  const own = new Set(open.map((p) => p.number));
  const prs: { number: number; files: { filename: string; patch?: string }[] }[] = [];
  for (const p of list.filter((x) => !own.has(x.number) && (x.files ?? []).some((f) => frameFileSeason(f.path) != null))) {
    try {
      prs.push({ number: p.number, files: sh("gh", ["api", `repos/{owner}/{repo}/pulls/${p.number}/files`, "--paginate", "--jq", ".[] | {filename, patch} | @json"], { quiet: true }).out
        .split("\n").filter(Boolean).map((l) => JSON.parse(l) as { filename: string; patch?: string }) });
    } catch (e) { log(`#${p.number}: its files couldn't be read (${(e as Error).message}); its events aren't held off this time`); }
  }
  const { held, unread } = heldElsewhere(prs);
  for (const u of unread) {
    const head = list.find((x) => x.number === u.number)?.headRefOid;
    try {
      const text = sh("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/{owner}/{repo}/contents/${u.filename}?ref=${head}`], { quiet: true }).out;
      const codes = [...new Set(changedRows(mainText(u.filename), text).map((r) => r.code))];
      holdCodes(held, frameFileSeason(u.filename)!, codes, u.number);
      log(`#${u.number}: GitHub shows no patch for ${u.filename}; its copy read instead, ${codes.length} event${codes.length === 1 ? "" : "s"} held`);
    } catch (e) { log(`#${u.number}: GitHub shows no patch for ${u.filename} and its copy couldn't be read (${(e as Error).message}); its events aren't held off this time`); }
  }
  return held;
}

/** A data PR changes its data file only (owner's rule, 2026-11-17): no CHANGELOG entry, no version, so PRs never
 *  renumber or conflict on a release. The label the Changelog check passes. Release files a PR opened before carries
 *  are put back to main's at its next rebuild. */
const NO_CHANGELOG = "no-changelog", RELEASE_FILES = ["CHANGELOG.md", "package.json", "package-lock.json"];
/** A data PR's diff at most this (Loopy can't review a diff much over 16 KB). */
const PR_DIFF_MAX = 12_000;
/** The rows open autopilot PRs bring to `file` (as their branches have them): a new PR never touches their lines. A
 *  branch that can't be read holds nothing, logged (its rebuild above logged why too). */
function heldRows(file: string): Keyed[] {
  return open.filter((p) => (p.file ?? seasonFile(p.season)) === file).flatMap((p) => {
    const want = new Set(p.rows);
    try { return fileRows<Keyed>(git("show", `origin/${p.branch}:${file}`)).filter((r) => want.has(rowKey(r))); } catch (e) {
      log(`#${p.number}: its branch couldn't be read (${(e as Error).message}); new PRs aren't held off its lines this run`);
      return [];
    }
  });
}
const commitEach = (files: [string, string][]) => { for (const [f, msg] of files) { git("add", f); git("commit", "--quiet", "-m", msg); } };
const push = (branch: string) => git("push", "--quiet", "--no-verify", "origin", `HEAD:refs/heads/${branch}`);
/** Asks Loopy to review `head` when askDue says so (Loopy's summary doesn't name it; not asked for it in a day). */
function askReview(pr: number, head: string): void {
  let reviewed: string | null = null;
  try {
    const comments = sh("gh", ["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--paginate", "--jq", ".[] | {user: {login: .user.login, type: .user.type}, body, updated_at} | @json"], { quiet: true }).out
      .split("\n").filter(Boolean).map((l) => JSON.parse(l) as IssueComment);
    reviewed = reviewedSha(loopySummary(comments));
  } catch (e) { log(`#${pr}: its comments couldn't be read (${(e as Error).message}); Loopy asked if due`); }
  if (!askDue(asked[pr], head, reviewed)) return;
  const r = sh("gh", ["pr", "comment", String(pr), "--body", "@loopyreviews-bot review"], { ok: true });
  if (r.code) log(`#${pr}: Loopy couldn't be asked (gh exit ${r.code}); asked again next run`);
  else asked[pr] = { head, at: new Date().toISOString() };
}
/** What every open PR gets each run, whether or not it's rebuilt, so a step that failed once is done on a later run:
 *  the no-changelog label, and Loopy asked for its head (askReview). */
function followUps(pr: number, head: string, labels: string[]): void {
  if (!labels.includes(NO_CHANGELOG)) {
    const r = sh("gh", ["pr", "edit", String(pr), "--add-label", NO_CHANGELOG], { ok: true });
    log(r.code ? `#${pr}: couldn't be labelled ${NO_CHANGELOG} (gh exit ${r.code}); tried again next run` : `#${pr}: labelled ${NO_CHANGELOG}`);
  }
  askReview(pr, head);
}
/** Closes an autopilot PR; false (logged) where GitHub refused or couldn't be reached: the PR is still open. */
function closePr(pr: number, comment: string): boolean {
  const r = sh("gh", ["pr", "close", String(pr), "--comment", comment], { ok: true });
  if (r.code) log(`#${pr}: couldn't be closed (gh exit ${r.code}); still open, tried again next run`);
  return !r.code;
}

/** A data PR's words: title, description, mark, commit line. */
type PrText = { title: string; body: string[]; marker: string; what: string };
/** A frame-read PR's words, from its rows against main's (opened, or rebuilt on main with fewer rows). */
function framesText(season: number, rows: Row[], live: Map<string, Row>): PrText {
  const d = rowsDelta(rows, live);
  return {
    what: `frame-read rows for ${d.events.join(", ")}`,
    title: `Clips: frame-read ${d.events.join(", ")} (${season}), ${d.clips} new`,
    body: [
      `Read by the clip autopilot (\`scripts/clip-autopilot.ts\`, docs/clip-autopilot.md), with nobody running the reader: ${d.events.length} events from the frame-read queue, ${d.recordings} recordings, ${d.clips} new clips, ${d.reasons} matches given a reason from the frames.`,
      "", "Every row passed `rowProblems` against main's row: each placed or moved start opens 20/12/5/2/0 s before it (or 2/4 s after it) on a frame naming its match; starts plausible and in the order played; no new `unconfirmed`; no live clip pulled without a frame at its own second naming another match; re-reads dated after the live row.",
      "", ...rows.map((r) => `- ${r.code} \`${r.videoId}\`: ${Object.keys(r.starts).length} starts, ${Object.keys(r.missing ?? {}).length} missing, ${Object.keys(r.review ?? {}).length} for review`),
    ],
    marker: prMarker(season, rows),
  };
}
/** A sweep PR's words, from its rows against main's. */
function clipsText(rows: ClipCheck[], live: Map<string, ClipCheck>): PrText {
  const d = clipsDelta(rows, live);
  return {
    what: `first-frame checks for ${d.events.join(", ")}`,
    title: `Clips: first-frame checks, ${d.pulled} pulled, ${d.ok} confirmed (${d.events.length} events)`,
    body: [
      `Swept by the clip autopilot (\`scripts/video-frames.ts --clips\`): each clip the live site plays from the clock, read paused at its first second. ${d.ok} name their own match (ok), ${d.pulled} name another match (pulled: never served), ${d.unconfirmed} name none (still served, read again next sweep).`,
      "", "Every row passed `clipCheckProblems` against main's: a pull only where the frame names a different match; no clip in two states; what main's row settled kept (a pull lifts only on a frame naming the match, an ok goes only on one naming another).",
      "", ...d.pulledList.map((x) => `- pulled: ${x}`),
    ],
    marker: prMarker(0, rows, CLIPS_FILE),
  };
}

// --- A lane: reads the job its coordinator sent, for it to collect --------------------------------------------------------
// No gh, no VM key, no PR: the job's snapshot, its events read (readSeason), and per season the rows the read changed,
// whether a read failed and the events stopped at their limit, left in .data/lane/results/<job> with the run's log. The
// coordinator checks and ships them as its own reads (settle) on its next run.
const LANE_DIR = join(".data", "lane"), LANE_STATE = join(LANE_DIR, "state.json");
if (LANE) {
  const state = existsSync(LANE_STATE) ? JSON.parse(readFileSync(LANE_STATE, "utf8")) : { state: "idle" };
  const job = existsSync(join(LANE_DIR, "job.json")) ? JSON.parse(readFileSync(join(LANE_DIR, "job.json"), "utf8")) as { id: string; seasons: { season: number; codes: string[] }[] } : null;
  if (state.state !== "queued" || !job || state.id !== job.id) { log(`lane: no job queued (${state.state}${state.id ? ` ${state.id}` : ""})`); process.exit(0); }
  const out = join(LANE_DIR, "results", job.id), at = () => new Date().toISOString();
  mkdirSync(out, { recursive: true });
  let finished = false;
  // However the run ends before its job is read (a crash, a near-black player): failed, for the coordinator to collect
  // and send again; its events aren't counted as tried.
  process.on("exit", (code) => { if (!finished) writeFileSync(LANE_STATE, JSON.stringify({ state: "failed", id: job.id, at: at(), why: `the lane's run ended (exit ${code}) before its job was read: its log ${LOG}` })); });
  writeFileSync(LANE_STATE, JSON.stringify({ state: "running", id: job.id, at: at() }));
  const gz = join(LANE_DIR, "snapshot.db.gz"), db = join(LANE_DIR, "snapshot.db");
  if (existsSync(gz)) { writeFileSync(db, gunzipSync(readFileSync(gz))); rmSync(gz); }
  process.env.DATABASE_URL = `file:${db.replace(/\\/g, "/")}`;
  log(`lane: job ${job.id}: ${job.seasons.map((x) => `${x.season} ${x.codes.join(",")}`).join("; ")}`);
  for (const { season, codes } of job.seasons) {
    const r = existsSync(seasonFile(season)) ? await readSeason(season, codes) : { changed: [], readFailed: true, stopped: new Map() };
    writeFileSync(join(out, `${season}.json`), JSON.stringify({ season, codes, changed: r.changed, readFailed: r.readFailed, stopped: [...r.stopped] }));
    log(`lane: ${season}: ${r.changed.length} rows changed${r.readFailed ? ", a read failed" : ""}`);
  }
  copyFileSync(LOG, join(out, "run.log"));
  finished = true;
  writeFileSync(LANE_STATE, JSON.stringify({ state: "done", id: job.id, at: at() }));
  log("lane: done, for its coordinator to collect");
  process.exit(0);
}
/** The shards whose PRs this computer keeps: its own and its lanes'. */
const KEEPS = new Set([SHARD.k, ...LANES.map((l) => l.k)]);

// --- 1b. Own PRs rebuilt on main --------------------------------------------------------------------------------------
if (!DRY) sh("gh", ["label", "create", LABEL, "--force", "--color", "0e8a16", "--description", "A data PR the clip autopilot opened (scripts/clip-autopilot.ts)"], { ok: true, quiet: true });
const open = DRY ? [] : openPrs();
openNow = new Set(open.map((p) => String(p.number)));
/** PRs rebuilt on main this run: each waits for Loopy's review of its new head, so none merges this run. */
const rebuilt = new Set<number>();
for (const p of open) {
  // Another computer's PR (its shard opened it) is its to keep: rebuilt, labelled and asked for there. This one keeps its
  // own shard's and its lanes' (it opened theirs).
  if (!KEEPS.has(prShard(p, SHARD.n))) continue;
  try {
    // Inside the try: a branch that can't be read (deleted, not fetched) is logged and left, never the whole run.
    // Rebuilt only where main changed one of its rows since it branched (its rows checked again on main's), it
    // conflicts, or it still carries a release (opened before data PRs dropped theirs). Never to renumber.
    const file = p.file ?? seasonFile(p.season), want = new Set(p.rows);
    const base = git("merge-base", `origin/${p.branch}`, "origin/main");
    // A file the merge base didn't have (the PR's season file was new then) has no rows there.
    let baseText = "";
    try { baseText = git("show", `${base}:${file}`) + "\n"; } catch { /* not at the merge base */ }
    const why = needsRebuild({ mergeable: p.mergeable, want, baseRows: fileRows<Keyed>(baseText), mainRows: fileRows<Keyed>(mainText(file)), changedFiles: git("diff", "--name-only", base, `origin/${p.branch}`).split("\n"), releaseFiles: RELEASE_FILES });
    if (!why.length) { followUps(p.number, p.head, p.labels); continue; }
    // A sweep PR's rows are checked as the sweep's are; a frame-read PR's as the reader's.
    const problems = (r: Keyed, was?: Keyed) => (file === CLIPS_FILE ? clipCheckProblems(r as ClipCheck, was as ClipCheck | undefined) : rowProblems(r as Row, was as Row | undefined));
    const rows = fileRows<Keyed>(git("show", `origin/${p.branch}:${file}`)).filter((r) => want.has(rowKey(r)));
    const live = new Map(fileRows<Keyed>(mainText(file)).map((r) => [rowKey(r), r]));
    const keep = rows.filter((r) => !problems(r, live.get(rowKey(r))).length);
    if (!keep.length) {
      if (closePr(p.number, "Main changed these rows since this read (another read reached them first): closed, the next run reads anything still due.")) log(`#${p.number}: closed, main read its rows meanwhile`);
      continue;
    }
    // Its words made again from the rows it keeps: rows main took meanwhile leave its title and mark too.
    const text = file === CLIPS_FILE ? clipsText(keep as ClipCheck[], live as Map<string, ClipCheck>) : framesText(p.season, keep as Row[], live as Map<string, Row>);
    git("switch", "--quiet", "--detach", `origin/${p.branch}`);
    sh("git", ["merge", "--no-commit", "--no-ff", "origin/main"], { ok: true });
    // Its rows on main's file; every release file as main has it (an older PR's release leaves).
    writeFileSync(file, applyRows(mainText(file), keep));
    git("checkout", "origin/main", "--", ...RELEASE_FILES);
    for (const f of [file, ...RELEASE_FILES]) git("add", f);
    git("commit", "--quiet", "--no-edit", "-m", `Merge main; ${file}: its rows on main's`);
    push(p.branch);
    const head = git("rev-parse", "HEAD");
    rebuilt.add(p.number);
    log(`#${p.number}: rebuilt on main (${why.join(", ")})${keep.length < rows.length ? ` (${rows.length - keep.length} rows main changed meanwhile left out)` : ""}`);
    // Pushed: its words, label and review ask follow, each going ahead if another fails. Words that failed are made
    // again at its next rebuild; the label and ask on every run (followUps).
    const edit = sh("gh", ["pr", "edit", String(p.number), "--title", text.title, "--body", [...text.body, "", text.marker].join("\n")], { ok: true });
    if (edit.code) log(`#${p.number}: its title and description couldn't be updated (gh exit ${edit.code}); its mark names its old rows until its next rebuild`);
    followUps(p.number, head, p.labels);
  } catch (e) {
    log(`#${p.number}: couldn't be rebuilt on main (${(e as Error).message}); left as it is`);
    sh("git", ["merge", "--abort"], { ok: true, quiet: true });
  } finally {
    // A rebuild that failed after its merge was committed or its files written leaves them behind: put back, so the
    // switch to main (and the rest of the run) goes ahead.
    if (!DRY) { sh("git", ["reset", "--quiet", "--hard"], { ok: true }); git("switch", "--quiet", "--detach", "origin/main"); }
  }
}

// --- 1c. One of its own PRs merged, where nothing stops it ------------------------------------------------------------
// The owner's standing rule: a data PR merges at Loopy 5/5 on its exact head with every check passed. With nobody
// watching, the autopilot merges its own data PRs only (its label, branch and mark), each through the gate
// (scripts/lib/autopilotMerge.ts: anything a person should look at first stops it), at most one a run, never within
// MAIN_QUIET of main's last commit (each merge deploys and restarts the site), never deleting its branch. Then it
// waits for /api/health to serve the merge. --no-merge: open and rebuild PRs only. Called below its helpers: a `const`
// read before its line runs throws (the step would stop every run with nothing merged).
/** main's head as GitHub has it now: its sha and when main last moved, from GitHub's own record of the push (a commit
 *  pushed straight to main keeps the date it was made, which can be long before). Without that record, the commit's. */
function mainHead(): { sha: string; at: number } {
  const [sha, at] = sh("gh", ["api", "repos/{owner}/{repo}/activity?ref=refs/heads/main&per_page=1", "--jq", ".[0] | .after + \" \" + .timestamp"], { quiet: true, ok: true }).out.trim().split(" ");
  if (/^[0-9a-f]{40}$/.test(sha ?? "") && Number.isFinite(Date.parse(at ?? ""))) return { sha, at: Date.parse(at) };
  const [s, date] = sh("gh", ["api", "repos/{owner}/{repo}/commits/main", "--jq", ".sha + \" \" + .commit.committer.date"], { quiet: true }).out.trim().split(" ");
  return { sha: s, at: Date.parse(date) };
}
/** The merge commit GitHub made for `pr`, asked a few times (it can take a moment to report it); "" if never. */
function mergeCommitOf(pr: number): string {
  for (let i = 0; i < 4; i++) {
    const sha = sh("gh", ["api", `repos/{owner}/{repo}/pulls/${pr}`, "--jq", ".merge_commit_sha // \"\""], { quiet: true, ok: true }).out.trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    sh(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { quiet: true, ok: true });
  }
  return "";
}
function mergeOne(): void {
  let pick: { number: number; head: string } | null = null, done = false;
  try {
    const before = mainHead();
    const why = mainQuiet(before.at, Date.now(), MAIN_QUIET_MS);
    if (why) { log(`merge: ${why}: none this run`); return; }
    const me = sh("gh", ["api", "user", "--jq", ".login"], { quiet: true }).out.trim();
    git("fetch", "--quiet", "origin");
    const gatedOn = git("rev-parse", "origin/main");
    const picked = pickMerge(open, {
      rebuilt, me, gate: prGate,
      author: (n) => sh("gh", ["pr", "view", String(n), "--json", "author", "--jq", ".author.login"], { quiet: true }).out.trim(),
    });
    for (const p of picked.passed) log(`merge: ${p}`);
    pick = picked.pick;
    if (!pick) return;
    // Gating took minutes: main read again, the merge only on the main the rows were checked against, still quiet.
    const moved = mainStill(gatedOn, mainHead(), Date.now(), MAIN_QUIET_MS);
    if (moved) { log(`merge: #${pick.number} waits: ${moved}`); return; }
    // The exact head the gate passed, or no merge: a push since then means another review.
    const r = sh("gh", ["pr", "merge", String(pick.number), "--merge", "--match-head-commit", pick.head], { ok: true });
    if (r.code) { log(`merge: #${pick.number} refused by GitHub (exit ${r.code}): left open`); return; }
    done = true;
    let merged = mergeCommitOf(pick.number);
    // Never reported: main's head now, which holds the merge (a later commit only makes the live check stricter).
    if (!merged) { git("fetch", "--quiet", "origin"); merged = git("rev-parse", "origin/main"); log(`merge: #${pick.number}'s merge commit not reported; waiting on main's head`); }
    log(`merge: #${pick.number} merged as ${merged.slice(0, 9)}; waiting for it live`);
    waitLive(merged, `#${pick.number}`);
    // main moved: what this run opens next is made on main as it is now, live or not.
    git("fetch", "--quiet", "origin");
  } catch (e) {
    log(`merge: stopped (${(e as Error).message}); ${done && pick ? `#${pick.number} was merged: check it went live` : "nothing merged this run"}`);
  }
}
/** Waits (up to LIVE_WAIT_MS) for the site's /api/health to serve `merged` (the merge commit) or a later main commit. */
function waitLive(merged: string, what: string): void {
  const until = Date.now() + LIVE_WAIT_MS;
  const isAncestor = (older: string, newer: string) => {
    sh("git", ["fetch", "--quiet", "origin"], { ok: true, quiet: true });
    return sh("git", ["merge-base", "--is-ancestor", older, newer], { ok: true, quiet: true }).code === 0;
  };
  while (Date.now() < until) {
    sh(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { quiet: true, ok: true });
    const health = sh("curl", ["-s", "--max-time", "20", HEALTH_URL], { quiet: true, ok: true }).out;
    if (servesMerge(health, merged, isAncestor)) { log(`merge: ${what} live (${merged.slice(0, 9)})`); return; }
  }
  log(`merge: ${what} (${merged.slice(0, 9)}) not live after ${LIVE_WAIT_MS / 60_000} min: check the deploy`);
}
if (!DRY && MERGE) mergeOne();

// --- 2. A snapshot of the live database ---------------------------------------------------------------------------------
let snapshot = DB;
if (!snapshot) {
  const host = process.env.AUTOPILOT_SSH ?? "ubuntu@132.145.202.89", key = process.env.AUTOPILOT_SSH_KEY ?? join(homedir(), ".ssh", "oracle-controlpoint");
  const ssh = ["-o", "BatchMode=yes", "-i", key], remote = `/tmp/autopilot-${STAMP}.db`;
  // VACUUM INTO reads the database and writes a copy: the live file is never written.
  // The copy's script goes in on stdin: no quoting to survive two shells (Windows' and the VM's).
  const vacuum = `require("@libsql/client").createClient({ url: "file:/opt/control-scout/shared/data/scout.db" }).execute(${JSON.stringify(`VACUUM INTO '${remote}'`)}).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });`;
  // The copy is removed from the VM whatever fails: the copy, its gzip, or the download.
  try {
    sh("ssh", [...ssh, host, `cd /opt/control-scout/current && sudo -u controlscout node - && sudo gzip -f ${remote} && sudo chmod 644 ${remote}.gz`], { timeoutMs: 900_000, input: vacuum });
    sh("scp", [...ssh, `${host}:${remote}.gz`, join(DIR, "snapshot.db.gz")], { timeoutMs: 1_800_000 });
  } finally { sh("ssh", [...ssh, host, `sudo rm -f ${remote} ${remote}.gz`], { ok: true }); }
  snapshot = join(DIR, "snapshot.db");
  writeFileSync(snapshot, gunzipSync(readFileSync(join(DIR, "snapshot.db.gz"))));
  log(`snapshot taken (${Math.round(readFileSync(snapshot).length / 1e6)} MB)`);
}
process.env.DATABASE_URL = `file:${snapshot.replace(/\\/g, "/")}`;

// --- 3. The queue ------------------------------------------------------------------------------------------------------
const { migrate, all } = await import("../server/db.js");
await migrate();
const { frameQueue } = await import("../server/videos/frameQueue.js");
const queue = await frameQueue();
// Events a frame-read PR holds wait for it; a sweep PR (its rows are clipChecks') holds none from the reader.
const inPr = new Set(open.filter((p) => !p.file).flatMap((p) => p.rows.map((k) => `${p.season}/${k.split("|")[1]}`)));
// This computer's shard of it: the other computers read the rest (their open PRs still hold their events, above).
const inShard = (k: number) => (SHARD.n > 1 ? queue.filter((q) => shardOf(`${q.season}/${q.code}`, SHARD.n) === k) : queue);
const mine = inShard(SHARD.k);
// What it remembers covers its lanes' events too: forgotten only once an event leaves the whole queue.
forgetSettled(memory, new Set(queue.filter((q) => q.frames.state === "queued").map((q) => `${q.season}/${q.code}`)));
// Events in a job sent to a lane and not collected yet are read there: held like an open PR's. The job file here is
// this computer's own record of what it sent (written once the send succeeded, removed once its results are in).
const laneJobFile = (k: number) => join(DIR, "lanes", String(k), "job.json");
const laneJob = (k: number): LaneJob | null => { try { return JSON.parse(readFileSync(laneJobFile(k), "utf8")); } catch { return null; } };
for (const lane of LANES) for (const x of laneJob(lane.k)?.seasons ?? []) for (const c of x.codes) inPr.add(`${x.season}/${c}`);
// And events another session's open data PR already carries: never read for a second PR.
const elsewhere = othersHold();
for (const [k, n] of elsewhere) if (!inPr.has(k)) { inPr.add(k); log(`  held: ${k} is in #${n}, another open PR`); }
const { picked, skipped } = pickEvents(mine, inPr, memory, MAX);
log(`queue: ${queue.filter((q) => q.frames.state === "queued").length} events queued${SHARD.n > 1 ? `, ${mine.filter((q) => q.frames.state === "queued").length} in shard ${SHARD.k}/${SHARD.n}` : ""}; reading ${picked.map((q) => `${q.season}/${q.code} (${q.frames.due})`).join(", ") || "none"}`);
for (const s of skipped.filter((x) => x.why !== "next run")) log(`  skipped ${s.event}: ${s.why}`);

// --- Shipping: one data PR per chunk of rows -----------------------------------------------------------------------------

/** Opens a data PR with these rows applied to main's `file` (its one commit, its one file), labelled no-changelog; Loopy
 *  asked to review. `marker`: the PR's mark (prMarker). */
function openPr(o: { file: string; rows: Keyed[]; branch: string } & PrText): boolean {
  if (DRY) { log(`would open "${o.title}" on ${o.branch}: ${o.rows.length} rows, ${o.rows.map(rowKey).join(" ")}`); return true; }
  let pushed = false;
  try {
    // Its one commit on the main its file is read from: anything that fetched since the clone was put on main (a merge
    // step, a check by hand) moves origin/main but not HEAD, and a commit on the older HEAD would carry every row main
    // changed since as its own (2024 USMNCMPGLXY's #1925: 9 other events' rows, a 58 KB diff on a 252-commit-old base).
    sh("git", ["reset", "--quiet", "--hard"], { ok: true });
    git("switch", "--quiet", "--detach", "origin/main");
    writeFileSync(o.file, applyRows(mainText(o.file), o.rows));
    commitEach([[o.file, `${o.file}: ${o.what}`]]);
    push(o.branch);
    pushed = true;
    const url = sh("gh", ["pr", "create", "--base", "main", "--head", o.branch, "--title", o.title, "--label", LABEL, "--label", NO_CHANGELOG, "--body", [...o.body, "", o.marker].join("\n")]).out.trim();
    pushed = false;
    log(`opened ${url}: ${o.title}`);
    openNow?.add(url.split("/").pop() ?? "");
    // Opened: a review ask that fails is made again next run (followUps).
    askReview(Number(url.split("/").pop()), git("rev-parse", "HEAD"));
    return true;
  } catch (e) {
    // The run goes on to the next PR, season and the sweep; these rows are read again next run. A branch pushed with no
    // PR opened on it is removed: nothing else would ever close it.
    log(`"${o.title}": couldn't be opened (${(e as Error).message})`);
    if (pushed && sh("git", ["push", "--quiet", "--no-verify", "origin", "--delete", `refs/heads/${o.branch}`], { ok: true }).code) log(`  its branch ${o.branch} couldn't be removed; remove it by hand`);
    return false;
  } finally {
    // A step that failed halfway leaves its files behind: the clone is the autopilot's own, so put back to main.
    sh("git", ["reset", "--quiet", "--hard"], { ok: true });
    git("switch", "--quiet", "--detach", "origin/main");
  }
}
/** The frame reader. A read whose frames came up near-black (a player showing no picture) wrote nothing; the run stops
 *  there, every file put back as it was, and opens no PR: rows read off a black player would all say "no frame read". */
async function reader(args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  const r = await tsx(args, timeoutMs);
  const dark = r.out.split("\n").find((l) => l.startsWith("NEAR-BLACK FRAMES"));
  if (dark) {
    // The exit puts every file back (restore).
    log(`stopped: ${dark}. The video player shows no picture; nothing read, no PR opened. Fix the reader, then run again.`);
    process.exit(3);
  }
  return r;
}
const branchStamp = STAMP.slice(0, 16).replace(/[-T]/g, "");

/** Events the reader stopped at its per-event limit with no new row this run: listed in the run's summary. */
const stoppedAtLimit: string[] = [];

// --- 4–6. Read the due events, check, ship, season by season ------------------------------------------------------------------
/** Reads `codes` of `season` into its file (those not read yet, then those with rows already whole, then --verify and
 *  --bounds), and puts the file back: the rows the read changed, whether a read failed, and the events the reader
 *  stopped at its per-event limit (and the video each was on). This computer's reads and a lane's alike. */
async function readSeason(season: number, codes: string[]): Promise<{ changed: Row[]; readFailed: boolean; stopped: Map<string, string | undefined> }> {
  const file = seasonFile(season);
  const before = readFileSync(file, "utf8"), liveFile = join(DIR, `live-${season}.ts`);
  writeFileSync(liveFile, mainText(file));
  restore.set(file, before);
  // An event with rows already (read before it finished, or one of its videos read) is read again whole (--all): the
  // reader otherwise skips an event whose videos all have rows. The others read what isn't read yet.
  const hasRows = new Set(fileRows(before).map((r) => r.code));
  const again = codes.filter((c) => hasRows.has(c)), fresh = codes.filter((c) => !hasRows.has(c));
  // --live keeps the clips main plays from being dropped on a frame that names nothing; a season with no rows yet has
  // none to keep (and the reader refuses an empty --live file).
  const base = ["scripts/video-frames.ts", "--season", String(season), ...(fileRows(mainText(file)).length ? ["--live", liveFile] : []), "--lanes", "2"];
  // A read that crashed, timed out or was killed read nothing for sure: its events aren't counted as tried (remember).
  let readFailed = false;
  // Events the reader stopped at its per-event limit, and the video each was on (overLimit).
  const stopped = new Map<string, string | undefined>();
  const pass = async (args: string[], ms: number, what: string) => {
    const r = await reader([...base, ...args], ms);
    if (r.code) readFailed = true;
    for (const [c, v] of overLimit(r.err)) stopped.set(c, v);
    log(`${season} ${what}: exit ${r.code}`);
  };
  // A read call's own limit is only a backstop: each event has its own, scaled to its videos' length (the reader's
  // eventLimitMs, as long as its videos, 3 h at least): this one stops only a read call that runs a day, whatever it holds.
  for (const [list, extra] of [[fresh, []], [again, ["--all"]]] as const) if (list.length) await pass(["--codes", list.join(","), ...extra], 24 * 3600_000, `read ${list.join(",")}`);
  for (const p of ["--verify", "--bounds"]) await pass(["--codes", codes.join(","), p], 3 * 3600_000, p);
  const after = readFileSync(file, "utf8");
  writeFileSync(file, before);
  return { changed: changedRows(before, after).filter((x) => codes.includes(x.code)), readFailed, stopped };
}

/** Checks the rows a read of `codes` changed against main's, opens their PRs, and remembers what became of each event
 *  (remember, rememberWait, rememberTimeout): this computer's reads and its lanes' alike. The rows a PR opened with. */
async function settle(season: number, codes: string[], read: { changed: Row[]; readFailed: boolean; stopped: Map<string, string | undefined> }): Promise<Row[]> {
  const file = seasonFile(season);
  const live = new Map(fileRows(mainText(file)).map((r) => [rowKey(r), r]));
  // Each event's played matches in the order they were played (FIRST's times are the venue's own, so they sort).
  const order = new Map<string, string[]>();
  for (const m of await all<{ code: string; label: string }>(`SELECT code, label FROM matches WHERE season = ? AND played = 1 AND time IS NOT NULL AND code IN (${codes.map(() => "?").join(",")}) ORDER BY code, time`, [season, ...codes])) {
    (order.get(String(m.code)) ?? order.set(String(m.code), []).get(String(m.code))!).push(String(m.label));
  }
  const good: Row[] = [], heldOther: Row[] = [];
  // An event another PR took up while this one was read waits for it (as an open PR's lines do): no second PR for it.
  const other = othersHold();
  for (const r of read.changed) {
    const problems = rowProblems(r, live.get(rowKey(r)), order.get(r.code)), held = other.get(`${season}/${r.code}`);
    if (problems.length) log(`  ${r.code} ${r.videoId}: left out, ${problems.join("; ")}`);
    else if (held != null) { heldOther.push(r); log(`  ${r.code} ${r.videoId}: waits, #${held} (another open PR) carries ${r.code}`); }
    else good.push(r);
  }
  // Shipped: only events whose rows a PR really opened with (a failed open closes its PR; the rows are read again).
  // Rows that would touch an open PR's lines, or overflow a PR Loopy can review, wait for a later run (prChunks).
  // A row too big for any PR Loopy can review is the owner's: logged, never shipped.
  const opened: Row[] = [], { ship, later, tooBig } = prChunks(mainText(file), good, PR_DIFF_MAX, heldRows(file));
  for (const r of tooBig) log(`  ${r.code} ${r.videoId}: its diff alone is too big for one PR Loopy can review; left for the owner`);
  // The chunk's index keeps two PRs of one event's rows (an event split across chunks) on two branches.
  ship.forEach((chunk, i) => { if (openPr({ file, rows: chunk, branch: `${BRANCH}${season}-${branchStamp}-${chunk[0].code}-${i + 1}`, ...framesText(season, chunk, live) })) opened.push(...chunk); });
  const count = (list: Row[], code: string) => list.filter((r) => r.code === code).length;
  for (const code of codes) {
    const e = { code }, key = `${season}/${code}`, readFailed = read.readFailed, stopped = read.stopped;
    const changed = count(read.changed, code);
    const outcome = readOutcome({ rows: count(good, e.code), opened: count(opened, e.code), waiting: count(later, e.code) + count(heldOther, e.code), tooBig: count(tooBig, e.code), readFailed, timedOut: stopped.has(e.code), changed });
    if (outcome === "timed out") {
      const video = stopped.get(e.code), counted = rememberTimeout(memory, key, video) === "counted";
      stoppedAtLimit.push(`${key}${video ? ` (video ${video})` : ""}${counted ? ": nothing new again, counted as a try" : ""}`);
      log(`  ${key}: stopped at the reader's per-event limit with no new row${video ? ` on video ${video}` : ""}; ${counted ? "the second run in a row: counted as a try (read again after 3 days, left after 3 tries)" : "read again after 6 h, not counted as a try"}`);
    }
    else if (outcome === "waits") { rememberWait(memory, key, "rows wait for an open PR's lines or the next PR"); log(`  ${key}: its rows wait for an open PR's lines or the next PR; read again later, not counted as a try`); }
    else if (outcome === "open failed") log(`  ${key}: its PR couldn't be opened; not counted as a try`);
    else if (outcome === "read failed") log(`  ${key}: the read failed; not counted as a try`);
    else remember(memory, key, outcome === "shipped" ? 1 : 0, outcome === "too big" ? "rows too big for one PR (the owner's)" : outcome === "shipped" ? "shipped" : changed ? "rows refused or unchanged" : "no new rows");
  }
  return opened;
}

// --- 3b. Lanes: what each read is collected and shipped, and its next job sent ------------------------------------------
// A lane holds no credentials and this computer does, so nothing a lane writes is taken as it is: its state only picks
// the step (laneStep, against this computer's own job record), and its results are kept to that job's seasons, codes
// and rows (laneResults) before they're checked like any read's.
const LANE_HOME = "control-scout-autopilot";
const laneSsh = (host: string, cmd: string) => sh("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", host, cmd], { timeoutMs: 120_000 });
const rsync = (from: string, to: string, timeoutMs: number) => sh("rsync", ["-a", "-e", "ssh -o BatchMode=yes", from, to], { timeoutMs });
for (const lane of DRY ? [] : LANES) {
  const name = `lane ${lane.k} (${lane.host})`, here = join(DIR, "lanes", String(lane.k)), there = `${LANE_HOME}/.data/lane`;
  try {
    const job = laneJob(lane.k), step = laneStep(laneSsh(lane.host, `cat ${there}/state.json 2>/dev/null || true`).out, job);
    if (step.do === "wait") {
      log(`${name}: ${step.state.state}${step.state.id ? ` job ${step.state.id}` : ""}${step.state.at ? ` since ${step.state.at}` : ""}${step.state.why ? `: ${step.state.why}` : ""}`);
      continue;
    }
    if (step.do === "kick") {
      laneSsh(lane.host, "launchctl kickstart gui/$(id -u)/org.controlscout.clip-lane");
      log(`${name}: job ${job!.id} not started within an hour: started again`);
      continue;
    }
    if (step.do === "reset") {
      // Its state names no job this computer has outstanding there (one collected already, or never sent): nothing of
      // it is read; the lane is set idle for its next job.
      laneSsh(lane.host, `printf '%s' '{"state":"idle"}' > ${there}/state.json`);
      log(`${name}: its state (${step.state.state}${step.state.id ? ` ${step.state.id}` : ""}) names no job sent to it: set idle`);
    }
    if (step.do === "collect") {
      const id = job!.id, local = join(here, id);
      mkdirSync(local, { recursive: true });
      rsync(`${lane.host}:${there}/results/${id}/`, `${local}/`, 600_000);
      // Collected before anything is shipped: the lane is idle and the job record gone first, so a run that fails while
      // shipping never collects (and ships) the same rows again. Events it didn't ship are read again later.
      laneSsh(lane.host, `cd ${there} && rm -rf results/${id} && printf '%s' '{"state":"idle"}' > state.json`);
      rmSync(laneJobFile(lane.k), { force: true });
      if (step.state.state === "failed") log(`${name}: job ${id} failed (${step.state.why ?? "no reason given"}); what it finished is shipped, the rest read again, not counted as tried`);
      const files = readdirSync(local).filter((x) => x.endsWith(".json")).map((x) => ({ name: x, text: readFileSync(join(local, x), "utf8") }));
      for (const r of laneResults(job!, files)) {
        log(`${name}: collected ${r.season} ${r.codes.join(",")}: ${r.changed.length} rows changed${r.readFailed ? ", a read failed" : ""}`);
        if (!existsSync(seasonFile(r.season))) { log(`  ${r.season}: no ${seasonFile(r.season)} here; left`); continue; }
        try {
          for (const row of await settle(r.season, r.codes, r)) inPr.add(`${r.season}/${row.code}`);
        } catch (e) { log(`  ${r.season}: couldn't be shipped (${(e as Error).message}); its events are read again later`); }
      }
    }
    // Idle: its next job, from its own shard (what this computer remembers of each event, and the held set, as its own).
    const { picked: next } = pickEvents(inShard(lane.k), inPr, memory, MAX);
    if (!next.length) { log(`${name}: nothing in its shard to read`); continue; }
    const job2: LaneJob = { id: STAMP, seasons: [...new Set(next.map((q) => q.season))].map((season) => ({ season, codes: next.filter((q) => q.season === season).map((q) => q.code) })) };
    mkdirSync(here, { recursive: true });
    const sending = join(here, "job.sending.json");
    writeFileSync(sending, JSON.stringify(job2));
    try {
      // The snapshot goes gzipped when this run took one (a fifth of the size); the lane unpacks it.
      const gz = join(DIR, "snapshot.db.gz"), send = !DB && existsSync(gz) ? gz : snapshot;
      laneSsh(lane.host, `mkdir -p ${there} && rm -f ${there}/snapshot.db ${there}/snapshot.db.gz`);
      rsync(send, `${lane.host}:${there}/${send.endsWith(".gz") ? "snapshot.db.gz" : "snapshot.db"}`, 1_800_000);
      rsync(sending, `${lane.host}:${there}/job.json`, 120_000);
      laneSsh(lane.host, `printf '%s' '${JSON.stringify({ state: "queued", id: job2.id, at: new Date().toISOString() })}' > ${there}/state.json`);
      // Sent: only now is it this computer's record (its events held until collected).
      writeFileSync(laneJobFile(lane.k), JSON.stringify(job2));
    } finally { rmSync(sending, { force: true }); }
    for (const q of next) inPr.add(`${q.season}/${q.code}`);
    laneSsh(lane.host, "launchctl kickstart gui/$(id -u)/org.controlscout.clip-lane");
    log(`${name}: sent job ${job2.id}: ${next.map((q) => `${q.season}/${q.code} (${q.frames.due})`).join(", ")}`);
  } catch (e) { log(`${name}: ${(e as Error).message}; tried again next run`); }
}

// --- 4–6. This computer's own: read the due events, check, ship, season by season ---------------------------------------
const bySeason = new Map<number, typeof picked>();
for (const q of picked) (bySeason.get(q.season) ?? bySeason.set(q.season, []).get(q.season)!).push(q);
for (const [season, events] of bySeason) {
  const file = seasonFile(season);
  if (!existsSync(file)) { log(`${season}: no ${file} to write (add the season's file first)`); continue; }
  const codes = events.map((e) => e.code);
  await settle(season, codes, await readSeason(season, codes));
}

// --- 7. The live clips the clock places, checked by their first frame --------------------------------------------------------
// Each clip the live site plays from the clock is read paused at its first second (video-frames.ts --clips): its own
// match there, ok; another match, pulled (never served); nothing, left as it is and read again next sweep. Up to
// --sweep events a run, newest season first; events whose clips are all checked are passed over without a read.
// Shard 0 alone sweeps (the sweep picks its own events, season by season): two computers would check the same clips.
if (SWEEP && SHARD.k === 0 && !open.some((p) => p.file === CLIPS_FILE)) {
  const before = readFileSync(CLIPS_FILE, "utf8");
  restore.set(CLIPS_FILE, before);
  let budget = SWEEP;
  const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
  for (const season of seasons) {
    if (budget <= 0) break;
    if (!existsSync(seasonFile(season))) continue;
    const r = await reader(["scripts/video-frames.ts", "--season", String(season), "--clips", "--limit", String(budget), "--lanes", "2"], 4 * 3600_000);
    const checked = (r.out.match(/^\S+: \d+ clock clips to check by their first frame$/gm) ?? []).length;
    log(`${season} sweep: ${checked} events checked, exit ${r.code}`);
    budget -= checked;
    // A sweep read that failed (a blocked or crashed player, the timeout) would fail the same way for every season:
    // the sweep stops here, the next run tries again.
    if (r.code) { log("sweep stopped: its read failed"); break; }
  }
  const after = readFileSync(CLIPS_FILE, "utf8");
  writeFileSync(CLIPS_FILE, before);
  const live = new Map(fileRows<ClipCheck>(mainText(CLIPS_FILE)).map((c) => [rowKey(c), c]));
  const good: ClipCheck[] = [];
  for (const c of changedRows<ClipCheck>(before, after)) {
    const problems = clipCheckProblems(c, live.get(rowKey(c)));
    if (problems.length) log(`  ${c.season} ${c.code} ${c.videoId}: left out, ${problems.join("; ")}`); else good.push(c);
  }
  // The sweep runs only with no sweep PR open, so nothing is held; what overflows is swept again next run.
  const { ship, later, tooBig } = prChunks(mainText(CLIPS_FILE), good, PR_DIFF_MAX);
  for (const c of tooBig) log(`  ${c.season} ${c.code} ${c.videoId}: its diff alone is too big for one PR Loopy can review; left for the owner`);
  ship.forEach((chunk, i) => openPr({ file: CLIPS_FILE, rows: chunk, branch: `${BRANCH}clips-${branchStamp}-${chunk[0].code}-${i + 1}`, ...clipsText(chunk, live) }));
  if (later.length) log(`sweep: ${later.length} rows wait for the next run (one PR into the same lines at a time)`);
}
if (stoppedAtLimit.length) log(`stopped at the reader's per-event limit with no new row (look at these by hand): ${stoppedAtLimit.join("; ")}`);
log("done");
