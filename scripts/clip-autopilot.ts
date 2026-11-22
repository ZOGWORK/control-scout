// The clip autopilot: reads the frames of every recording the frame-read queue says is due, with nobody running the
// reader by hand, and hands what it reads to the live server, which puts it on the site at once or holds it for the
// owner's approval (docs/clip-autopilot.md). No PR, no review, no deploy.
//
// YouTube refuses data-centre addresses (GitHub's runners and the VM both get its "confirm you're not a bot" page), so
// this runs on a computer at home, from a clone of its own, on a schedule (scripts/clip-autopilot-task.ps1). Each run:
//   1. (its start, scripts/clip-autopilot-start.mjs: one run at a time, the clone and its dependencies at main);
//   2. takes a read-only snapshot of the live database (VACUUM INTO over ssh: the VM's database is never written);
//   3. lays the rows the live server serves from its database (auto_reads, server/videos/autoReads.ts) over main's
//      season files and clip checks, so what's live counts as read; takes the queue from that (server/videos/
//      frameQueue.ts), most missing first;
//   4. reads each picked event with scripts/video-frames.ts (--live: what's live), then --verify, then --bounds, then
//      --recheck (a second look at its review entries: scripts/lib/reviewRecheck.ts); an event queued only for that
//      second look (frameQueue's `recheck`) isn't read again, only looked at again;
//   5. checks every row it changed (server/data/frameRowRules.ts, the rules the server keeps too): a row whose video
//      showed the reader nothing is a failed read, never handed over; the rest are logged with their problems;
//   6. hands the rows to the live server: one JSON file per season in its inbox on the VM (over ssh, written whole then
//      renamed in). The server checks each row against what it serves: one that keeps every rule goes live at once, one
//      that breaks any waits for the owner in Owner › Clip coverage (Waiting for approval: Approve or Reject);
//   7. sweeps the live clips the clock places (video-frames.ts --clips): each read paused at its first second, pulled
//      only where that frame names another match, confirmed where it names its own, left as it is where it names none;
//      handed to the server the same way (server/data/clipChecks.ts rows).
//
//   node scripts/clip-autopilot-start.mjs [--max 12] [--sweep 4] [--db snapshot.db]   (a real run)
//   npx tsx scripts/clip-autopilot.ts --dry [--max 1] [--sweep 0] [--db snapshot.db]  (a dry run, any checkout)
//   --max N   events read per run (default 12)
//   --sweep N events whose clock clips are checked per run (default 4; 0: no sweep)
//   --db F    read this snapshot instead of taking one
//   --shard K/N  this computer's shard of the queue (default 0/1, all of it): several computers each read only the
//             events in their own shard (shardOf), and only shard 0 sweeps, so no two read the same event
//   --lanes K=user@host,…  computers with no credentials reading shard K for this one (their runs: --lane): each run
//             collects what a lane read (checked and handed over here, as this computer's own reads) and sends it its
//             next job, a copy of the snapshot and the events to read, over ssh
//   --lane    a lane's run: reads the job its coordinator left in .data/lane (no gh, no VM), its rows and whether each
//             read stopped or failed left there to collect
//   --dry     in the current checkout: read and check, print what it would hand the server, leave the files as they were
//   --no-merge  accepted and ignored (nothing is merged any more)
//   AUTOPILOT_SSH (ubuntu@132.145.202.89), AUTOPILOT_SSH_KEY (~/.ssh/oracle-controlpoint), TESSERACT_JS: passed on.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { applyRows, changedRows, fileRows, rowKey, rowProblems, type Keyed, type Row } from "./lib/autopilotRows";
import { forgetSettled, recheckOnly, laneJobMs, laneResults, readCallMs, laneStep, nothingRead, overLimit, parseLanes, parseShard, parseSkip, pickEvents, readOutcome, remember, rememberTimeout, rememberWait, shardOf, type LaneJob, type Memory, frameFileSeason, heldElsewhere, holdCodes } from "./lib/autopilotRun";
import { clipCheckProblems } from "./lib/autopilotClips";
import { streamRun } from "./lib/streamRun";
import { eventLimitMs, readFailed as readFailedExit } from "./lib/videoFrames";
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
for (const a of argv) if (a.startsWith("--") && !["--max", "--sweep", "--db", "--shard", "--lanes", "--lane", "--dry", "--no-merge"].includes(a)) { console.error(`${a}: not a flag (--max N, --sweep N, --db F, --shard K/N, --lanes K=user@host,…, --lane, --dry)`); process.exit(2); }
const MAX = Number(opt("max") ?? 12), SWEEP = Number(opt("sweep") ?? 4), DRY = argv.includes("--dry"), DB = opt("db");
if (!Number.isInteger(MAX) || MAX < 1) { console.error("--max: a whole number, 1 or more"); process.exit(2); }
if (!Number.isInteger(SWEEP) || SWEEP < 0) { console.error("--sweep: a whole number, 0 or more"); process.exit(2); }
const SHARD = parseShard(opt("shard"));
if (!SHARD) { console.error("--shard: K/N, 0 <= K < N (this computer's shard of N)"); process.exit(2); }
const LANES = parseLanes(opt("lanes"), SHARD), LANE = argv.includes("--lane");
if (typeof LANES === "string") { console.error(`--lanes: ${LANES}`); process.exit(2); }
if (LANE && (LANES.length || DRY || DB)) { console.error("--lane: a lane reads only the job it was sent (no --lanes, --dry or --db)"); process.exit(2); }

const DIR = ".data/autopilot", STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
/** Reader lanes (a browser and OCR each) per read call: the start sets AUTOPILOT_LANES by the memory free (3 over 6 GB,
 *  else 2). Not the coordinator's --lanes (other computers' lanes).
 *  Declared up here: a lane's run (if (LANE), below) reads (readSeason) before the rest of the file runs. */
const READER_LANES = /^[1-4]$/.test(process.env.AUTOPILOT_LANES ?? "") ? process.env.AUTOPILOT_LANES! : "2";
mkdirSync(join(DIR, "runs"), { recursive: true });
const LOG = join(DIR, "runs", `${STAMP}.log`);
const log = (s: string) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); appendFileSync(LOG, `${line}\n`); };
const seasonFile = (season: number) => `server/data/frameTimings/${season}.ts`;
/** The first-frame sweep's rows (one per video and event). */
const CLIPS_FILE = "server/data/clipChecks.ts";
/** The VM, over ssh: its snapshot, and the inbox the live server reads each delivery from (server/videos/autoReads.ts). */
const VM_HOST = process.env.AUTOPILOT_SSH ?? "ubuntu@132.145.202.89", VM_KEY = process.env.AUTOPILOT_SSH_KEY ?? join(homedir(), ".ssh", "oracle-controlpoint");
const VM_SSH = ["-o", "BatchMode=yes", "-i", VM_KEY];
const VM_INBOX = "/opt/control-scout/shared/data/auto-reads-inbox";

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
/** Files a read (or the live rows laid over main's) may have written, as they were before: put back however the run
 *  ends. The first copy kept is the one put back. */
const restore = new Map<string, string>();
const keepFile = (file: string) => { if (!restore.has(file)) restore.set(file, readFileSync(file, "utf8")); };
// However the run ends (done, stopped, or thrown): what it tried keeps its retry and give-up counts, and every file a
// read wrote is put back, so the clone is never left with changes.
process.on("exit", () => {
  // A dry run hands nothing over: what it "would hand over" or didn't find never counts toward the real runs' retries.
  if (!DRY) writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 1));
  for (const [file, text] of restore) writeFileSync(file, text);
});

const mainText = (path: string) => (DRY ? readFileSync(path, "utf8") : git("show", `origin/main:${path}`) + "\n");

// --- What's live: main's files with the live server's database rows laid over them --------------------------------------
// The server serves the autopilot's reads from its database (auto_reads), over the code's rows: a database row wins
// unless the code's row of the same video and event was read later (dbRowWins). Laid the same way over main's files here
// (and in memory: loadAutoReads), so the queue, the reader's --live rows and the checks all see what the site serves:
// an event whose rows live only in the database isn't read again. The files are put back when the run ends (restore).
/** Each file as the site serves it (main's, with the database's live rows laid over), once laid. */
const liveTexts = new Map<string, string>();
const liveText = (path: string) => liveTexts.get(path) ?? mainText(path);
/** Lays the snapshot's live rows over main's season files and clip checks (in memory and on disk, for the reader).
 *  Declared up here: a lane's run (if (LANE), below) reads before the rest of the file runs. */
async function layLiveRows(): Promise<void> {
  const { autoLiveRows, loadAutoReads } = await import("../server/videos/autoReads.js");
  const { dbRowWins } = await import("../server/data/frameTimings.js");
  try { await loadAutoReads(); } catch (e) { log(`the snapshot's live rows couldn't be loaded (${(e as Error).message}): main's files alone`); }
  const frames = await autoLiveRows("frames"), clips = await autoLiveRows("clips");
  const lay = <T extends Keyed & { checked: string }>(file: string, rows: T[]): number => {
    const text = mainText(file), code = new Map(fileRows<T>(text).map((r) => [rowKey(r), r]));
    const win = rows.filter((r) => dbRowWins(code.get(rowKey(r)), r)), laid = applyRows(text, win);
    liveTexts.set(file, laid);
    if (readFileSync(file, "utf8") !== laid) { keepFile(file); writeFileSync(file, laid); }
    return win.length;
  };
  const seasons = readdirSync("server/data/frameTimings").flatMap((f) => (/^\d{4}\.ts$/.test(f) ? [Number(f.slice(0, 4))] : []));
  let n = 0;
  for (const season of seasons) n += lay(seasonFile(season), frames.filter((f) => f.season === season).map((f) => f.row));
  const lost = frames.filter((f) => !seasons.includes(f.season)).length;
  const m = lay(CLIPS_FILE, clips.map((c) => c.row));
  log(`live rows from the server's database laid over main's files: ${n} frame-read rows, ${m} clip checks${lost ? ` (${lost} of seasons with no file here, left out)` : ""}`);
}

/** Events other open PRs (another session's) bring frame-read rows for: held, so a read handed to the server never
 *  races a PR carrying the same event (heldElsewhere). Read when the queue is picked, and again just before a read is
 *  handed over, as a read takes hours and another PR may have opened meanwhile. A file GitHub shows no patch for (too
 *  big) is read at the PR's head and its rows compared with main's. Whatever can't be read (the list, one PR, one file) is logged, and
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
  const prs: { number: number; files: { filename: string; patch?: string }[] }[] = [];
  for (const p of list.filter((x) => (x.files ?? []).some((f) => frameFileSeason(f.path) != null))) {
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

// --- A lane: reads the job its coordinator sent, for it to collect --------------------------------------------------------
// No gh, no VM key: the job's snapshot, its events read (readSeason) over what's live in it (layLiveRows), and per season
// the rows the read changed, whether a read failed and the events stopped at their limit, left in
// .data/lane/results/<job> with the run's log. The coordinator checks and hands them over as its own reads (settle) on
// its next run.
const LANE_DIR = join(".data", "lane"), LANE_STATE = join(LANE_DIR, "state.json");
if (LANE) {
  const state = existsSync(LANE_STATE) ? JSON.parse(readFileSync(LANE_STATE, "utf8")) : { state: "idle" };
  const job = existsSync(join(LANE_DIR, "job.json")) ? JSON.parse(readFileSync(join(LANE_DIR, "job.json"), "utf8")) as LaneJob : null;
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
  await layLiveRows();
  log(`lane: job ${job.id}: ${job.seasons.map((x) => `${x.season} ${x.codes.join(",")}`).join("; ")}`);
  for (const { season, codes, recheck } of job.seasons) {
    const r = existsSync(seasonFile(season)) ? await readSeason(season, codes, new Set(recheck ?? [])) : { changed: [], readFailed: true, stopped: new Map() };
    writeFileSync(join(out, `${season}.json`), JSON.stringify({ season, codes, changed: r.changed, readFailed: r.readFailed, stopped: [...r.stopped] }));
    log(`lane: ${season}: ${r.changed.length} rows changed${r.readFailed ? ", a read failed" : ""}`);
  }
  copyFileSync(LOG, join(out, "run.log"));
  finished = true;
  writeFileSync(LANE_STATE, JSON.stringify({ state: "done", id: job.id, at: at() }));
  log("lane: done, for its coordinator to collect");
  process.exit(0);
}

// --- 2. A snapshot of the live database ---------------------------------------------------------------------------------
let snapshot = DB;
if (!snapshot) {
  const host = VM_HOST, ssh = VM_SSH, remote = `/tmp/autopilot-${STAMP}.db`;
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

// --- 3. What's live, and the queue -------------------------------------------------------------------------------------
const { migrate, all } = await import("../server/db.js");
await migrate();
await layLiveRows();
const { frameQueue } = await import("../server/videos/frameQueue.js");
const queue = await frameQueue();
/** Events held from this run's reads: in a job sent to a lane and not collected yet, in another session's open PR, or
 *  left by hand to another session (skip.txt). */
const inPr = new Set<string>();
// This computer's shard of it: the other computers read the rest.
const inShard = (k: number) => (SHARD.n > 1 ? queue.filter((q) => shardOf(`${q.season}/${q.code}`, SHARD.n) === k) : queue);
const mine = inShard(SHARD.k);
// What it remembers covers its lanes' events too: forgotten only once an event leaves the whole queue.
forgetSettled(memory, new Set(queue.filter((q) => q.frames.state === "queued").map((q) => `${q.season}/${q.code}`)));
// Events in a job sent to a lane and not collected yet are read there: held. The job file here is
// this computer's own record of what it sent (written once the send succeeded, removed once its results are in).
const laneJobFile = (k: number) => join(DIR, "lanes", String(k), "job.json");
const laneJob = (k: number): LaneJob | null => { try { return JSON.parse(readFileSync(laneJobFile(k), "utf8")); } catch { return null; } };
for (const lane of LANES) for (const x of laneJob(lane.k)?.seasons ?? []) for (const c of x.codes) inPr.add(`${x.season}/${c}`);
// And events another session's open data PR already carries: never read to race it.
const elsewhere = othersHold();
for (const [k, n] of elsewhere) if (!inPr.has(k)) { inPr.add(k); log(`  held: ${k} is in #${n}, another open PR`); }
// And events left by hand to a session reading them with no PR open yet (skip.txt: parseSkip).
const skipFile = join(DIR, "skip.txt");
for (const k of existsSync(skipFile) ? parseSkip(readFileSync(skipFile, "utf8")) : []) if (!inPr.has(k)) { inPr.add(k); log(`  held: ${k} is in ${skipFile}, left to another session`); }
const { picked, skipped } = pickEvents(mine, inPr, memory, MAX);
log(`queue: ${queue.filter((q) => q.frames.state === "queued").length} events queued${SHARD.n > 1 ? `, ${mine.filter((q) => q.frames.state === "queued").length} in shard ${SHARD.k}/${SHARD.n}` : ""}; reading ${picked.map((q) => `${q.season}/${q.code} (${q.frames.due})`).join(", ") || "none"}`);
for (const s of skipped.filter((x) => x.why !== "next run")) log(`  skipped ${s.event}: ${s.why}`);

// --- Handing the server what was read --------------------------------------------------------------------------------------
/** One delivery file at most this big (the server reads up to 8 MB): more rows go in several. */
const DELIVERY_MAX = 4 << 20;
const SOURCE = `${hostname().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40)} ${STAMP}`;
let deliveries = 0;
/** Hands `rows` to the live server: one JSON file a delivery ({ kind, season, rows, source }) written whole to a dot-file
 *  in its inbox as the app's own user, then renamed in, so the server never reads half a file. The server checks every
 *  row (server/videos/autoReads.ts): live at once, or held for the owner's approval. False (logged) when it couldn't be
 *  sent: the rows are read again on a later run. --dry: says what it would send. */
function deliver(kind: "frames" | "clips", season: number, rows: Keyed[]): boolean {
  if (!rows.length) return true;
  if (DRY) { log(`would hand the server ${rows.length} ${kind} row${rows.length === 1 ? "" : "s"} of ${season}: ${rows.map(rowKey).join(" ")}`); return true; }
  // Split where one file would be too big: rows whole, in order.
  const parts: Keyed[][] = [[]];
  let size = 0;
  for (const r of rows) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (parts.at(-1)!.length && size + n > DELIVERY_MAX) { parts.push([]); size = 0; }
    parts.at(-1)!.push(r);
    size += n;
  }
  for (const part of parts) {
    const name = `${STAMP}-${SOURCE.split(" ")[0]}-${kind}-${season}-${++deliveries}`;
    // Fixed words only in the command (the name is made of the stamp, the host's letters and numbers); the rows go on stdin.
    const cmd = `sudo -u controlscout sh -c 'mkdir -p ${VM_INBOX} && cat > ${VM_INBOX}/.${name}.tmp && mv ${VM_INBOX}/.${name}.tmp ${VM_INBOX}/${name}.json'`;
    const r = sh("ssh", [...VM_SSH, VM_HOST, cmd], { ok: true, quiet: true, timeoutMs: 300_000, input: JSON.stringify({ kind, season, rows: part, source: SOURCE }) });
    if (r.code) { log(`  ${season} ${kind}: ${part.length} rows couldn't be handed to the server (ssh exit ${r.code}); read again on a later run`); return false; }
    log(`  ${season} ${kind}: ${part.length} row${part.length === 1 ? "" : "s"} handed to the server (${name}.json): each goes live, or waits for the owner's approval`);
  }
  return true;
}

/** The frame reader. A read whose frames came up near-black (a player showing no picture) wrote nothing; the run stops
 *  there, every file put back as it was, and hands nothing over: rows read off a black player would all say "no frame
 *  read". */
async function reader(args: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  const r = await tsx(args, timeoutMs);
  const dark = r.out.split("\n").find((l) => l.startsWith("NEAR-BLACK FRAMES"));
  if (dark) {
    // The exit puts every file back (restore).
    log(`stopped: ${dark}. The video player shows no picture; nothing read, nothing handed over. Fix the reader, then run again.`);
    process.exit(3);
  }
  return r;
}

/** Events the reader stopped at its per-event limit with no new row this run: listed in the run's summary. */
const stoppedAtLimit: string[] = [];

// --- 4–6. Read the due events, check, hand over, season by season -------------------------------------------------------------
/** Each event's read limit in `season`, as the reader works it out (eventLimitMs on its playable videos' lengths, the
 *  reader's default 180 min floor). The season's recordings can't be read: none (each call's backstop is then a day). */
async function eventLimits(season: number): Promise<Map<string, number>> {
  try {
    const { seasonRecordings } = await import("../server/videos/recordings.js");
    const out = new Map<string, number>();
    for (const [code, rec] of await seasonRecordings(season)) {
      out.set(code, eventLimitMs(180 * 60_000, [rec, ...(rec.more ?? [])].flatMap((v) => (v.meta?.status === "ok" && v.meta.length ? [v.meta.length] : []))));
    }
    return out;
  } catch (e) {
    log(`${season}: its recordings couldn't be read for the read calls' limits (${(e as Error).message}); a day each`);
    return new Map();
  }
}
/** Reads `codes` of `season` into its file (those not read yet, then those with rows already whole, then --verify,
 *  --bounds and --recheck), and puts the file back: the rows the read changed, whether a read failed, and the events the
 *  reader stopped at its per-event limit (and the video each was on). `recheckOnly`: codes queued only for the second
 *  look at their review entries, never read again whole for it. This computer's reads and a lane's alike. */
async function readSeason(season: number, codes: string[], recheckOnly: ReadonlySet<string> = new Set()): Promise<{ changed: Row[]; readFailed: boolean; stopped: Map<string, string | undefined> }> {
  const file = seasonFile(season);
  // The file as the site serves it (layLiveRows laid the database's rows over main's): what the reader adds to.
  const before = readFileSync(file, "utf8"), liveFile = join(DIR, `live-${season}.ts`);
  writeFileSync(liveFile, liveText(file));
  keepFile(file);
  // An event with rows already (read before it finished, or one of its videos read) is read again whole (--all): the
  // reader otherwise skips an event whose videos all have rows. The others read what isn't read yet.
  const hasRows = new Set(fileRows(before).map((r) => r.code));
  const reading = codes.filter((c) => !recheckOnly.has(c));
  const again = reading.filter((c) => hasRows.has(c)), fresh = reading.filter((c) => !hasRows.has(c));
  // --live keeps the clips the site plays from being dropped on a frame that names nothing; a season with no rows yet
  // has none to keep (and the reader refuses an empty --live file).
  const base = ["scripts/video-frames.ts", "--season", String(season), ...(fileRows(liveText(file)).length ? ["--live", liveFile] : []), "--lanes", READER_LANES];
  // A read that crashed, timed out or was killed read nothing for sure: its events aren't counted as tried (remember).
  // The reader's UNDETAILED_EXIT (an event left unread for want of details a fetch would give) isn't one: it read the
  // rest, so the season's events are remembered as usual instead of re-picked every run (readFailedExit).
  let readFailed = false;
  // Events the reader stopped at its per-event limit, and the video each was on (overLimit).
  const stopped = new Map<string, string | undefined>();
  const pass = async (args: string[], ms: number, what: string) => {
    const r = await reader([...base, ...args], ms);
    if (readFailedExit(r.code)) readFailed = true;
    for (const [c, v] of overLimit(r.err)) stopped.set(c, v);
    log(`${season} ${what}: exit ${r.code}`);
  };
  // A read call's own limit is only a backstop: each event has its own, as long as its videos (the reader's
  // eventLimitMs, 3 h at least). This one is a day, or the sum of its events' limits and an hour when that's more
  // (readCallMs), so it never cuts an event before the event's own limit does.
  const limits = await eventLimits(season);
  for (const [list, extra] of [[fresh, []], [again, ["--all"]]] as const) if (list.length) await pass(["--codes", list.join(","), ...extra], readCallMs(list.map((c) => limits.get(c) ?? 0)), `read ${list.join(",")}`);
  for (const p of ["--verify", "--bounds", "--recheck"]) await pass(["--codes", codes.join(","), p], 3 * 3600_000, p);
  const after = readFileSync(file, "utf8");
  writeFileSync(file, before);
  return { changed: changedRows(before, after).filter((x) => codes.includes(x.code)), readFailed, stopped };
}

/** Checks the rows a read of `codes` changed against what's live, hands them to the server, and remembers what became of
 *  each event (remember, rememberWait, rememberTimeout): this computer's reads and its lanes' alike. The rows handed over. */
async function settle(season: number, codes: string[], read: { changed: Row[]; readFailed: boolean; stopped: Map<string, string | undefined> }): Promise<Row[]> {
  const file = seasonFile(season);
  const live = new Map(fileRows(liveText(file)).map((r) => [rowKey(r), r]));
  // Each event's played matches in the order they were played: the server's own list (playedOrder), on the snapshot.
  const { playedOrder } = await import("../server/videos/autoReads.js");
  const order = await playedOrder(season, codes);
  const send: Row[] = [], clean: Row[] = [], heldOther: Row[] = [], blind: Row[] = [];
  // An event another PR took up while this one was read waits for it: no read handed over to race it.
  const other = othersHold();
  // Each read keeps the starts the owner approved on the live row (carryApproved: the server does the same).
  const { carryApproved } = await import("../server/data/frameRowRules.js");
  for (const r of read.changed.map((x) => carryApproved(x, live.get(rowKey(x))))) {
    const held = other.get(`${season}/${r.code}`);
    // The player showed nothing, or the video couldn't be played (nothingRead): a failed read, never a row that marks
    // every match read. The server refuses it too.
    if (nothingRead(r)) { blind.push(r); log(`  ${r.code} ${r.videoId}: left out, no frame of the video could be read (the player showed nothing, or the video couldn't be played): a failed read, the event read again later`); continue; }
    if (held != null) { heldOther.push(r); log(`  ${r.code} ${r.videoId}: waits, #${held} (another open PR) carries ${r.code}`); continue; }
    const problems = rowProblems(r, live.get(rowKey(r)), order.get(r.code));
    send.push(r);
    if (problems.length) log(`  ${r.code} ${r.videoId}: for the owner's approval, ${problems.join("; ")}`); else clean.push(r);
  }
  const sent = deliver("frames", season, send);
  const count = (list: Row[], code: string) => list.filter((r) => r.code === code).length;
  for (const code of codes) {
    const key = `${season}/${code}`, changed = count(read.changed, code);
    if (!sent && count(send, code)) { log(`  ${key}: its rows couldn't be handed to the server; not counted as a try`); continue; }
    // A video the player showed nothing of is a failed read for its event (when nothing else of it went over or waits).
    const outcome = readOutcome({ rows: count(clean, code), opened: count(clean, code), waiting: count(heldOther, code), tooBig: 0, readFailed: read.readFailed || count(blind, code) > 0, timedOut: read.stopped.has(code), changed });
    if (outcome === "timed out") {
      const video = read.stopped.get(code), counted = rememberTimeout(memory, key, video) === "counted";
      stoppedAtLimit.push(`${key}${video ? ` (video ${video})` : ""}${counted ? ": nothing new again, counted as a try" : ""}`);
      log(`  ${key}: stopped at the reader's per-event limit with no new row${video ? ` on video ${video}` : ""}; ${counted ? "the second run in a row: counted as a try (read again after 3 days, left after 3 tries)" : "read again after 6 h, not counted as a try"}`);
    }
    else if (outcome === "waits") { rememberWait(memory, key, "rows wait for another open PR"); log(`  ${key}: its rows wait for another open PR; read again later, not counted as a try`); }
    else if (outcome === "read failed") log(`  ${key}: the read failed; not counted as a try`);
    // Rows that went live clear what's remembered; rows held for the owner count a try (read again after 3 days), so an
    // event waiting on the owner isn't read again every run.
    else remember(memory, key, outcome === "shipped" ? 1 : 0, outcome === "shipped" ? "live" : count(send, code) ? "rows wait for the owner's approval" : changed ? "rows unchanged" : "no new rows");
  }
  return sent ? send : [];
}

// --- 3b. Lanes: what each read is collected and handed over, and its next job sent -------------------------------------
// A lane holds no credentials and this computer does, so nothing a lane writes is taken as it is: its state only picks
// the step (laneStep, against this computer's own job record), and its results are kept to that job's seasons, codes
// and rows (laneResults) before they're checked like any read's.
const LANE_HOME = "control-scout-autopilot";
const laneSsh = (host: string, cmd: string) => sh("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", host, cmd], { timeoutMs: 120_000 });
const rsync = (from: string, to: string, timeoutMs: number) => sh("rsync", ["-a", "-e", "ssh -o BatchMode=yes", from, to], { timeoutMs });
for (const lane of DRY ? [] : LANES) {
  const name = `lane ${lane.k} (${lane.host})`, here = join(DIR, "lanes", String(lane.k)), there = `${LANE_HOME}/.data/lane`;
  try {
    const job = laneJob(lane.k);
    // How long its job may run before it's called killed: from its events' own limits (eventLimits), as the lane reads them.
    const limits = new Map<number, Map<string, number>>();
    for (const x of job?.seasons ?? []) limits.set(x.season, await eventLimits(x.season));
    const step = laneStep(laneSsh(lane.host, `cat ${there}/state.json 2>/dev/null || true`).out, job, Date.now(), job ? laneJobMs(job, (season, code) => limits.get(season)?.get(code) ?? 0) : 0);
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
      // Collected before anything is handed over: the lane is idle and the job record gone first, so a run that fails
      // while handing over never collects (and sends) the same rows again. Events it didn't send are read again later.
      laneSsh(lane.host, `cd ${there} && rm -rf results/${id} && printf '%s' '{"state":"idle"}' > state.json`);
      rmSync(laneJobFile(lane.k), { force: true });
      if (step.state.state === "failed") log(`${name}: job ${id} failed (${step.state.why ?? "no reason given"}); what it finished is handed over, the rest read again, not counted as tried`);
      const files = readdirSync(local).filter((x) => x.endsWith(".json")).map((x) => ({ name: x, text: readFileSync(join(local, x), "utf8") }));
      for (const r of laneResults(job!, files)) {
        log(`${name}: collected ${r.season} ${r.codes.join(",")}: ${r.changed.length} rows changed${r.readFailed ? ", a read failed" : ""}`);
        if (!existsSync(seasonFile(r.season))) { log(`  ${r.season}: no ${seasonFile(r.season)} here; left`); continue; }
        try {
          for (const row of await settle(r.season, r.codes, r)) inPr.add(`${r.season}/${row.code}`);
        } catch (e) { log(`  ${r.season}: couldn't be handed over (${(e as Error).message}); its events are read again later`); }
      }
    }
    // Idle: its next job, from its own shard (what this computer remembers of each event, and the held set, as its own).
    const { picked: next } = pickEvents(inShard(lane.k), inPr, memory, MAX);
    if (!next.length) { log(`${name}: nothing in its shard to read`); continue; }
    const job2: LaneJob = { id: STAMP, seasons: [...new Set(next.map((q) => q.season))].map((season) => {
      const mine = next.filter((q) => q.season === season), recheck = mine.filter(recheckOnly).map((q) => q.code);
      return { season, codes: mine.map((q) => q.code), ...(recheck.length ? { recheck } : {}) };
    }) };
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

// --- 4–6. This computer's own: read the due events, check, hand over, season by season ----------------------------------
const bySeason = new Map<number, typeof picked>();
for (const q of picked) (bySeason.get(q.season) ?? bySeason.set(q.season, []).get(q.season)!).push(q);
for (const [season, events] of bySeason) {
  const file = seasonFile(season);
  if (!existsSync(file)) { log(`${season}: no ${file} to write (add the season's file first)`); continue; }
  const codes = events.map((e) => e.code);
  await settle(season, codes, await readSeason(season, codes, new Set(events.filter(recheckOnly).map((e) => e.code))));
}

// --- 7. The live clips the clock places, checked by their first frame --------------------------------------------------------
// Each clip the live site plays from the clock is read paused at its first second (video-frames.ts --clips): its own
// match there, ok; another match, pulled (never served); nothing, left as it is and read again next sweep. Up to
// --sweep events a run, newest season first; events whose clips are all checked are passed over without a read.
// Shard 0 alone sweeps (the sweep picks its own events, season by season): two computers would check the same clips.
if (SWEEP && SHARD.k === 0) {
  // The file as the site serves it (layLiveRows), so checks already live aren't swept again.
  const before = readFileSync(CLIPS_FILE, "utf8");
  keepFile(CLIPS_FILE);
  let budget = SWEEP;
  const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
  for (const season of seasons) {
    if (budget <= 0) break;
    if (!existsSync(seasonFile(season))) continue;
    const r = await reader(["scripts/video-frames.ts", "--season", String(season), "--clips", "--limit", String(budget), "--lanes", READER_LANES], 4 * 3600_000);
    const checked = (r.out.match(/^\S+: \d+ clock clips to check by their first frame$/gm) ?? []).length;
    log(`${season} sweep: ${checked} events checked, exit ${r.code}`);
    budget -= checked;
    // A sweep read that failed (a blocked or crashed player, the timeout) would fail the same way for every season:
    // the sweep stops here, the next run tries again.
    if (r.code) { log("sweep stopped: its read failed"); break; }
  }
  const after = readFileSync(CLIPS_FILE, "utf8");
  writeFileSync(CLIPS_FILE, before);
  const live = new Map(fileRows<ClipCheck>(liveText(CLIPS_FILE)).map((c) => [rowKey(c), c]));
  const bySeason = new Map<number, ClipCheck[]>();
  for (const c of changedRows<ClipCheck>(before, after)) {
    const problems = clipCheckProblems(c, live.get(rowKey(c)));
    if (problems.length) log(`  ${c.season} ${c.code} ${c.videoId}: for the owner's approval, ${problems.join("; ")}`);
    (bySeason.get(c.season) ?? bySeason.set(c.season, []).get(c.season)!).push(c);
  }
  // Handed over season by season; a sweep that couldn't be sent is swept again on a later run.
  for (const [season, rows] of bySeason) deliver("clips", season, rows);
}
if (stoppedAtLimit.length) log(`stopped at the reader's per-event limit with no new row (look at these by hand): ${stoppedAtLimit.join("; ")}`);
log("done");
