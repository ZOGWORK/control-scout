// The clip autopilot's merge gate on any of its PRs, by hand: what stops the runner merging it (scripts/lib/autopilotPr.ts,
// rules in scripts/lib/autopilotMerge.ts). Reads GitHub and git only; changes nothing.
//
//   npx tsx scripts/autopilot-merge-check.ts 1717 [1719 …]
//   exit 0: every PR named may merge; 1: one or more may not (each reason printed).
import { spawnSync } from "node:child_process";
import { prGate } from "./lib/autopilotPr";

const prs = process.argv.slice(2).map(Number);
if (!prs.length || prs.some((n) => !Number.isInteger(n) || n < 1)) { console.error("give PR numbers: npx tsx scripts/autopilot-merge-check.ts 1717 1719"); process.exit(2); }
// Against main as it is now, or not at all: a stale origin/main could pass a PR main has since outdated.
if (spawnSync("git", ["fetch", "--quiet", "origin", "main"], { stdio: "inherit" }).status !== 0) { console.error("git fetch origin main failed: nothing checked"); process.exit(2); }
let blocked = 0;
for (const n of prs) {
  try {
    const g = prGate(n);
    if (g.problems.length) blocked++;
    console.log(`#${n} ${g.head.slice(0, 7)} ${g.file} ${g.version}: ${g.problems.length ? "may NOT merge" : "may merge"}`);
    for (const p of g.problems) console.log(`  - ${p}`);
  } catch (e) {
    blocked++;
    console.log(`#${n}: couldn't be checked (${(e as Error).message})`);
  }
}
process.exit(blocked ? 1 : 0);
