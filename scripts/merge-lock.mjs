#!/usr/bin/env node
// The one lock every merger to main takes (the main session's driver, the clip autopilot's merge step): each merge
// deploys and restarts the site, so two mergers that each see main quiet must never merge seconds apart.
//
// The lock is the ref refs/locks/merge, pointing at a commit of its own (no parent; no branch changes) whose message
// says who holds it and since when. GitHub refuses to create a ref that exists (422), so of two takers exactly one
// gets it. A lock held past LOCK_STALE_MS (its holder died before releasing) is removed and taken once more.
//
//   node scripts/merge-lock.mjs take <holder> <pr>   exit 0: taken; 3: held by another (its message on stdout);
//                                                    1: not taken (a bad argument, gh failing). Merge on exit 0 only.
//                                                    <pr> a PR number, or 0 for a run of merges (a driver's pass).
//   node scripts/merge-lock.mjs renew <holder>       restamps this holder's lock now (exit 0), so a hold longer than
//                                                    LOCK_STALE_MS isn't taken over; 3: not this holder's any more
//   node scripts/merge-lock.mjs release <holder>     removes it if this holder's (exit 0 either way, said on stderr)
//   node scripts/merge-lock.mjs status               prints the lock's message, or "free"
//
// Take it just before the last check of main, merge with --match-head-commit, and release it once the live site
// serves the merge (or the merge didn't happen); a holder merging several in a row renews it before each merge.
// Needs gh, signed in, in a checkout of the repository.
import { spawnSync } from "node:child_process";

export const LOCK_REF = "locks/merge";
export const LOCK_STALE_MS = 45 * 60_000;
const HOLDER = /^[\w.-]{1,40}$/;

/** The lock commit's message: "merge lock <ISO time> <holder> #<pr>". */
export const lockMessage = (holder, pr, now = Date.now()) => `merge lock ${new Date(now).toISOString()} ${holder} #${pr}`;
/** Who holds a lock and since when, from its message (null: not a lock's message). */
export function readLock(message) {
  const m = /^merge lock (\S+) (\S+) #(\d+)/.exec(String(message ?? "").trim());
  const at = m ? Date.parse(m[1]) : NaN;
  return m && Number.isFinite(at) ? { at, holder: m[2], pr: Number(m[3]) } : null;
}
/** A lock to remove: held past LOCK_STALE_MS, or a message that isn't a lock's (it would block every merger forever). */
export const lockStale = (message, now = Date.now(), staleMs = LOCK_STALE_MS) => {
  const l = readLock(message);
  return !l || now - l.at > staleMs;
};

const REPO = "repos/{owner}/{repo}";
function gh(args) {
  const r = spawnSync("gh", ["api", ...args], { encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}
/** The lock now: its commit's sha and message, or null when free. */
function current() {
  const ref = gh([`${REPO}/git/ref/${LOCK_REF}`, "--jq", ".object.sha"]);
  if (ref.code || !/^[0-9a-f]{40}$/.test(ref.out)) return null;
  const msg = gh([`${REPO}/git/commits/${ref.out}`, "--jq", ".message"]);
  return { sha: ref.out, message: msg.code ? "" : msg.out };
}
function create(sha) { return gh(["-X", "POST", `${REPO}/git/refs`, "-f", `ref=refs/${LOCK_REF}`, "-f", `sha=${sha}`]).code === 0; }

export function take(holder, pr, now = Date.now()) {
  if (!HOLDER.test(holder) || !/^\d+$/.test(String(pr))) throw new Error("take <holder> <pr>: a holder of letters, digits, . _ -; a PR number");
  const tree = gh([`${REPO}/commits/main`, "--jq", ".commit.tree.sha"]);
  if (tree.code) throw new Error(`main's tree couldn't be read: ${tree.err}`);
  const commit = gh(["-X", "POST", `${REPO}/git/commits`, "-f", `message=${lockMessage(holder, pr, now)}`, "-f", `tree=${tree.out}`, "--jq", ".sha"]);
  if (commit.code) throw new Error(`the lock's commit couldn't be made: ${commit.err}`);
  for (let tries = 0; tries < 2; tries++) {
    if (create(commit.out)) return { taken: true };
    const held = current();
    if (!held) continue;
    if (!lockStale(held.message, now)) return { taken: false, by: held.message };
    // Stale: removed only if it's still that same lock (another taker may have replaced it meanwhile).
    if (current()?.sha === held.sha) gh(["-X", "DELETE", `${REPO}/git/refs/${LOCK_REF}`]);
  }
  const held = current();
  return { taken: false, by: held?.message ?? "taken and released meanwhile" };
}
/** Restamps this holder's lock with the time now (a new commit, the ref moved to it): another holder's, or none, is
 *  left as it is. A taker seeing the lock in between sees it held (not stale), so no one else can take it meanwhile. */
export function renew(holder, now = Date.now()) {
  const held = current(), l = held && readLock(held.message);
  if (!l || l.holder !== holder) return { renewed: false, by: held?.message ?? "free" };
  const tree = gh([`${REPO}/git/commits/${held.sha}`, "--jq", ".tree.sha"]);
  if (tree.code) throw new Error(`the lock's tree couldn't be read: ${tree.err}`);
  const commit = gh(["-X", "POST", `${REPO}/git/commits`, "-f", `message=${lockMessage(holder, l.pr, now)}`, "-f", `tree=${tree.out}`, "--jq", ".sha"]);
  if (commit.code) throw new Error(`the renewed lock's commit couldn't be made: ${commit.err}`);
  // Only from the lock just read: a ref moved since (released, taken over) is left alone.
  if (current()?.sha !== held.sha) return { renewed: false, by: current()?.message ?? "free" };
  const r = gh(["-X", "PATCH", `${REPO}/git/refs/${LOCK_REF}`, "-f", `sha=${commit.out}`, "-F", "force=true"]);
  if (r.code) throw new Error(`the lock couldn't be renewed: ${r.err}`);
  return { renewed: true };
}
export function release(holder) {
  const held = current();
  if (!held) return "free already";
  const l = readLock(held.message);
  if (l?.holder !== holder) return `held by another (${held.message}): left`;
  return gh(["-X", "DELETE", `${REPO}/git/refs/${LOCK_REF}`]).code ? "couldn't be removed" : "released";
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${String(process.argv[1]).replace(/\\/g, "/")}`) {
  const [cmd, holder, pr] = process.argv.slice(2);
  try {
    if (cmd === "take") {
      const r = take(holder, pr);
      if (!r.taken) { console.log(`held: ${r.by}`); process.exit(3); }
      console.error(`taken by ${holder} for #${pr}`);
    } else if (cmd === "renew") {
      const r = renew(holder);
      if (!r.renewed) { console.log(`not ${holder}'s: ${r.by}`); process.exit(3); }
      console.error(`renewed for ${holder}`);
    } else if (cmd === "release") console.error(`${holder}: ${release(holder)}`);
    else if (cmd === "status") console.log(current()?.message ?? "free");
    else { console.error("merge-lock.mjs take <holder> <pr> | renew <holder> | release <holder> | status"); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
