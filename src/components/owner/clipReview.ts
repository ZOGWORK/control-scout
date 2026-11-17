// Owner console › Clip coverage, read at a glance: every missing match sorted into one of a few kinds, each with its
// colour (lib/textTones SEARCH_PALETTE swatches, the app's tile colours), a short name for its chip, and one plain line
// on what it means. Worked out here from what the coverage list already sends (CoverageMatch's reason and video check,
// the pass log's `why` keys from server/videos/coverageCheck.ts videoState), so the server's words stay its own.
import type { CoverageFinding, CoverageMatch, CoverageReason } from "../../shared/api";
import { SEARCH_PALETTE } from "../../lib/textTones";

export type MissKind = "seen" | "pulled" | "early" | "unchecked" | "notfound" | "noclock" | "unplaced" | "outside" | "unavailable" | "novideo" | "other";

const P = SEARCH_PALETTE;
/** In the order shown: the ones to act on first. */
export const MISS_KINDS: { kind: MissKind; name: string; about: string; swatch: (typeof P)[keyof typeof P] }[] = [
  { kind: "seen", name: "Seen, no clip", about: "The video shows this match, but it has no clip yet", swatch: P.winning },
  { kind: "pulled", name: "Clip pulled", about: "Its clip opened on another match, so it was taken down", swatch: P.pen },
  { kind: "notfound", name: "Not found", about: "The video's frames were read and its start wasn't found", swatch: P.finished },
  { kind: "unchecked", name: "Not checked", about: "The video's frames haven't been read for it yet", swatch: P.upcoming },
  { kind: "early", name: "Starts early", about: "It starts while the match before is still on, so a clip would open on the wrong match", swatch: P.finalist },
  { kind: "noclock", name: "No clock", about: "The video has no broadcast clock to place it from", swatch: P.endgame },
  { kind: "unplaced", name: "Unplaced", about: "The video is missing time, so where it is can't be worked out", swatch: P.auto },
  { kind: "outside", name: "Outside video", about: "Played outside the time the video covers", swatch: P.reference },
  { kind: "unavailable", name: "Unavailable", about: "The video is private or gone", swatch: P.no },
  { kind: "novideo", name: "No video", about: "No recording covers it", swatch: P.judged },
  { kind: "other", name: "Other", about: "No start time to place it from, or no reason found", swatch: P.performance },
];
export const KIND = Object.fromEntries(MISS_KINDS.map((k) => [k.kind, k])) as Record<MissKind, (typeof MISS_KINDS)[number]>;

const BY_REASON: Record<CoverageReason, MissKind> = {
  "no-clock": "noclock", "video-unread": "noclock",
  "gap-unplaced": "unplaced", "between-recordings": "unplaced",
  "video-unavailable": "unavailable",
  "no-recording-day": "novideo", "no-first-video": "novideo",
  "outside-span": "outside", "before-broadcast": "outside", "after-broadcast": "outside", "before-cut": "outside",
  "past-video-end": "outside", "past-chapters": "outside", "before-chapters": "outside", "past-checked": "outside",
  "overlaps-previous": "early",
  "no-start": "other", "no-zone": "other", unexplained: "other",
};

/** One missing match's kind: a pulled clip first, then what its video's frames showed, else its reason. */
export function kindOf(m: CoverageMatch, pulled = false): MissKind {
  if (pulled) return "pulled";
  const v = m.video;
  if (v) {
    if (v.outside) return "outside";
    if (v.seenAt != null) return "seen";
    if (v.earlyStart) return "early";
    return v.checked ? "notfound" : "unchecked";
  }
  return m.reason ? BY_REASON[m.reason] ?? "other" : "other";
}

/** The pass log's breakdown key (videoState: a video check in words, or a reason) as a kind. */
export function kindOfWhy(key: string): MissKind {
  if (/^seen in the video/.test(key)) return "seen";
  if (/^starts inside the match before/.test(key)) return "early";
  if (/^not yet checked/.test(key)) return "unchecked";
  if (/^checked in the video/.test(key)) return "notfound";
  return BY_REASON[key as CoverageReason] ?? "other";
}

/** The pass log's breakdown, summed by kind, largest first. */
export function kindTotals(why: Record<string, number>): { kind: MissKind; n: number }[] {
  const sum = new Map<MissKind, number>();
  for (const [k, x] of Object.entries(why)) sum.set(kindOfWhy(k), (sum.get(kindOfWhy(k)) ?? 0) + x);
  return [...sum].map(([kind, n]) => ({ kind, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
}

/** The second to open a missing match's video at: the frame a finding names, else where its video check saw it start,
 *  else the nearest match the frames placed around it; null: nothing better than the video's start. */
export function secondOf(m: CoverageMatch, finding?: CoverageFinding): number | null {
  const v = m.video;
  return finding?.at ?? v?.seenAt ?? v?.earlyStart?.t ?? v?.before?.at ?? v?.after?.at ?? null;
}

/** 10440 → "2:54:00". */
export const hms = (s: number) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
