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
//   6. opens a data PR per season file, at most 15 KB each, with its CHANGELOG entry, and asks Loopy to review it.
//
//   npx tsx scripts/clip-autopilot.ts [--max 6] [--db snapshot.db] [--dry]
//   --max N   events read per run (default 6)
//   --db F    read this snapshot instead of taking one
//   --dry     in the current checkout: read and check, print the PRs it would open, leave the files as they were
//   AUTOPILOT_SSH (ubuntu@132.145.202.89), AUTOPILOT_SSH_KEY (~/.ssh/oracle-controlpoint), TESSERACT_JS: passed on.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { applyRows, changedRows, chunkRows, fileRows, prMarker, readMarker, rowKey, rowProblems, type Row } from "./lib/autopilotRows";
import { changelogEntry, forgetSettled, nextVersion, pickEvents, remember, rowsDelta, type Memory } from "./lib/autopilotRun";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
for (const a of argv) if (a.startsWith("--") && !["--max", "--db", "--dry"].includes(a)) { console.error(`${a}: not a flag (--max N, --db F, --dry)`); process.exit(2); }
const MAX = Number(opt("max") ?? 6), DRY = argv.includes("--dry"), DB = opt("db");
if (!Number.isInteger(MAX) || MAX < 1) { console.error("--max: a whole number, 1 or more"); process.exit(2); }

const DIR = ".data/autopilot", STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync(join(DIR, "runs"), { recursive: true });
const LOG = join(DIR, "runs", `${STAMP}.log`);
const log = (s: string) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); appendFileSync(LOG, `${line}\n`); };
const LABEL = "clip-autopilot", BRANCH = "clip-autopilot/";
const seasonFile = (season: number) => `server/data/frameTimings/${season}.ts`;

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

/** Open autopilot PRs: number, branch, and the rows (season, video|event) their mark names. */
function openPrs(): { number: number; branch: string; season: number; rows: string[]; mergeable: string }[] {
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
    const file = seasonFile(p.season), want = new Set(p.rows);
    const rows = fileRows(git("show", `origin/${p.branch}:${file}`)).filter((r) => want.has(rowKey(r)));
    const live = new Map(fileRows(mainText(file)).map((r) => [rowKey(r), r]));
    const keep = rows.filter((r) => !rowProblems(r, live.get(rowKey(r))).length);
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
const inPr = new Set(open.flatMap((p) => p.rows.map((k) => `${p.season}/${k.split("|")[1]}`)));
forgetSettled(memory, new Set(queue.filter((q) => q.frames.state === "queued").map((q) => `${q.season}/${q.code}`)));
const { picked, skipped } = pickEvents(queue, inPr, memory, MAX);
log(`queue: ${queue.filter((q) => q.frames.state === "queued").length} events queued; reading ${picked.map((q) => `${q.season}/${q.code} (${q.frames.due})`).join(", ") || "none"}`);
for (const s of skipped.filter((x) => x.why !== "next run")) log(`  skipped ${s.event}: ${s.why}`);

// --- 4–6. Read, check, ship, season by season ------------------------------------------------------------------------------
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
    const d = rowsDelta(chunk, live), title = `Clips: frame-read ${d.events.join(", ")} (${season}), ${d.clips} new`;
    if (DRY) { log(`would open "${title}": ${chunk.length} rows, ${chunk.map((r) => rowKey(r)).join(" ")}`); continue; }
    const branch = `${BRANCH}${season}-${STAMP.slice(0, 16).replace(/[-T]/g, "")}-${d.events[0]}`;
    writeFileSync(file, applyRows(mainText(file), chunk));
    commitEach([[file, `${file}: frame-read rows for ${d.events.join(", ")}`]]);
    push(branch);
    const body = [
      `Read by the clip autopilot (\`scripts/clip-autopilot.ts\`, docs/clip-autopilot.md), with nobody running the reader: ${d.events.length} events from the frame-read queue, ${d.recordings} recordings, ${d.clips} new clips, ${d.reasons} matches given a reason from the frames.`,
      "", "Every row passed `rowProblems` against main's row: each placed or moved start opens 20/12/5/2/0 s before it on a frame naming its match; starts plausible; no new `unconfirmed`; no live clip pulled without a frame naming another match; re-reads dated after the live row.",
      "", ...chunk.map((r) => `- ${r.code} \`${r.videoId}\`: ${Object.keys(r.starts).length} starts, ${Object.keys(r.missing ?? {}).length} missing, ${Object.keys(r.review ?? {}).length} for review`),
      "", prMarker(season, chunk),
    ].join("\n");
    const url = sh("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--label", LABEL, "--body", body]).out.trim();
    const pr = Number(url.split("/").pop());
    const version = writeRelease(changelogEntry(season, d, new Date().toISOString().slice(0, 10)), pr);
    commitEach([["CHANGELOG.md", `CHANGELOG.md: ${version}`], ["package.json", `package.json: ${version}`], ["package-lock.json", `package-lock.json: ${version}`]]);
    push(branch);
    askReview(pr);
    git("switch", "--quiet", "--detach", "origin/main");
    log(`opened ${url} (${version}): ${title}`);
  }
}
writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 1));
log("done");
