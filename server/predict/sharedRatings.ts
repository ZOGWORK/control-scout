// The ratings built once and shared by every process on the machine (the web process's rebuild worker, the live
// follow-up and data cycle children, the other lane while a deploy hands over), instead of each replaying the window.
//
// Every new data version (a live result: about once a minute on an event day) was replayed twice or more: the live
// follow-up child built the ratings it needed (12.7 s of CPU on the VM), then the web process's rebuild worker built the
// very same ones again a few seconds later. The replay's result (ForecasterParts) is plain data plus two classes, so
// the first process to build it saves it (v8.serialize: 87 MB, 0.7 s) and the others load it (read and deserialize:
// 1.4 s), measured on the VM 2026-11-22 on its own data. Loading happens where the replay would have run (the rebuild
// worker's thread, or a child process): the web process's request thread never deserializes anything.
//
// A saved build is used only for exactly what it was built from: the anchor, the window's seasons, the data version,
// the engine's version and the release (two lanes on different code never share), and only once complete (the
// finished seasons' pair history in: partnershipComplete). Same key, same database: the replay would come out the
// same, so loading it gives the forecaster a replay would (tested field for field, predict/sharedRatings.test.ts).
//
// While one process builds a version, others asking for it wait for that build (up to WAIT_MS, as long as its process
// lives) rather than replay it too: pages keep the previous ratings meanwhile (engine.ts liveForecaster). A build lock
// whose process died, or older than STALE_MS, is taken over.
//
// Where: /dev/shm (memory, shared by every process on the machine; a build a minute on an event day would otherwise be
// ~5 GB an hour written to disk), else DATA_DIR/ratings-share; RATINGS_SHARE_DIR sets it, RATINGS_SHARE=off turns it
// off. Off by default outside production (tests and dev set the directory themselves). The newest KEEP builds per
// anchor are kept. "Clear caches" deletes them all (engine.ts resetForecasters), so a forced rebuild is a real one.
import { serialize, deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_VERSION, PartnershipTable, RatingBook } from "@control-scout/predict-engine";
import { env } from "../env.js";
import { RELEASE } from "../release.js";
import type { ForecasterParts } from "./engine.js";

/** Bumped when what a saved build holds changes shape (an old file is then never read). */
const FORMAT = 1;
/** How long to wait for another process's build of the same version before building it here. */
export const WAIT_MS = 60_000;
/** A build lock older than this is taken over (a build takes ~13 s; a stuck one never holds the rest up for long). */
export const STALE_MS = 3 * 60_000;
/** Builds kept per anchor (the newest), so a reader of the one before the newest still finds it. */
export const KEEP = 3;
const POLL_MS = 250;
/** One line per build in the server log (journalctl): loaded or built here, and how long it took. */
const log = (m: string) => { if (process.env.NODE_ENV !== "test") console.log(`[${new Date().toISOString()}] ${m}`); };

/** Where builds are shared, or null when sharing is off. */
export function shareDir(): string | null {
  if (process.env.RATINGS_SHARE === "off") return null;
  const set = process.env.RATINGS_SHARE_DIR?.trim();
  if (set) return set;
  if (!env.production) return null;
  return existsSync("/dev/shm") ? "/dev/shm/control-scout-ratings" : join(env.dataDir, "ratings-share");
}

/** The file a build of exactly this is saved as. */
export function buildFile(dir: string, anchor: number, seasons: readonly number[], version: string): string {
  const key = createHash("sha1").update(JSON.stringify([FORMAT, anchor, seasons, version, ENGINE_VERSION, RELEASE ?? "dev"])).digest("hex").slice(0, 24);
  return join(dir, `${anchor}-${key}.v8`);
}

/** What was done for the last builds in this process (tests, and the log line). */
const counts = { loaded: 0, built: 0, saved: 0, waited: 0 };
export const sharedCounts = () => ({ ...counts });

/** The two classes the parts hold, put back after deserializing (structured clone keeps their own fields only), as the
 *  rebuild worker's hand-off does (offThread.ts). */
function revive(p: ForecasterParts): ForecasterParts {
  for (const b of p.books.values()) Object.setPrototypeOf(b, RatingBook.prototype);
  const table = (t: PartnershipTable | null) => (t ? Object.setPrototypeOf(t, PartnershipTable.prototype) as PartnershipTable : t);
  p.pairTable = table(p.pairTable);
  for (const [s, t] of p.pastPairTables) p.pastPairTables.set(s, table(t)!);
  return p;
}

/** A saved build, or null (none, or unreadable: then it's removed, and built again). */
export function loadBuild(file: string): ForecasterParts | null {
  let raw: Buffer;
  try { raw = readFileSync(file); } catch { return null; }
  try {
    const p = deserialize(raw) as ForecasterParts;
    if (!(p?.books instanceof Map) || !(p.events instanceof Map) || p.partnershipComplete !== true) throw new Error("not a whole build");
    return revive(p);
  } catch {
    rmSync(file, { force: true });
    return null;
  }
}

/** Save a build where others find it: written whole to a temporary name, then renamed (a reader never sees half a
 *  file). Then only the newest KEEP per anchor stay. Never throws: a build that can't be shared is still used here. */
export function saveBuild(file: string, anchor: number, p: ForecasterParts): boolean {
  if (!p.partnershipComplete) return false;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, serialize(p), { mode: 0o600 });
    renameSync(tmp, file);
    prune(join(file, ".."), anchor);
    return true;
  } catch {
    rmSync(tmp, { force: true });
    return false;
  }
}

function prune(dir: string, anchor: number, now = Date.now()): void {
  const mine = readdirSync(dir).filter((f) => f.startsWith(`${anchor}-`) && f.endsWith(".v8"))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const { f } of mine.slice(KEEP)) rmSync(join(dir, f), { force: true });
  // Leftovers of a process killed mid-write.
  for (const f of readdirSync(dir)) if (f.endsWith(".tmp") && now - statSync(join(dir, f)).mtimeMs > STALE_MS) rmSync(join(dir, f), { force: true });
}

/** Delete every shared build ("Clear caches": the next build is a real replay). */
export function clearShared(): void {
  const dir = shareDir();
  if (!dir || !existsSync(dir)) return;
  for (const f of readdirSync(dir)) if (f.endsWith(".v8") || f.endsWith(".building")) rmSync(join(dir, f), { force: true });
}

/** Is the process that holds `lock` still building (alive, and not past STALE_MS)? */
function building(lock: string): boolean {
  try {
    if (Date.now() - statSync(lock).mtimeMs > STALE_MS) return false;
    const pid = Number(readFileSync(lock, "utf8"));
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Take the build lock for `file` (one process builds a version). A dead or stale holder's lock is taken over. */
function claim(lock: string): boolean {
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      if (building(lock)) return false;
      rmSync(lock, { force: true });
    }
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The window's replay for `version`, shared: a saved build of exactly it when there is one; else, when another process
 * is building it, that one (waited for up to `waitMs`); else replayed here (`replay`) and saved for the others.
 */
export async function sharedReplay(anchor: number, seasons: number[], version: string, replay: (anchor: number, seasons: number[]) => Promise<ForecasterParts>, o: { dir?: string | null; waitMs?: number } = {}): Promise<ForecasterParts> {
  const dir = o.dir === undefined ? shareDir() : o.dir;
  if (!dir) return replay(anchor, seasons);
  const file = buildFile(dir, anchor, seasons, version), lock = `${file}.building`;
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const loaded = (p: ForecasterParts, how: string) => { counts.loaded++; log(`ratings: ${anchor} loaded ${how} (${secs()})`); return p; };
  const have = loadBuild(file);
  if (have) return loaded(have, "the shared build");
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { counts.built++; return replay(anchor, seasons); }
  let mine = claim(lock);
  if (!mine) {
    counts.waited++;
    const until = Date.now() + (o.waitMs ?? WAIT_MS);
    while (Date.now() < until && building(lock)) {
      await sleep(POLL_MS);
      const theirs = loadBuild(file);
      if (theirs) return loaded(theirs, "the build another process made meanwhile");
    }
    const theirs = loadBuild(file);
    if (theirs) return loaded(theirs, "the build another process made meanwhile");
    mine = claim(lock);
  }
  try {
    const p = await replay(anchor, seasons);
    counts.built++;
    const saved = saveBuild(file, anchor, p);
    if (saved) counts.saved++;
    log(`ratings: ${anchor} built here${saved ? " and shared" : ""} (${secs()})`);
    return p;
  } finally {
    if (mine) rmSync(lock, { force: true });
  }
}
