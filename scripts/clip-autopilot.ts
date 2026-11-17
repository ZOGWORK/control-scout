// The clip autopilot: reads the frames of every recording the frame-read queue says is due, with nobody running the
// reader by hand, and ships what it reads as data PRs for the usual review (docs/clip-autopilot.md).
//
// YouTube refuses data-centre addresses (GitHub's runners and the VM both get its "confirm you're not a bot" page), so
// this runs on a computer at home, from a clone of its own, on a schedule (scripts/clip-autopilot-task.ps1). Each run:
//   1. (its start, scripts/clip-autopilot-start.mjs: one run at a time, the clone and its dependencies at main) rebuilds
//      its own open PRs on main when main moved under them, then merges one of them that passes the merge gate
//      (scripts/lib/autopilotMerge.ts: Loopy 5/5 on its head, every check passed, its rows safe) and waits for it live;
//   2. takes a read-only snapshot of the live database (VACUUM INTO over ssh: the VM's database is never written);
//   3. takes the queue from that snapshot (server/videos/frameQueue.ts), most missing first;
//   4. reads each picked event with scripts/video-frames.ts (--live main's season file), then --verify, then --bounds;
//   5. checks every row it changed (scripts/lib/autopilotRows.ts): a row that breaks a rule is left out, logged;
//   6. opens a data PR per season file, at most 15 KB each, with its CHANGELOG entry, and asks Loopy to review it;
//   7. sweeps the live clips the clock places (video-frames.ts --clips): each read paused at its first second, pulled
//      only where that frame names another match, confirmed where it names its own, left as it is where it names none;
//      shipped as server/data/clipChecks.ts PRs, checked by scripts/lib/autopilotClips.ts.
//
//   node scripts/clip-autopilot-start.mjs [--max 6] [--sweep 4] [--db snapshot.db]   (a real run)
//   npx tsx scripts/clip-autopilot.ts --dry [--max 1] [--sweep 0] [--db snapshot.db]  (a dry run, any checkout)
//   --max N   events read per run (default 6)
//   --sweep N events whose clock clips are checked per run (default 4; 0: no sweep)
//   --db F    read this snapshot instead of taking one
//   --dry     in the current checkout: read and check, print the PRs it would open, leave the files as they were
//   --no-merge  open and rebuild its PRs, never merge one
//   AUTOPILOT_SSH (ubuntu@132.145.202.89), AUTOPILOT_SSH_KEY (~/.ssh/oracle-controlpoint), TESSERACT_JS: passed on.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { applyRows, changedRows, chunkRows, fileRows, prMarker, readMarker, rowKey, rowProblems, type Keyed, type Row } from "./lib/autopilotRows";
import { changelogEntry, forgetSettled, nextVersion, pickEvents, remember, rowsDelta, type Memory } from "./lib/autopilotRun";
import { clipCheckProblems, clipsDelta, clipsEntry } from "./lib/autopilotClips";
import { prGate } from "./lib/autopilotPr";
import { mainQuiet, mainStill, pickMerge, servesMerge } from "./lib/autopilotMergeStep";
import type { ClipCheck } from "../server/data/clipChecks";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
for (const a of argv) if (a.startsWith("--") && !["--max", "--sweep", "--db", "--dry", "--no-merge"].includes(a)) { console.error(`${a}: not a flag (--max N, --sweep N, --db F, --dry, --no-merge)`); process.exit(2); }
const MAX = Number(opt("max") ?? 6), SWEEP = Number(opt("sweep") ?? 4), DRY = argv.includes("--dry"), DB = opt("db"), MERGE = !argv.includes("--no-merge");
/** Main's last commit at least this old before a merge (each merge deploys; merges spaced, owner's rule). */
const MAIN_QUIET_MS = 605_000;
/** How long a merge is waited for on the live site. */
const LIVE_WAIT_MS = 20 * 60_000;
const HEALTH_URL = process.env.AUTOPILOT_HEALTH ?? "https://controlscout.org/api/health";
if (!Number.isInteger(MAX) || MAX < 1) { console.error("--max: a whole number, 1 or more"); process.exit(2); }
if (!Number.isInteger(SWEEP) || SWEEP < 0) { console.error("--sweep: a whole number, 0 or more"); process.exit(2); }

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
const tsx = (args: string[], timeoutMs: number) => sh(process.execPath, ["node_modules/tsx/dist/cli.mjs", ...args], { ok: true, timeoutMs });

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
/** Files a read may have written, as they were before it: put back however the run ends. */
const restore = new Map<string, string>();
// However the run ends (done, stopped, or thrown): what it tried keeps its retry and give-up counts, and every file a
// read wrote is put back, so the clone is never left with changes.
process.on("exit", () => {
  // A dry run opens no PR: what it "would open" or didn't find never counts toward the real runs' retries.
  if (!DRY) writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 1));
  for (const [file, text] of restore) writeFileSync(file, text);
});

const mainText = (path: string) => (DRY ? readFileSync(path, "utf8") : git("show", `origin/main:${path}`) + "\n");
const mainVersion = () => String(JSON.parse(mainText("package.json")).version);

/** Open autopilot PRs: number, branch, and the rows (season, video|event; the file, for a sweep PR) their mark names. */
function openPrs(): { number: number; branch: string; season: number; rows: string[]; file?: string; mergeable: string }[] {
  const list = JSON.parse(sh("gh", ["pr", "list", "--state", "open", "--label", LABEL, "--limit", "100", "--json", "number,headRefName,body,mergeable"], { quiet: true }).out || "[]");
  return list.flatMap((p: any) => { const m = readMarker(String(p.body ?? "")); return m && String(p.headRefName).startsWith(BRANCH) ? [{ number: p.number, branch: p.headRefName, ...m, mergeable: String(p.mergeable) }] : []; });
}

/** main's CHANGELOG with `entry` on top as main's next release, and package.json/lock at that version (written). */
function writeRelease(entry: string, pr: number): string {
  const version = nextVersion(mainVersion());
  const changelog = mainText("CHANGELOG.md"), at = changelog.indexOf("\n## ") + 1;
  writeFileSync("CHANGELOG.md", changelog.slice(0, at) + entry.replace("VERSION", version).replace("#PR", `#${pr}`) + "\n" + changelog.slice(at));
  for (const f of ["package.json", "package-lock.json"]) {
    let n = 0;
    writeFileSync(f, mainText(f).replace(/"version": "[^"]+"/g, (m) => (++n <= (f === "package.json" ? 1 : 2) ? `"version": "${version}"` : m)));
  }
  return version;
}
const commitEach = (files: [string, string][]) => { for (const [f, msg] of files) { git("add", f); git("commit", "--quiet", "-m", msg); } };
const push = (branch: string) => git("push", "--quiet", "--no-verify", "origin", `HEAD:refs/heads/${branch}`);
const askReview = (pr: number) => sh("gh", ["pr", "comment", String(pr), "--body", "@loopyreviews-bot review"], { ok: true });
const today = new Date().toISOString().slice(0, 10);
/** Closes an autopilot PR; false (logged) where GitHub refused or couldn't be reached: the PR is still open. */
function closePr(pr: number, comment: string): boolean {
  const r = sh("gh", ["pr", "close", String(pr), "--comment", comment], { ok: true });
  if (r.code) log(`#${pr}: couldn't be closed (gh exit ${r.code}); still open, tried again next run`);
  return !r.code;
}

/** A data PR's words: title, description, mark, CHANGELOG entry ("VERSION"/"#PR" filled at release), commit line. */
type PrText = { title: string; body: string[]; marker: string; entry: string; what: string };
/** A frame-read PR's words, from its rows against main's (opened, or rebuilt on main with fewer rows). */
function framesText(season: number, rows: Row[], live: Map<string, Row>): PrText {
  const d = rowsDelta(rows, live);
  return {
    what: `frame-read rows for ${d.events.join(", ")}`,
    title: `Clips: frame-read ${d.events.join(", ")} (${season}), ${d.clips} new`,
    body: [
      `Read by the clip autopilot (\`scripts/clip-autopilot.ts\`, docs/clip-autopilot.md), with nobody running the reader: ${d.events.length} events from the frame-read queue, ${d.recordings} recordings, ${d.clips} new clips, ${d.reasons} matches given a reason from the frames.`,
      "", "Every row passed `rowProblems` against main's row: each placed or moved start opens 20/12/5/2/0 s before it on a frame naming its match; starts plausible and in the order played; no new `unconfirmed`; no live clip pulled without a frame at its own second naming another match; re-reads dated after the live row.",
      "", ...rows.map((r) => `- ${r.code} \`${r.videoId}\`: ${Object.keys(r.starts).length} starts, ${Object.keys(r.missing ?? {}).length} missing, ${Object.keys(r.review ?? {}).length} for review`),
    ],
    marker: prMarker(season, rows), entry: changelogEntry(season, d, today),
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
    marker: prMarker(0, rows, CLIPS_FILE), entry: clipsEntry(d, today),
  };
}

// --- 1b. Own PRs rebuilt on main --------------------------------------------------------------------------------------
if (!DRY) sh("gh", ["label", "create", LABEL, "--force", "--color", "0e8a16", "--description", "A data PR the clip autopilot opened (scripts/clip-autopilot.ts)"], { ok: true, quiet: true });
const open = DRY ? [] : openPrs();
/** PRs renumbered on main this run: each waits for Loopy's review of its new head, so none merges this run. */
const rebuilt = new Set<number>();
for (const p of open) {
  try {
    // Inside the try: a branch that can't be read (deleted, not fetched) is logged and left, never the whole run.
    const branchVersion = String(JSON.parse(git("show", `origin/${p.branch}:package.json`)).version);
    if (p.mergeable !== "CONFLICTING" && nextVersion(mainVersion()) === branchVersion) continue;
    // A sweep PR's rows are checked as the sweep's are; a frame-read PR's as the reader's.
    const file = p.file ?? seasonFile(p.season), want = new Set(p.rows);
    const problems = (r: Keyed, was?: Keyed) => (file === CLIPS_FILE ? clipCheckProblems(r as ClipCheck, was as ClipCheck | undefined) : rowProblems(r as Row, was as Row | undefined));
    const rows = fileRows<Keyed>(git("show", `origin/${p.branch}:${file}`)).filter((r) => want.has(rowKey(r)));
    const live = new Map(fileRows<Keyed>(mainText(file)).map((r) => [rowKey(r), r]));
    const keep = rows.filter((r) => !problems(r, live.get(rowKey(r))).length);
    if (!keep.length) {
      if (closePr(p.number, "Main changed these rows since this read (another read reached them first): closed, the next run reads anything still due.")) log(`#${p.number}: closed, main read its rows meanwhile`);
      continue;
    }
    // Its words made again from the rows it keeps: rows main took meanwhile leave its title, entry and mark too.
    const text = file === CLIPS_FILE ? clipsText(keep as ClipCheck[], live as Map<string, ClipCheck>) : framesText(p.season, keep as Row[], live as Map<string, Row>);
    git("switch", "--quiet", "--detach", `origin/${p.branch}`);
    sh("git", ["merge", "--no-commit", "--no-ff", "origin/main"], { ok: true });
    writeFileSync(file, applyRows(mainText(file), keep));
    const version = writeRelease(text.entry, p.number);
    for (const f of [file, "CHANGELOG.md", "package.json", "package-lock.json"]) git("add", f);
    git("commit", "--quiet", "--no-edit", "-m", `Merge main; release ${version}`);
    push(p.branch);
    sh("gh", ["pr", "edit", String(p.number), "--title", text.title, "--body", [...text.body, "", text.marker].join("\n")]);
    askReview(p.number);
    rebuilt.add(p.number);
    log(`#${p.number}: rebuilt on main as ${version}${keep.length < rows.length ? ` (${rows.length - keep.length} rows main changed meanwhile left out)` : ""}`);
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
// waits for /api/health to serve the merge. --no-merge: open and rebuild PRs only.
if (!DRY && MERGE) mergeOne();
/** main's head as GitHub has it now: its sha and its last commit's time. */
const mainHead = () => {
  const [sha, date] = sh("gh", ["api", "repos/{owner}/{repo}/commits/main", "--jq", ".sha + \" \" + .commit.committer.date"], { quiet: true }).out.trim().split(" ");
  return { sha, at: Date.parse(date) };
};
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
    let merged = sh("gh", ["pr", "view", String(pick.number), "--json", "mergeCommit", "--jq", ".mergeCommit.oid"], { quiet: true, ok: true }).out.trim();
    // Not reported yet: main's head now, which holds the merge (a later commit only makes the live check stricter).
    if (!/^[0-9a-f]{40}$/.test(merged)) { git("fetch", "--quiet", "origin"); merged = git("rev-parse", "origin/main"); }
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
forgetSettled(memory, new Set(queue.filter((q) => q.frames.state === "queued").map((q) => `${q.season}/${q.code}`)));
const { picked, skipped } = pickEvents(queue, inPr, memory, MAX);
log(`queue: ${queue.filter((q) => q.frames.state === "queued").length} events queued; reading ${picked.map((q) => `${q.season}/${q.code} (${q.frames.due})`).join(", ") || "none"}`);
for (const s of skipped.filter((x) => x.why !== "next run")) log(`  skipped ${s.event}: ${s.why}`);

// --- Shipping: one data PR per chunk of rows -----------------------------------------------------------------------------

/** Opens a data PR with these rows applied to main's `file`: the rows commit, then (once the PR has its number) its
 *  CHANGELOG entry and version, each its own commit; Loopy asked to review. `marker`: the PR's mark (prMarker). */
function openPr(o: { file: string; rows: Keyed[]; branch: string } & PrText): boolean {
  if (DRY) { log(`would open "${o.title}": ${o.rows.length} rows, ${o.rows.map(rowKey).join(" ")}`); return true; }
  let pr = 0;
  try {
    writeFileSync(o.file, applyRows(mainText(o.file), o.rows));
    commitEach([[o.file, `${o.file}: ${o.what}`]]);
    push(o.branch);
    const url = sh("gh", ["pr", "create", "--base", "main", "--head", o.branch, "--title", o.title, "--label", LABEL, "--body", [...o.body, "", o.marker].join("\n")]).out.trim();
    pr = Number(url.split("/").pop());
    const version = writeRelease(o.entry, pr);
    commitEach([["CHANGELOG.md", `CHANGELOG.md: ${version}`], ["package.json", `package.json: ${version}`], ["package-lock.json", `package-lock.json: ${version}`]]);
    push(o.branch);
    askReview(pr);
    log(`opened ${url} (${version}): ${o.title}`);
    return true;
  } catch (e) {
    // A PR without its release would be rebuilt with another release's entry: closed instead, its rows read again
    // next run. Either way the run goes on to the next PR, season and the sweep.
    log(`"${o.title}": couldn't be opened (${(e as Error).message})`);
    // Left open where the close fails too: the next run rebuilds it, its release made again from its rows.
    if (pr && closePr(pr, "The autopilot couldn't finish this PR's release (CHANGELOG and version): closed; the next run reads these rows again.")) log(`#${pr}: closed without its release`);
    return false;
  } finally {
    // A step that failed halfway leaves its files behind: the clone is the autopilot's own, so put back to main.
    sh("git", ["reset", "--quiet", "--hard"], { ok: true });
    git("switch", "--quiet", "--detach", "origin/main");
  }
}
/** The frame reader. A read whose frames came up near-black (a player showing no picture) wrote nothing; the run stops
 *  there, every file put back as it was, and opens no PR: rows read off a black player would all say "no frame read". */
function reader(args: string[], timeoutMs: number): { code: number; out: string } {
  const r = tsx(args, timeoutMs);
  const dark = r.out.split("\n").find((l) => l.startsWith("NEAR-BLACK FRAMES"));
  if (dark) {
    // The exit puts every file back (restore).
    log(`stopped: ${dark}. The video player shows no picture; nothing read, no PR opened. Fix the reader, then run again.`);
    process.exit(3);
  }
  return r;
}
const branchStamp = STAMP.slice(0, 16).replace(/[-T]/g, "");

// --- 4–6. Read the due events, check, ship, season by season ------------------------------------------------------------------
const bySeason = new Map<number, typeof picked>();
for (const q of picked) (bySeason.get(q.season) ?? bySeason.set(q.season, []).get(q.season)!).push(q);
for (const [season, events] of bySeason) {
  const file = seasonFile(season);
  if (!existsSync(file)) { log(`${season}: no ${file} to write (add the season's file first)`); continue; }
  const before = readFileSync(file, "utf8"), liveFile = join(DIR, `live-${season}.ts`);
  writeFileSync(liveFile, mainText(file));
  restore.set(file, before);
  const codes = events.map((e) => e.code);
  // An event with rows already (read before it finished, or one of its videos read) is read again whole (--all): the
  // reader otherwise skips an event whose videos all have rows. The others read what isn't read yet.
  const hasRows = new Set(fileRows(before).map((r) => r.code));
  const again = codes.filter((c) => hasRows.has(c)), fresh = codes.filter((c) => !hasRows.has(c));
  // --live keeps the clips main plays from being dropped on a frame that names nothing; a season with no rows yet has
  // none to keep (and the reader refuses an empty --live file).
  const base = ["scripts/video-frames.ts", "--season", String(season), ...(fileRows(mainText(file)).length ? ["--live", liveFile] : []), "--lanes", "2"];
  // A read that crashed, timed out or was killed read nothing for sure: its events aren't counted as tried (remember).
  let readFailed = false;
  const pass = (args: string[], ms: number, what: string) => { const code = reader([...base, ...args], ms).code; if (code) readFailed = true; log(`${season} ${what}: exit ${code}`); };
  for (const [list, extra] of [[fresh, []], [again, ["--all"]]] as const) if (list.length) pass(["--codes", list.join(","), ...extra], 6 * 3600_000, `read ${list.join(",")}`);
  for (const p of ["--verify", "--bounds"]) pass(["--codes", codes.join(","), p], 3 * 3600_000, p);
  const after = readFileSync(file, "utf8");
  writeFileSync(file, before);
  const live = new Map(fileRows(mainText(file)).map((r) => [rowKey(r), r]));
  // Each event's played matches in the order they were played (FIRST's times are the venue's own, so they sort).
  const order = new Map<string, string[]>();
  for (const m of await all<{ code: string; label: string }>(`SELECT code, label FROM matches WHERE season = ? AND played = 1 AND time IS NOT NULL AND code IN (${codes.map(() => "?").join(",")}) ORDER BY code, time`, [season, ...codes])) {
    (order.get(String(m.code)) ?? order.set(String(m.code), []).get(String(m.code))!).push(String(m.label));
  }
  const good: Row[] = [];
  for (const r of changedRows(before, after).filter((x) => codes.includes(x.code))) {
    const problems = rowProblems(r, live.get(rowKey(r)), order.get(r.code));
    if (problems.length) log(`  ${r.code} ${r.videoId}: left out, ${problems.join("; ")}`); else good.push(r);
  }
  // Shipped: only events whose rows a PR really opened with (a failed open closes its PR; the rows are read again).
  const opened = new Set<string>();
  for (const chunk of chunkRows(good)) {
    const ok = openPr({ file, rows: chunk, branch: `${BRANCH}${season}-${branchStamp}-${chunk[0].code}`, ...framesText(season, chunk, live) });
    if (ok) for (const r of chunk) opened.add(r.code);
  }
  for (const e of events) {
    const n = good.filter((r) => r.code === e.code).length;
    if (n && !opened.has(e.code)) { log(`  ${season}/${e.code}: its PR couldn't be opened; not counted as a try`); continue; }
    if (!n && readFailed) { log(`  ${season}/${e.code}: the read failed; not counted as a try`); continue; }
    remember(memory, `${season}/${e.code}`, n, n ? "shipped" : after === before ? "no new rows" : "rows refused or unchanged");
  }
}

// --- 7. The live clips the clock places, checked by their first frame --------------------------------------------------------
// Each clip the live site plays from the clock is read paused at its first second (video-frames.ts --clips): its own
// match there, ok; another match, pulled (never served); nothing, left as it is and read again next sweep. Up to
// --sweep events a run, newest season first; events whose clips are all checked are passed over without a read.
if (SWEEP && !open.some((p) => p.file === CLIPS_FILE)) {
  const before = readFileSync(CLIPS_FILE, "utf8");
  restore.set(CLIPS_FILE, before);
  let budget = SWEEP;
  const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
  for (const season of seasons) {
    if (budget <= 0) break;
    if (!existsSync(seasonFile(season))) continue;
    const r = reader(["scripts/video-frames.ts", "--season", String(season), "--clips", "--limit", String(budget), "--lanes", "2"], 4 * 3600_000);
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
  for (const chunk of chunkRows(good)) openPr({ file: CLIPS_FILE, rows: chunk, branch: `${BRANCH}clips-${branchStamp}-${chunk[0].code}`, ...clipsText(chunk, live) });
}
log("done");
