// Clip coverage words shared by the event page, the owner console and the audit script (server/videos/coverage.ts).
import type { CoverageMatch } from "./api";

/** Q11, Q12, Q13, Q15, M1 → "Q11–Q13, Q15, M1": runs of one kind of match, sorted (qualifications first, then each other
 *  kind in the order it first appears), whatever order they were played in (a replayed Q2 after Q1). */
export function labelRanges(given: string[]): string {
  const kinds: string[] = [];
  for (const l of given) { const k = /^([A-Z]+)\d+$/.exec(l)?.[1] ?? ""; if (!kinds.includes(k)) kinds.push(k); }
  const rank = (l: string) => { const m = /^([A-Z]+)(\d+)$/.exec(l); return m ? [m[1] === "Q" ? -1 : kinds.indexOf(m[1]), Number(m[2])] : [kinds.indexOf(""), 0]; };
  const labels = [...given].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });
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
