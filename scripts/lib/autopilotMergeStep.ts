// The runner's merge step, its decisions without GitHub, git or the clock (scripts/clip-autopilot.ts calls them with
// those): whether main is quiet enough, which one of its own PRs merges this run, and whether the site serves it.

/** Why no merge now, or null: each merge deploys and restarts the site, so main's last commit must be `quietMs` old. */
export function mainQuiet(lastCommitMs: number, now: number, quietMs: number): string | null {
  if (!Number.isFinite(lastCommitMs)) return "main's last commit time couldn't be read";
  const age = now - lastCommitMs;
  return age >= quietMs ? null : `main's last commit is ${Math.round(age / 1000)} s old, under ${Math.round(quietMs / 1000)} s`;
}

/** Why not merge after all, or null, read again just before the merge: gating takes minutes, and a main that moved
 *  meanwhile (another merge) means the rows were checked against an old main and a second deploy within `quietMs`. */
export function mainStill(gatedOn: string, now: { sha: string; at: number }, nowMs: number, quietMs: number): string | null {
  if (now.sha !== gatedOn) return `main moved to ${now.sha.slice(0, 9)} since the gate read ${gatedOn.slice(0, 9)}`;
  return mainQuiet(now.at, nowMs, quietMs);
}

/** The PR this run merges, at most one: the first of `open` not rebuilt this run (its new head waits for a review),
 *  opened by this autopilot's GitHub user, whose gate passes. The gate runs only until one passes. A PR whose author or
 *  gate can't be read (gh, git, a malformed data file) waits, and the PRs after it are still checked. `passed`: each
 *  PR passed over, and why. The author check only leaves PRs opened from other accounts: the autopilot runs as the
 *  owner, so the gate is what keeps a merge safe. */
export function pickMerge(
  open: { number: number }[],
  o: { rebuilt: Set<number>; me: string; author: (pr: number) => string; gate: (pr: number) => { head: string; problems: string[] } },
): { pick: { number: number; head: string } | null; passed: string[] } {
  const passed: string[] = [];
  for (const { number } of open) {
    if (o.rebuilt.has(number)) { passed.push(`#${number} rebuilt this run: waits for its review`); continue; }
    let g: { head: string; problems: string[] };
    try {
      const author = o.author(number);
      if (author !== o.me) { passed.push(`#${number} is ${author}'s, not this autopilot's (${o.me}): left`); continue; }
      g = o.gate(number);
    } catch (e) {
      passed.push(`#${number} waits: its gate couldn't be read (${(e as Error).message})`);
      continue;
    }
    if (g.problems.length) { passed.push(`#${number} waits: ${g.problems.slice(0, 4).join("; ")}${g.problems.length > 4 ? ` (+${g.problems.length - 4})` : ""}`); continue; }
    return { pick: { number, head: g.head }, passed };
  }
  return { pick: null, passed };
}

/** Whether the site serves `merged`: /api/health says it's ready and its release is the merge commit or a main commit
 *  after it. null: nothing to judge yet (not JSON, no release, or not ready: the site restarting or down): ask again. */
export function servesMerge(health: string, merged: string, isAncestor: (older: string, newer: string) => boolean): boolean | null {
  let h: { release?: unknown; ready?: unknown };
  try { h = JSON.parse(health); } catch { return null; }
  const release = String(h?.release ?? "");
  if (!release || h.ready === false) return null;
  return release === merged || isAncestor(merged, release);
}
