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

/** An autopilot PR and what stops its merge (none: it may merge), against `main` (a ref, fetched). */
export function prGate(number: number, main = "origin/main"): Gate {
  const pr = JSON.parse(gh("pr", "view", String(number), "--json", "state,isDraft,mergeable,headRefOid,headRefName,body,files,statusCheckRollup"));
  const problems: string[] = [];
  const mark = readMarker(String(pr.body ?? ""));
  if (pr.state !== "OPEN") problems.push(`${pr.state.toLowerCase()}, not open`);
  if (pr.isDraft) problems.push("a draft");
  // Only a merge GitHub has worked out as clean: UNKNOWN (still computing, just after a push or a main move) waits.
  if (pr.mergeable === "CONFLICTING") problems.push("conflicts with main");
  else if (pr.mergeable !== "MERGEABLE") problems.push(`mergeability ${String(pr.mergeable).toLowerCase()}, not worked out yet`);
  if (!String(pr.headRefName ?? "").startsWith(BRANCH)) problems.push(`branch ${pr.headRefName}, not the autopilot's (${BRANCH}…)`);
  if (!mark) return { number, head: pr.headRefOid, file: "", problems: [...problems, "no autopilot mark"] };
  const file = mark.file ?? seasonFile(mark.season), head = String(pr.headRefOid);
  // The mark is the PR body's: it may name only the autopilot's own data files, never one the gate can't read rows from.
  if (file !== CLIPS_FILE && file !== seasonFile(mark.season)) return { number, head, file, problems: [...problems, `its mark names ${file}, not ${seasonFile(mark.season)} or ${CLIPS_FILE}`] };
  git("fetch", "--quiet", "origin", head);
  // Only its data file and its release: anything else is a person's change.
  // Its data file only (owner's rule, 2026-11-17: no CHANGELOG, no version, so nothing to renumber). A PR opened before
  // still carries a release: the runner's next rebuild puts those files back to main's.
  const others = (pr.files as { path: string }[]).map((f) => f.path).filter((p) => p !== file);
  if (others.length) problems.push(`changes more than its data file: ${others.join(", ")}`);
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
