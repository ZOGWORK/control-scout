// The runner's merge step, its decisions without GitHub, git or the clock (scripts/clip-autopilot.ts calls them with
// those): whether main is quiet enough, which one of its own PRs merges this run, and whether the site serves it.

/** Why no merge now, or null: each merge deploys and restarts the site, so main's last commit must be `quietMs` old. */
export function mainQuiet(lastCommitMs: number, now: number, quietMs: number): string | null {
  if (!Number.isFinite(lastCommitMs)) return "main's last commit time couldn't be read";
  const age = now - lastCommitMs;
  return age >= quietMs ? null : `main's last commit is ${Math.round(age / 1000)} s old, under ${Math.round(quietMs / 1000)} s`;
}

/** The PR this run merges, at most one: the first of `open` not rebuilt this run (its new head waits for a review),
 *  opened by this autopilot's own GitHub user, whose gate passes. The gate runs only until one passes. `passed`: each PR
 *  passed over, and why. */
export function pickMerge(
  open: { number: number }[],
  o: { rebuilt: Set<number>; me: string; author: (pr: number) => string; gate: (pr: number) => { head: string; problems: string[] } },
): { pick: { number: number; head: string } | null; passed: string[] } {
  const passed: string[] = [];
  for (const { number } of open) {
    if (o.rebuilt.has(number)) { passed.push(`#${number} rebuilt this run: waits for its review`); continue; }
    const author = o.author(number);
    if (author !== o.me) { passed.push(`#${number} is ${author}'s, not this autopilot's (${o.me}): left`); continue; }
    const g = o.gate(number);
    if (g.problems.length) { passed.push(`#${number} waits: ${g.problems.slice(0, 4).join("; ")}${g.problems.length > 4 ? ` (+${g.problems.length - 4})` : ""}`); continue; }
    return { pick: { number, head: g.head }, passed };
  }
  return { pick: null, passed };
}

/** Whether the site serves `merged`: /api/health's release is the merge commit or a main commit after it. null: no
 *  release read from the body (the site restarting, or down): ask again. */
export function servesMerge(health: string, merged: string, isAncestor: (older: string, newer: string) => boolean): boolean | null {
  let release = "";
  try { release = String(JSON.parse(health).release ?? ""); } catch { return null; }
  if (!release) return null;
  return release === merged || isAncestor(merged, release);
}
