#!/usr/bin/env node
// The one lock every merger to main takes (the main session's driver, the clip autopilot's merge step): each merge
// deploys and restarts the site, so two mergers that each see main quiet must never merge seconds apart.
//
// The lock is the ref refs/locks/merge, pointing at a commit of its own (no parent; no branch changes) whose message
// says who holds it and since when. Every change to it is one step on GitHub (GraphQL updateRefs, `cas`), made only
// while the ref points where it was read: taking creates it only where it isn't, so of two takers exactly one gets
// it; a lock held past LOCK_STALE_MS (its holder died before releasing) is taken over only from that very lock; renew
// and release change only the lock just read, never a newer one.
// Anything it can't read (the ref, its message) is an error (exit 1), never "free" or "stale".
//
//   node scripts/merge-lock.mjs take <holder> <pr>   exit 0: taken; 3: held by another (its message on stdout);
//                                                    1: not taken (a bad argument, gh failing). Merge on exit 0 only.
//                                                    <pr> a PR number, or 0 for a run of merges (a driver's pass).
//   node scripts/merge-lock.mjs renew <holder>       restamps this holder's lock now (exit 0), so a hold longer than
//                                                    LOCK_STALE_MS isn't taken over; 3: not this holder's any more
//   node scripts/merge-lock.mjs release <holder>     removes it if this holder's (exit 0, said on stderr; 1: GitHub
//                                                    didn't remove it, or the lock couldn't be read)
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
/** The lock now: its commit's sha and message, or null when free (GitHub says the ref isn't there). Anything it
 *  can't read throws: a lock whose message wasn't read is never taken for a stale one, nor a failed read for "free". */
function current() {
  const ref = gh([`${REPO}/git/ref/${LOCK_REF}`, "--jq", ".object.sha"]);
  if (ref.code) {
    if (/Not Found|HTTP 404/i.test(ref.err)) return null;
    throw new Error(`the lock couldn't be read: ${ref.err}`);
  }
  if (!/^[0-9a-f]{40}$/.test(ref.out)) throw new Error(`the lock's ref reads ${JSON.stringify(ref.out)}, not a commit`);
  const msg = gh([`${REPO}/git/commits/${ref.out}`, "--jq", ".message"]);
  if (msg.code) throw new Error(`the lock's message couldn't be read: ${msg.err}`);
  return { sha: ref.out, message: msg.out };
}
const ABSENT = "0".repeat(40);
let repoId = "";
/** Moves the lock from `before` to `after` in one step (GitHub's updateRefs: the ref must point at `before` when it's
 *  made, ABSENT for "not there", and `after` ABSENT deletes it), or nothing at all. True when GitHub made it. */
function cas(before, after) {
  if (!repoId) {
    const r = gh(["graphql", "-f", "query=query($o:String!,$n:String!){repository(owner:$o,name:$n){id}}", "-F", "o={owner}", "-F", "n={repo}", "--jq", ".data.repository.id"]);
    if (r.code || !r.out) throw new Error(`the repository's id couldn't be read: ${r.err}`);
    repoId = r.out;
  }
  const q = "mutation($r:ID!,$b:GitObjectID!,$a:GitObjectID!){updateRefs(input:{repositoryId:$r,refUpdates:[{name:\"refs/" + LOCK_REF + "\",beforeOid:$b,afterOid:$a,force:true}]}){clientMutationId}}";
  const r = gh(["graphql", "-f", `query=${q}`, "-f", `r=${repoId}`, "-f", `b=${before}`, "-f", `a=${after}`]);
  return r.code === 0 && !/"errors"/.test(r.out);
}
/** A lock commit: `message` on main's tree, no parent (no branch's history). */
function lockCommit(message) {
  const tree = gh([`${REPO}/commits/main`, "--jq", ".commit.tree.sha"]);
  if (tree.code) throw new Error(`main's tree couldn't be read: ${tree.err}`);
  const commit = gh(["-X", "POST", `${REPO}/git/commits`, "-f", `message=${message}`, "-f", `tree=${tree.out}`, "--jq", ".sha"]);
  if (commit.code) throw new Error(`the lock's commit couldn't be made: ${commit.err}`);
  return commit.out;
}

export function take(holder, pr, now = Date.now()) {
  if (!HOLDER.test(holder) || !/^\d+$/.test(String(pr))) throw new Error("take <holder> <pr>: a holder of letters, digits, . _ -; a PR number");
  const mine = lockCommit(lockMessage(holder, pr, now));
  for (let tries = 0; tries < 3; tries++) {
    // Free: made only if it's still not there (of two takers, one).
    if (cas(ABSENT, mine)) return { taken: true };
    const held = current();
    if (!held) continue; // released between: try again
    if (!lockStale(held.message, now)) return { taken: false, by: held.message };
    // Stale (its holder died before releasing): taken over only from that very lock, never a newer one.
    if (cas(held.sha, mine)) return { taken: true };
  }
  return { taken: false, by: current()?.message ?? "taken and released meanwhile" };
}
/** Restamps this holder's lock with the time now, only from the lock just read (cas): another holder's, or none, is
 *  left as it is. A taker seeing the lock meanwhile sees it held (not stale), so no one else takes it. */
export function renew(holder, now = Date.now()) {
  const held = current(), l = held && readLock(held.message);
  if (!l || l.holder !== holder) return { renewed: false, by: held?.message ?? "free" };
  if (cas(held.sha, lockCommit(lockMessage(holder, l.pr, now)))) return { renewed: true };
  return { renewed: false, by: current()?.message ?? "free" };
}
/** Removes this holder's lock, only the lock just read (cas): "released", "free already", or "held by another (…):
 *  left". A remove GitHub refused with the lock still this holder's throws (the CLI exits 1): a caller never takes a
 *  lock still there for released. */
export function release(holder) {
  const held = current();
  if (!held) return "free already";
  const l = readLock(held.message);
  if (l?.holder !== holder) return `held by another (${held.message}): left`;
  if (cas(held.sha, ABSENT)) return "released";
  const now = current();
  if (now?.sha !== held.sha) return now ? `held by another (${now.message}): left` : "free already";
  throw new Error("the lock couldn't be removed");
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
