// Clip coverage words shared by the event page, the owner console and the audit script (server/videos/coverage.ts).
import type { CoverageMatch, CoverageTriage } from "./api";

/** Q11, Q12, Q13, Q15, M1 → "Q11–Q13, Q15, M1": runs of one kind of match, sorted (qualifications first, then each other
 *  kind in the order it first appears), whatever order they were played in (a replayed Q2 after Q1). A replay ("M6-2",
 *  "SF1-1") sorts right after its match and stands on its own: it never joins or ends a run. */
const LABEL = /^([A-Z]+)(\d+)(?:-(\d+))?$/;
export function labelRanges(given: string[]): string {
  const kinds: string[] = [];
  for (const l of given) { const k = LABEL.exec(l)?.[1] ?? ""; if (!kinds.includes(k)) kinds.push(k); }
  const rank = (l: string) => {
    const m = LABEL.exec(l);
    return m ? [m[1] === "Q" ? -1 : kinds.indexOf(m[1]), Number(m[2]), m[3] == null ? 0 : Number(m[3])] : [kinds.indexOf(""), 0, 0];
  };
  const labels = [...given].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  const out: string[] = [];
  let run: [string, number, number] | null = null;
  const flush = () => { if (run) out.push(run[1] === run[2] ? `${run[0]}${run[1]}` : `${run[0]}${run[1]}–${run[0]}${run[2]}`); run = null; };
  for (const l of labels) {
    const m = LABEL.exec(l);
    const plain = m && m[3] == null;
    if (plain && run && run[0] === m[1] && run[2] + 1 === Number(m[2])) { run[2] = Number(m[2]); continue; }
    flush();
    if (plain) run = [m[1], Number(m[2]), Number(m[2])];
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

/** Owner › Clip coverage triage categories (server/videos/coverageTriage.ts), in the order shown: names and one line
 *  each on what lands there. Only Actionable is "To review". */
export const TRIAGE_ORDER = ["actionable", "unchecked", "no-timing", "early-start", "old-season"] as const satisfies readonly CoverageTriage[];
export const TRIAGE_LABEL: Record<CoverageTriage, string> = {
  actionable: "Actionable",
  unchecked: "Not yet checked against the video",
  "no-timing": "No timing",
  "early-start": "Early start / unsafe",
  "old-season": "Old season",
};
export const TRIAGE_ABOUT: Record<CoverageTriage, string> = {
  actionable: "Checked against the video itself (its frames read) and still without a clip, or no reason found: each says what was checked in the video and what was missing there.",
  unchecked: "Left out by the clock alone, and the video hasn't been checked for them yet: a pending check, not a reason. Never marked reviewed; each moves to To review, or settles, once its video's frames are read.",
  "no-timing": "Nothing to place a clip from: no clock, video unavailable, shorter than its broadcast with nothing to place the gap, no real start from FIRST, or no recording that day.",
  "early-start": "Checked in the video: each starts while the match before is still on, so a clip would open on the wrong match.",
  "old-season": "Older than last season, and nothing actionable.",
};
