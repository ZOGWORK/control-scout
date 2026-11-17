// The clip autopilot: reads the frames of every recording the frame-read queue says is due, with nobody running the
// reader by hand, and ships what it reads as data PRs for the usual review (docs/clip-autopilot.md).
//
// YouTube refuses data-centre addresses (GitHub's runners and the VM both get its "confirm you're not a bot" page), so
// this runs on a computer at home, from a clone of its own, on a schedule (scripts/clip-autopilot-task.ps1). Each run:
//   1. brings the clone to main, and rebuilds its own open PRs on main when main moved under them;
//   2. takes a read-only snapshot of the live database (VACUUM INTO over ssh: the VM's database is never written);
//   3. takes the queue from that snapshot (server/videos/frameQueue.ts), most missing first;
//   4. reads each picked event with scripts/video-frames.ts (--live main's season file), then --verify, then --bounds;
//   5. checks every row it changed (scripts/lib/autopilotRows.ts): a row that breaks a rule is left out, logged;
//   6. opens a data PR per season file, at most 15 KB each, with its CHANGELOG entry, and asks Loopy to review it;
//   7. sweeps the live clips the clock places (video-frames.ts --clips): each read paused at its first second, pulled
//      only where that frame names another match, confirmed where it names its own, left as it is where it names none;
//      shipped as server/data/clipChecks.ts PRs, checked by scripts/lib/autopilotClips.ts.
//
//   npx tsx scripts/clip-autopilot.ts [--max 6] [--sweep 4] [--db snapshot.db] [--dry]
//   --max N   events read per run (default 6)
//   --sweep N events whose clock clips are checked per run (default 4; 0: no sweep)
//   --db F    read this snapshot instead of taking one
//   --dry     in the current checkout: read and check, print the PRs it would open, leave the files as they were
//   AUTOPILOT_SSH (ubuntu@132.145.202.89), AUTOPILOT_SSH_KEY (~/.ssh/oracle-controlpoint), TESSERACT_JS: passed on.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { applyRows, changedRows, chunkRows, fileRows, prMarker, readMarker, rowKey, rowProblems, type Keyed, type Row } from "./lib/autopilotRows";
import { changelogEntry, forgetSettled, nextVersion, pickEvents, remember, rowsDelta, type Memory } from "./lib/autopilotRun";
import { clipCheckProblems, clipsDelta, clipsEntry } from "./lib/autopilotClips";
import type { ClipCheck } from "../server/data/clipChecks";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
for (const a of argv) if (a.startsWith("--") && !["--max", "--sweep", "--db", "--dry"].includes(a)) { console.error(`${a}: not a flag (--max N, --sweep N, --db F, --dry)`); process.exit(2); }
const MAX = Number(opt("max") ?? 6), SWEEP = Number(opt("sweep") ?? 4), DRY = argv.includes("--dry"), DB = opt("db");
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
  const code = r.status ?? (r.error ? 1 : 0);
  if (code && !o.ok) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed (${code}): ${out.trim().split("\n").slice(-3).join(" | ")}`);
  return { code, out: r.stdout ?? "" };
}
const git = (...a: string[]) => sh("git", a).out.trim();
const tsx = (args: string[], timeoutMs: number) => sh(process.execPath, ["node_modules/tsx/dist/cli.mjs", ...args], { ok: true, timeoutMs });

// --- One run at a time --------------------------------------------------------------------------------------------
const LOCK = join(DIR, "lock");
if (existsSync(LOCK) && Date.now() - Number(readFileSync(LOCK, "utf8")) < 10 * 3600_000) { log("another run holds the lock: stopping"); process.exit(0); }
writeFileSync(LOCK, String(Date.now()));
process.on("exit", () => rmSync(LOCK, { force: true }));

const MEMORY_FILE = join(DIR, "memory.json");
const memory: Memory = existsSync(MEMORY_FILE) ? JSON.parse(readFileSync(MEMORY_FILE, "utf8")) : {};

// --- 1. The clone at main ------------------------------------------------------------------------------------------
if (!DRY) {
  if (git("status", "--porcelain", "--untracked-files=no")) { log("the clone has changes of its own: stopping (it must be a clone kept for the autopilot alone)"); process.exit(1); }
  git("fetch", "--quiet", "origin");
  git("switch", "--quiet", "--detach", "origin/main");
  const lockHash = createHash("sha1").update(readFileSync("package-lock.json")).digest("hex"), HASH = join(DIR, "lock-hash");
  if (!existsSync("node_modules") || !existsSync(HASH) || readFileSync(HASH, "utf8") !== lockHash) {
    log("installing dependencies (package-lock.json changed)");
    // npm is a .cmd on Windows, which only a shell runs.
    sh("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { timeoutMs: 1_800_000, shell: process.platform === "win32" });
    writeFileSync(HASH, lockHash);
  }
}
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

// --- 1b. Own PRs rebuilt on main --------------------------------------------------------------------------------------
if (!DRY) sh("gh", ["label", "create", LABEL, "--force", "--color", "0e8a16", "--description", "A data PR the clip autopilot opened (scripts/clip-autopilot.ts)"], { ok: true, quiet: true });
const open = DRY ? [] : openPrs();
for (const p of open) {
  const branchVersion = String(JSON.parse(git("show", `origin/${p.branch}:package.json`)).version);
  if (p.mergeable !== "CONFLICTING" && nextVersion(mainVersion()) === branchVersion) continue;
  try {
    // A sweep PR's rows are checked as the sweep's are; a frame-read PR's as the reader's.
    const file = p.file ?? seasonFile(p.season), want = new Set(p.rows);
    const problems = (r: Keyed, was?: Keyed) => (file === CLIPS_FILE ? clipCheckProblems(r as ClipCheck, was as ClipCheck | undefined) : rowProblems(r as Row, was as Row | undefined));
    const rows = fileRows<Keyed>(git("show", `origin/${p.branch}:${file}`)).filter((r) => want.has(rowKey(r)));
    const live = new Map(fileRows<Keyed>(mainText(file)).map((r) => [rowKey(r), r]));
    const keep = rows.filter((r) => !problems(r, live.get(rowKey(r))).length);
    if (!keep.length) {
      sh("gh", ["pr", "close", String(p.number), "--comment", "Main changed these rows since this read (another read reached them first): closed, the next run reads anything still due."], { ok: true });
      log(`#${p.number}: closed, main read its rows meanwhile`);
      continue;
    }
    const entry = git("show", `origin/${p.branch}:CHANGELOG.md`).split(/\n(?=## )/)[1].replace(/^## \S+/, "## VERSION").replace(/\(#\d+\)/, "(#PR)");
    git("switch", "--quiet", "--detach", `origin/${p.branch}`);
    sh("git", ["merge", "--no-commit", "--no-ff", "origin/main"], { ok: true });
    writeFileSync(file, applyRows(mainText(file), keep));
    const version = writeRelease(entry, p.number);
    for (const f of [file, "CHANGELOG.md", "package.json", "package-lock.json"]) git("add", f);
    git("commit", "--quiet", "--no-edit", "-m", `Merge main; release ${version}`);
    push(p.branch);
    askReview(p.number);
    log(`#${p.number}: rebuilt on main as ${version}${keep.length < rows.length ? ` (${rows.length - keep.length} rows main changed meanwhile left out)` : ""}`);
  } catch (e) {
    log(`#${p.number}: couldn't be rebuilt on main (${(e as Error).message}); left as it is`);
    sh("git", ["merge", "--abort"], { ok: true, quiet: true });
  } finally { if (!DRY) git("switch", "--quiet", "--detach", "origin/main"); }
}

// --- 2. A snapshot of the live database ---------------------------------------------------------------------------------
let snapshot = DB;
if (!snapshot) {
  const host = process.env.AUTOPILOT_SSH ?? "ubuntu@132.145.202.89", key = process.env.AUTOPILOT_SSH_KEY ?? join(homedir(), ".ssh", "oracle-controlpoint");
  const ssh = ["-o", "BatchMode=yes", "-i", key], remote = `/tmp/autopilot-${STAMP}.db`;
  // VACUUM INTO reads the database and writes a copy: the live file is never written.
  // The copy's script goes in on stdin: no quoting to survive two shells (Windows' and the VM's).
  const vacuum = `require("@libsql/client").createClient({ url: "file:/opt/control-scout/shared/data/scout.db" }).execute(${JSON.stringify(`VACUUM INTO '${remote}'`)}).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });`;
  sh("ssh", [...ssh, host, `cd /opt/control-scout/current && sudo -u controlscout node - && sudo gzip -f ${remote} && sudo chmod 644 ${remote}.gz`], { timeoutMs: 900_000, input: vacuum });
  try { sh("scp", [...ssh, `${host}:${remote}.gz`, join(DIR, "snapshot.db.gz")], { timeoutMs: 1_800_000 }); } finally { sh("ssh", [...ssh, host, `sudo rm -f ${remote} ${remote}.gz`], { ok: true }); }
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
function openPr(o: { file: string; rows: Keyed[]; branch: string; title: string; body: string[]; marker: string; entry: string; what: string }): void {
  if (DRY) { log(`would open "${o.title}": ${o.rows.length} rows, ${o.rows.map(rowKey).join(" ")}`); return; }
  try {
    writeFileSync(o.file, applyRows(mainText(o.file), o.rows));
    commitEach([[o.file, `${o.file}: ${o.what}`]]);
    push(o.branch);
    const url = sh("gh", ["pr", "create", "--base", "main", "--head", o.branch, "--title", o.title, "--label", LABEL, "--body", [...o.body, "", o.marker].join("\n")]).out.trim();
    const pr = Number(url.split("/").pop());
    const version = writeRelease(o.entry, pr);
    commitEach([["CHANGELOG.md", `CHANGELOG.md: ${version}`], ["package.json", `package.json: ${version}`], ["package-lock.json", `package-lock.json: ${version}`]]);
    push(o.branch);
    askReview(pr);
    log(`opened ${url} (${version}): ${o.title}`);
  } finally { git("switch", "--quiet", "--detach", "origin/main"); }
}
const branchStamp = STAMP.slice(0, 16).replace(/[-T]/g, "");
const today = new Date().toISOString().slice(0, 10);

// --- 4–6. Read the due events, check, ship, season by season ------------------------------------------------------------------
const bySeason = new Map<number, typeof picked>();
for (const q of picked) (bySeason.get(q.season) ?? bySeason.set(q.season, []).get(q.season)!).push(q);
for (const [season, events] of bySeason) {
  const file = seasonFile(season);
  if (!existsSync(file)) { log(`${season}: no ${file} to write (add the season's file first)`); continue; }
  const before = readFileSync(file, "utf8"), liveFile = join(DIR, `live-${season}.ts`);
  writeFileSync(liveFile, mainText(file));
  const codes = events.map((e) => e.code);
  // An event with rows already (read before it finished, or one of its videos read) is read again whole (--all): the
  // reader otherwise skips an event whose videos all have rows. The others read what isn't read yet.
  const hasRows = new Set(fileRows(before).map((r) => r.code));
  const again = codes.filter((c) => hasRows.has(c)), fresh = codes.filter((c) => !hasRows.has(c));
  // --live keeps the clips main plays from being dropped on a frame that names nothing; a season with no rows yet has
  // none to keep (and the reader refuses an empty --live file).
  const base = ["scripts/video-frames.ts", "--season", String(season), ...(fileRows(mainText(file)).length ? ["--live", liveFile] : []), "--lanes", "2"];
  for (const [list, extra] of [[fresh, []], [again, ["--all"]]] as const) if (list.length) log(`${season} read ${list.join(",")}: exit ${tsx([...base, "--codes", list.join(","), ...extra], 6 * 3600_000).code}`);
  for (const pass of ["--verify", "--bounds"]) log(`${season} ${pass}: exit ${tsx([...base, "--codes", codes.join(","), pass], 3 * 3600_000).code}`);
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
  for (const e of events) {
    const n = good.filter((r) => r.code === e.code).length;
    remember(memory, `${season}/${e.code}`, n, n ? "shipped" : after === before ? "no new rows" : "rows refused or unchanged");
  }
  for (const chunk of chunkRows(good)) {
    const d = rowsDelta(chunk, live);
    openPr({
      file, rows: chunk, branch: `${BRANCH}${season}-${branchStamp}-${d.events[0]}`, what: `frame-read rows for ${d.events.join(", ")}`,
      title: `Clips: frame-read ${d.events.join(", ")} (${season}), ${d.clips} new`,
      body: [
        `Read by the clip autopilot (\`scripts/clip-autopilot.ts\`, docs/clip-autopilot.md), with nobody running the reader: ${d.events.length} events from the frame-read queue, ${d.recordings} recordings, ${d.clips} new clips, ${d.reasons} matches given a reason from the frames.`,
        "", "Every row passed `rowProblems` against main's row: each placed or moved start opens 20/12/5/2/0 s before it on a frame naming its match; starts plausible and in the order played; no new `unconfirmed`; no live clip pulled without a frame at its own second naming another match; re-reads dated after the live row.",
        "", ...chunk.map((r) => `- ${r.code} \`${r.videoId}\`: ${Object.keys(r.starts).length} starts, ${Object.keys(r.missing ?? {}).length} missing, ${Object.keys(r.review ?? {}).length} for review`),
      ],
      marker: prMarker(season, chunk), entry: changelogEntry(season, d, today),
    });
  }
}

// --- 7. The live clips the clock places, checked by their first frame --------------------------------------------------------
// Each clip the live site plays from the clock is read paused at its first second (video-frames.ts --clips): its own
// match there, ok; another match, pulled (never served); nothing, left as it is and read again next sweep. Up to
// --sweep events a run, newest season first; events whose clips are all checked are passed over without a read.
if (SWEEP && !open.some((p) => p.file === CLIPS_FILE)) {
  const before = readFileSync(CLIPS_FILE, "utf8");
  let budget = SWEEP;
  const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
  for (const season of seasons) {
    if (budget <= 0) break;
    if (!existsSync(seasonFile(season))) continue;
    const r = tsx(["scripts/video-frames.ts", "--season", String(season), "--clips", "--limit", String(budget), "--lanes", "2"], 4 * 3600_000);
    const checked = (r.out.match(/^\S+: \d+ clock clips to check by their first frame$/gm) ?? []).length;
    log(`${season} sweep: ${checked} events checked, exit ${r.code}`);
    budget -= checked;
  }
  const after = readFileSync(CLIPS_FILE, "utf8");
  writeFileSync(CLIPS_FILE, before);
  const live = new Map(fileRows<ClipCheck>(mainText(CLIPS_FILE)).map((c) => [rowKey(c), c]));
  const good: ClipCheck[] = [];
  for (const c of changedRows<ClipCheck>(before, after)) {
    const problems = clipCheckProblems(c, live.get(rowKey(c)));
    if (problems.length) log(`  ${c.season} ${c.code} ${c.videoId}: left out, ${problems.join("; ")}`); else good.push(c);
  }
  for (const chunk of chunkRows(good)) {
    const d = clipsDelta(chunk, live);
    openPr({
      file: CLIPS_FILE, rows: chunk, branch: `${BRANCH}clips-${branchStamp}-${chunk[0].code}`, what: `first-frame checks for ${d.events.join(", ")}`,
      title: `Clips: first-frame checks, ${d.pulled} pulled, ${d.ok} confirmed (${d.events.length} events)`,
      body: [
        `Swept by the clip autopilot (\`scripts/video-frames.ts --clips\`): each clip the live site plays from the clock, read paused at its first second. ${d.ok} name their own match (ok), ${d.pulled} name another match (pulled: never served), ${d.unconfirmed} name none (still served, read again next sweep).`,
        "", "Every row passed `clipCheckProblems` against main's: a pull only where the frame names a different match; no clip in two states; what main's row settled kept (a pull lifts only on a frame naming the match, an ok goes only on one naming another).",
        "", ...d.pulledList.map((x) => `- pulled: ${x}`),
      ],
      marker: prMarker(0, chunk, CLIPS_FILE), entry: clipsEntry(d, today),
    });
  }
}
writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 1));
log("done");
