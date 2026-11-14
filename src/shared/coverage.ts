// Clip coverage words shared by the event page, the owner console and the audit script (server/videos/coverage.ts).
import type { CoverageMatch } from "./api";

/** Q11, Q12, Q13, Q15, M1 → "Q11–Q13, Q15, M1": runs of one kind of match in order. */
export function labelRanges(labels: string[]): string {
  const out: string[] = [];
  let run: [string, number, number] | null = null;
  const flush = () => { if (run) out.push(run[1] === run[2] ? `${run[0]}${run[1]}` : `${run[0]}${run[1]}–${run[0]}${run[2]}`); run = null; };
  for (const l of labels) {
    const m = /^([A-Z]+)(\d+)$/.exec(l);
    if (m && run && run[0] === m[1] && run[2] + 1 === Number(m[2])) { run[2] = Number(m[2]); continue; }
    flush();
    if (m) run = [m[1], Number(m[2]), Number(m[2])];
    else out.push(l);
  }
  flush();
  return out.join(", ");
}

/** Matches without a clip grouped by their reason (and video), in the order they first appear. */
export function missingGroups(matches: CoverageMatch[]): { why: string; videoId: string | null; labels: string[] }[] {
  const by = new Map<string, { why: string; videoId: string | null; labels: string[] }>();
  for (const m of matches) {
    if (m.clip) continue;
    const k = `${m.videoId ?? ""}|${m.why ?? ""}`;
    (by.get(k) ?? by.set(k, { why: m.why ?? "No clip", videoId: m.videoId, labels: [] }).get(k)!).labels.push(m.label);
  }
  return [...by.values()];
}
