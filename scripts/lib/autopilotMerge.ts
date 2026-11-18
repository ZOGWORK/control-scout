// The clip autopilot's merge gate: whether one of its own data PRs may be merged with nobody watching. Stricter than
// the checks a row passes to be opened (scripts/lib/autopilotRows.ts): anything a person should look at first (a live
// clip moved or dropped, a start that wasn't asked for, an edge read far from the recording's edge) stops the merge,
// and the PR waits for the owner's queue as before. Used by scripts/clip-autopilot.ts and
// scripts/autopilot-merge-check.ts (the same check on any PR, by hand).
import { EDGE_S, playableStarts, type FrameTiming } from "../../server/data/frameTimings.js";
import type { ClipCheck } from "../../server/data/clipChecks.js";
import { OPEN_LEADS, OPEN_LEADS_TEXT, leadText } from "./videoFrames.js";
import { rowKey, type Keyed } from "./autopilotRows.js";
import { clipCheckProblems } from "./autopilotClips.js";

/** How far a live start may move and still be the same start: the reader's reads land to the second, give or take. */
export const MOVE_S = 2;
/** Checks a PR needs, all passed, before a merge: fewer means CI didn't run in full. */
export const MIN_CHECKS = 5;

/** Rows the PR's file lost against its base (where it branched from main): never merged by the autopilot (a removal is
 *  the owner's call). Rows main gained since aren't the PR's: its merge keeps them. */
function removed(next: Keyed[], live: Keyed[]): string[] {
  const keys = new Set(next.map(rowKey));
  return live.filter((r) => !keys.has(rowKey(r))).map((r) => `${rowKey(r)}: row removed`);
}
/** The rows of `next` that aren't byte-for-byte its base's: the PR's own change. */
const changed = <T extends Keyed>(next: T[], live: T[]) => {
  const was = new Map(live.map((r) => [rowKey(r), JSON.stringify(r)]));
  return next.filter((r) => was.get(rowKey(r)) !== JSON.stringify(r));
};

/** The groups a match label is ordered in, and its place in each: quals by number; a best-of-three semifinal series (up
 *  to 2023: "M1", "M1-2" its second game) by game within its series; a double-elimination bracket (2024 on) by match
 *  number, a replay ("M6-2") only after its own match (it can come after later matches); finals by game. None: a label
 *  of no group (left unchecked). */
export function labelPlaces(season: number, label: string): { group: string; place: number }[] {
  let m = /^Q(\d+)$/.exec(label);
  if (m) return [{ group: "quals", place: Number(m[1]) }];
  m = /^M(\d+)(?:-(\d+))?$/.exec(label);
  if (m) {
    const n = Number(m[1]), g = Number(m[2] ?? 1);
    if (season <= 2023) return [{ group: `semifinal ${n}`, place: g }];
    return [...(g === 1 ? [{ group: "bracket", place: n }] : []), { group: `bracket M${n}`, place: g }];
  }
  m = /^F(\d+)$/.exec(label);
  if (m) return [{ group: "finals", place: Number(m[1]) }];
  return [];
}

/** Starts out of order within a group: a match that comes later in its group starting at or before an earlier one. */
export function orderProblems(season: number, starts: Record<string, number>): string[] {
  const groups = new Map<string, { label: string; place: number; t: number }[]>();
  for (const [label, t] of Object.entries(starts)) {
    for (const p of labelPlaces(season, label)) (groups.get(p.group) ?? groups.set(p.group, []).get(p.group)!).push({ label, place: p.place, t });
  }
  const out: string[] = [];
  for (const [group, list] of groups) {
    list.sort((a, b) => a.place - b.place);
    for (let i = 1; i < list.length; i++) if (!(list[i].t > list[i - 1].t)) out.push(`${list[i].label} starts at ${list[i].t}, not after ${list[i - 1].label} (${list[i - 1].t}) in ${group}`);
  }
  return out;
}

/** What stops the autopilot merging a frame-read PR: its season file (`next`), its change measured against `base` (the
 *  file where it branched), each changed row checked against main's now (`live`). `filed`: every video filed in a
 *  season's file on main, and that season. Empty: it may merge. */
export function frameMergeProblems(season: number, next: FrameTiming[], base: FrameTiming[], live: FrameTiming[], filed: Map<string, number>): string[] {
  const out = removed(next, base);
  const liveBy = new Map(live.map((r) => [rowKey(r), r]));
  for (const r of changed(next, base)) {
    const key = rowKey(r), was = liveBy.get(key);
    const other = filed.get(r.videoId);
    if (other != null && other !== season) out.push(`${key}: video already filed under ${other}`);
    // A live clip stays where it is: moved more than a read's second, or gone, is the owner's to look at.
    for (const [l, t] of Object.entries(was?.starts ?? {})) {
      if (r.starts[l] == null) out.push(`${key}: live ${l} dropped`);
      else if (Math.abs(r.starts[l] - t) > MOVE_S) out.push(`${key}: live ${l} moved ${t} → ${r.starts[l]}`);
    }
    // Every clip the site plays now still plays: once a row has any openings, a start without one stops playing
    // (playableStarts), so a row gaining its first openings can unship the rest of its clips without moving a start.
    if (was) {
      const after = playableStarts(r);
      for (const l of Object.keys(playableStarts(was))) if (after[l] == null && r.starts[l] != null) out.push(`${key}: live clip ${l} would stop playing`);
    }
    // A start the live row didn't have comes from one it lacked or held back: missing, or for review. A new row has none.
    if (was) for (const l of Object.keys(r.starts)) if (was.starts[l] == null && was.missing?.[l] == null && was.review?.[l] == null) out.push(`${key}: new start ${l} wasn't missing or for review`);
    for (const [l, t] of Object.entries(r.starts)) {
      const o = r.opens?.[l];
      if (o != null && !OPEN_LEADS.includes(t - o)) out.push(`${key}: ${l} opens ${leadText(t - o)}, not ${OPEN_LEADS_TEXT}`);
    }
    // An edge read far inside the recording proves nothing about what's outside it unless every frame between was clear.
    if (r.opensOn && !r.opensOn.clear && r.opensOn.at > EDGE_S) out.push(`${key}: opening edge read at ${r.opensOn.at} s, beyond ${EDGE_S} s and not clear`);
    if (r.endsOn && !r.endsOn.clear && (r.endsOn.fromEnd ?? 0) > EDGE_S) out.push(`${key}: end edge read ${r.endsOn.fromEnd} s from the end, beyond ${EDGE_S} s and not clear`);
    out.push(...orderProblems(season, r.starts).map((p) => `${key}: ${p}`));
  }
  return out;
}

/** What stops the autopilot merging a first-frame sweep PR: no row removed against its base, and every row it changed
 *  keeps the sweep's rules against main's now (clipCheckProblems: pulled only on a frame naming another match, what
 *  main settled kept). */
export function clipsMergeProblems(next: ClipCheck[], base: ClipCheck[], live: ClipCheck[]): string[] {
  const liveBy = new Map(live.map((r) => [rowKey(r), r]));
  return [...removed(next, base), ...changed(next, base).flatMap((r) => clipCheckProblems(r, liveBy.get(rowKey(r))).map((p) => `${rowKey(r)}: ${p}`))];
}

/** Loopy's own GitHub account: the only author whose summary counts. The repository is public, so anyone can post a
 *  comment that looks like a 5/5 summary, even from an account named like it. */
export const LOOPY_LOGIN = "loopyreviews-bot[bot]";
/** A PR conversation comment as GitHub's REST API reports it (the fields the gate reads). */
export interface IssueComment { user: { login: string | null; type: string | null } | null; body: string | null; updated_at: string }
/** Loopy's latest summary among a PR's comments: only by its bot account, carrying its summary mark; of those the
 *  last updated (it edits its summary in place). null: none. */
export function loopySummary(comments: IssueComment[]): string | null {
  const mine = comments.filter((c) => c.user?.login === LOOPY_LOGIN && c.user.type === "Bot" && (c.body ?? "").includes("loopy:summary"));
  return mine.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1)?.body ?? null;
}
/** The head Loopy's summary says it last reviewed (a short or full sha); null: none named. */
export const reviewedSha = (loopy: string | null) => /last reviewed `([0-9a-f]{7,40})`/.exec(loopy ?? "")?.[1] ?? null;

/** A PR's review and checks as GitHub reports them. `loopy`: Loopy's latest summary comment's body. */
export interface PrState { head: string; loopy: string | null; checks: { name: string; state: string }[] }

/** What stops a merge on the PR's review and checks: Loopy's latest summary says 5/5 for this exact head, and every
 *  check (at least MIN_CHECKS) passed. */
export function readyProblems(pr: PrState): string[] {
  const out: string[] = [];
  const conf = /Confidence: (\d)\/5/.exec(pr.loopy ?? "")?.[1], sha = reviewedSha(pr.loopy);
  if (!pr.loopy) out.push("no Loopy review");
  else {
    if (conf !== "5") out.push(`Loopy ${conf ?? "?"}/5, not 5/5`);
    if (!sha || !pr.head.startsWith(sha)) out.push(`Loopy reviewed ${sha ?? "no head"}, not the head ${pr.head.slice(0, 7)}`);
  }
  if (pr.checks.length < MIN_CHECKS) out.push(`${pr.checks.length} checks, fewer than ${MIN_CHECKS}`);
  const notPassed = pr.checks.filter((c) => c.state !== "SUCCESS");
  if (notPassed.length) out.push(`checks not passed: ${notPassed.map((c) => `${c.name} ${c.state}`).join(", ")}`);
  return out;
}

/** The release files a data PR opened before 2026-11-17 carried (a version and a CHANGELOG entry): data PRs carry none
 *  now (owner's rule), so there's no version to check, only these to be gone. */
export const RELEASE_FILES = ["CHANGELOG.md", "package.json", "package-lock.json"];
/** What a data PR's files stop: it changes its own data file only. A release file left from before waits for the
 *  runner's rebuild, which puts it back to main's (needsRebuild); any other file is a person's change. */
export function fileProblems(paths: string[], file: string): string[] {
  const release = paths.filter((p) => RELEASE_FILES.includes(p)), others = paths.filter((p) => p !== file && !RELEASE_FILES.includes(p));
  return [
    ...(release.length ? [`still carries ${release.join(", ")} (data PRs carry no version or CHANGELOG): rebuilt without on the next run`] : []),
    ...(others.length ? [`changes more than its data file: ${others.join(", ")}`] : []),
    ...(paths.includes(file) ? [] : [`doesn't change its data file ${file}`]),
  ];
}
