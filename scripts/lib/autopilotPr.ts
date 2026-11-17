// An autopilot data PR read from GitHub, and everything that stops its merge (scripts/lib/autopilotMerge.ts holds the
// rules): its own mark, the files it changes (its data file only), its rows against main's, Loopy and its checks.
// Shared by the runner's merge step (scripts/clip-autopilot.ts) and the by-hand check (scripts/autopilot-merge-check.ts).
import { spawnSync } from "node:child_process";
import { dataRows } from "./videoFrames.js";
import { readMarker } from "./autopilotRows.js";
import { clipsMergeProblems, frameMergeProblems, readyProblems } from "./autopilotMerge.js";
import type { FrameTiming } from "../../server/data/frameTimings.js";
import type { ClipCheck } from "../../server/data/clipChecks.js";

export const CLIPS_FILE = "server/data/clipChecks.ts";
export const seasonFile = (season: number) => `server/data/frameTimings/${season}.ts`;
/** The branch every autopilot PR is opened from (scripts/clip-autopilot.ts). */
export const BRANCH = "clip-autopilot/";

/** A command's output; throws with its last lines on failure. */
function out(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: 300_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-2).join(" | ")}`);
  return r.stdout;
}
const gh = (...a: string[]) => out("gh", a);
const git = (...a: string[]) => out("git", a);

/** Every video filed in a season file on `ref`, and its season. */
function filedVideos(ref: string): Map<string, number> {
  const filed = new Map<string, number>();
  for (const path of git("ls-tree", "--name-only", ref, "server/data/frameTimings/").split("\n")) {
    const season = Number(/(\d{4})\.ts$/.exec(path.trim())?.[1]);
    if (!season) continue;
    for (const r of dataRows<FrameTiming>(git("show", `${ref}:${path.trim()}`))) filed.set(r.videoId, season);
  }
  return filed;
}

export interface Gate { number: number; head: string; file: string; problems: string[] }

/** A PR as `gh pr view --json` reports it: the fields the gate reads. */
export interface PrView { state: string; isDraft: boolean; mergeable: string; headRefName: string; body: string; files: { path: string; changeType?: string }[] }

/** What stops a merge in the PR's own shape, from GitHub's facts alone: open, not a draft, mergeability worked out
 *  clean (UNKNOWN, still computing just after a push or a main move, waits), the autopilot's branch, its mark naming
 *  one of its own data files (the mark is the PR body's: never a file the gate can't read rows from), and that file the
 *  only one it changes (owner's rule, 2026-11-17: no CHANGELOG, no version). `file`: "" without such a mark. */
export function shapeProblems(pr: PrView): { mark: ReturnType<typeof readMarker>; file: string; problems: string[] } {
  const problems: string[] = [];
  if (pr.state !== "OPEN") problems.push(`${pr.state.toLowerCase()}, not open`);
  if (pr.isDraft) problems.push("a draft");
  if (pr.mergeable === "CONFLICTING") problems.push("conflicts with main");
  else if (pr.mergeable !== "MERGEABLE") problems.push(`mergeability ${String(pr.mergeable).toLowerCase()}, not worked out yet`);
  if (!String(pr.headRefName ?? "").startsWith(BRANCH)) problems.push(`branch ${pr.headRefName}, not the autopilot's (${BRANCH}…)`);
  const mark = readMarker(String(pr.body ?? ""));
  if (!mark) return { mark, file: "", problems: [...problems, "no autopilot mark"] };
  const file = mark.file ?? seasonFile(mark.season);
  if (file !== CLIPS_FILE && file !== seasonFile(mark.season)) return { mark, file: "", problems: [...problems, `its mark names ${file}, not ${seasonFile(mark.season)} or ${CLIPS_FILE}`] };
  // A PR opened before the rule still carries a release: the runner's next rebuild puts those files back to main's.
  const others = pr.files.map((f) => f.path).filter((p) => p !== file);
  if (others.length) problems.push(`changes more than its data file: ${others.join(", ")}`);
  // Its data file changed in place: a rename (one path listed, e.g. 2025.ts to 2024.ts), an add or a delete is a
  // person's change. A PR changing nothing has nothing to merge.
  const own = pr.files.find((f) => f.path === file);
  if (!own) problems.push(`doesn't change ${file}`);
  // Fails closed: a file whose change GitHub didn't name isn't known to be changed in place.
  else if (!own.changeType) problems.push(`${file}: no change type from GitHub, not known to be changed in place`);
  else if (own.changeType !== "MODIFIED") problems.push(`${file} ${own.changeType.toLowerCase()}, not changed in place`);
  return { mark, file, problems };
}

/** An autopilot PR and what stops its merge (none: it may merge), against `main` (a ref, fetched). */
export function prGate(number: number, main = "origin/main"): Gate {
  const pr = JSON.parse(gh("pr", "view", String(number), "--json", "state,isDraft,mergeable,headRefOid,headRefName,body,files,statusCheckRollup"));
  const head = String(pr.headRefOid), shape = shapeProblems(pr);
  const { mark, file } = shape, problems = [...shape.problems];
  // Without its own mark and data file there are no rows to check.
  if (!mark || !file) return { number, head, file, problems };
  git("fetch", "--quiet", "origin", head);
  // The PR's own change: against where it branched (rows main gained since aren't its); each row checked against main's now.
  const base = git("merge-base", head, main).trim();
  const next = git("show", `${head}:${file}`), was = git("show", `${base}:${file}`), live = git("show", `${main}:${file}`);
  problems.push(...(file === CLIPS_FILE
    ? clipsMergeProblems(dataRows<ClipCheck>(next), dataRows<ClipCheck>(was), dataRows<ClipCheck>(live))
    : frameMergeProblems(mark.season, dataRows<FrameTiming>(next), dataRows<FrameTiming>(was), dataRows<FrameTiming>(live), filedVideos(main))));
  // Loopy's latest summary (it edits one comment in place), and every check: a check run's conclusion, a status's state.
  const loopy = gh("api", `repos/{owner}/{repo}/issues/${number}/comments`, "--paginate", "--jq", ".[] | select(.user.login | test(\"loopy\"; \"i\")) | select(.body | test(\"loopy:summary\")) | .body | @json")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as string).at(-1) ?? null;
  const checks = (pr.statusCheckRollup as { name?: string; context?: string; conclusion?: string; state?: string }[])
    .map((c) => ({ name: String(c.name ?? c.context ?? "?"), state: String(c.conclusion || c.state || "PENDING") }));
  problems.push(...readyProblems({ head, loopy, checks }));
  return { number, head, file, problems };
}
