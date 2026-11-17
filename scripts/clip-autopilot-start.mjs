// The clip autopilot's start: what its scheduled task runs (scripts/clip-autopilot-task.ps1), never the runner itself.
// One run at a time (the lock); the clone put back to main (a run killed halfway can leave its files changed); the
// dependencies installed when main's package-lock.json changed; then the runner (scripts/clip-autopilot.ts), as its
// child, with this script's arguments.
//
// Plain Node, nothing from node_modules: npm ci replaces node_modules, which can't happen under the runner. It runs in
// tsx, whose esbuild.exe Windows holds open, so npm ci's delete of it fails (EPERM) after it has removed most of the
// rest (the first manual run, 2026-11-17).
//
//   node scripts/clip-autopilot-start.mjs [--max 6] [--sweep 4] [--db snapshot.db]
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DIR = ".data/autopilot", LOCK = join(DIR, "lock"), HASH = join(DIR, "lock-hash");
mkdirSync(DIR, { recursive: true });
const log = (s) => { const line = `${new Date().toISOString()} start: ${s}`; console.log(line); appendFileSync(join(DIR, "start.log"), `${line}\n`); };
/** A command with its output shown; its exit status (a signal, the timeout, a failure to start: 1). Through a shell,
 *  one command line (fixed words only here): Node warns of arguments passed beside a shell (DEP0190). `timeout`: a
 *  stalled network or npm never holds the lock for hours. */
const run = (cmd, args, o = {}) => {
  const opts = { stdio: "inherit", timeout: o.timeout, env: o.env ?? process.env };
  return (o.shell ? spawnSync([cmd, ...args].join(" "), { ...opts, shell: true }) : spawnSync(cmd, args, opts)).status ?? 1;
};
const git = (...args) => { if (run("git", args, { timeout: 600_000 })) { log(`git ${args[0]} failed: no run`); process.exit(1); } };

// --- One run at a time ----------------------------------------------------------------------------------------------
/** A lock a killed run left (shutdown, power cut, the task stopped): its process is gone, or it's older than any run. */
function staleLock(text) {
  const [pid, at] = text.split(" ").map(Number);
  if (!(Date.now() - at < 10 * 3600_000)) return true;
  try { process.kill(pid, 0); return false; } catch (e) { return e.code === "ESRCH"; }
}
// Taken atomically ("wx": only if no lock is there), so two runs starting together can't both hold it.
const MINE = `${process.pid} ${Date.now()}`;
for (let tries = 0; ; tries++) {
  try { writeFileSync(LOCK, MINE, { flag: "wx" }); break; } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let stale = true, seen = "";
    try { seen = readFileSync(LOCK, "utf8"); stale = staleLock(seen); } catch { /* unreadable or half-written: a crashed run's */ }
    if (!stale || tries > 2) { log("another run holds the lock: stopping"); process.exit(0); }
    // Taken over by renaming it away: only one run's rename of that file can succeed. A run whose rename fails (another
    // took it first) tries again, and finds the winner's fresh lock.
    const away = `${LOCK}.${process.pid}`;
    try { renameSync(LOCK, away); } catch { continue; }
    // The file renamed has to be the one judged stale: one another run took meanwhile goes back, and this run stops.
    let got = "";
    try { got = readFileSync(away, "utf8"); } catch { /* gone: nothing to put back */ }
    if (got !== seen) {
      try { renameSync(away, LOCK); } catch { /* a third run's lock is there: it holds it */ }
      log("another run took the lock: stopping");
      process.exit(0);
    }
    rmSync(away, { force: true });
    log("a stopped run's lock: taken over");
  }
}
process.on("exit", () => rmSync(LOCK, { force: true }));

// --- The clone at main ----------------------------------------------------------------------------------------------
// The clone is the autopilot's alone: changes in it are what a killed run left (the task's time limit, a shutdown).
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8", timeout: 600_000 });
if (status.status !== 0) { log("git status failed: no run (is this the autopilot's clone?)"); process.exit(1); }
if (status.stdout.trim()) { log("the clone had changes a stopped run left: put back to main"); git("reset", "--quiet", "--hard"); }
git("fetch", "--quiet", "origin");
git("switch", "--quiet", "--detach", "origin/main");

// --- Its dependencies, before anything runs from them ----------------------------------------------------------------
const lockHash = createHash("sha1").update(readFileSync("package-lock.json")).digest("hex");
if (!existsSync("node_modules/tsx/dist/cli.mjs") || !existsSync(HASH) || readFileSync(HASH, "utf8") !== lockHash) {
  log("installing dependencies (package-lock.json changed)");
  // Written only once npm ci finishes: one that fails halfway is tried again next run.
  rmSync(HASH, { force: true });
  // npm is a .cmd on Windows, which only a shell runs.
  if (run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { shell: process.platform === "win32", timeout: 1_800_000 })) { log("npm ci failed: no run"); process.exit(1); }
  writeFileSync(HASH, lockHash);
}

// --- The run --------------------------------------------------------------------------------------------------------
// The lock's text goes to the runner (tsx runs it in a process of its own, so it can't know this one as its parent):
// it runs only while the lock still says that, and leaves the lock to this process. Its own limits bound its time.
process.exitCode = run(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/clip-autopilot.ts", ...process.argv.slice(2)], { env: { ...process.env, CLIP_AUTOPILOT_LOCK: MINE } });
