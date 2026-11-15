// Clock-placed clips checked by their opening frame (scripts/clip-checks.ts). Owner decision 2026-11-15 ("New clips +
// verify old"): every clip placed from YouTube's facts stays live while a background sweep reads the overlay of its
// first frame. One whose first frame names another match is pulled (never served) and is an owner-console finding; one
// whose first frame names nothing (blank, a transition, a cutaway) is unconfirmed and read again, never pulled; a video
// whose overlay can't be read anywhere (older seasons' layouts) can't be checked by frame, and is counted, not pulled.
// Frame-placed clips are checked when they're placed (server/data/frameTimings.ts `opens`), not here.

export interface ClipCheck {
  videoId: string;
  /** The event the matches are of. */
  code: string;
  season: number;
  /** The day the frames were read (YYYY-MM-DD). */
  checked: string;
  /** Matches whose clip's first frame names them. */
  ok?: string[];
  /** Matches whose clip's first frame names another match: never served. `t`: the clip's start; `showed`: what the
   *  overlay named there. */
  pulled?: Record<string, { t: number; showed: string }>;
  /** Matches whose clip's first frame named nothing: still served, read again on the next run. */
  unconfirmed?: Record<string, { t: number; why: string }>;
  /** No frame of the video showed a readable overlay: its clips can't be checked by frame. */
  noOverlay?: true;
}

/** What the sweep found for a match's clock clip, or null where it hasn't been checked. */
export type ClipCheckState =
  | { state: "ok" }
  | { state: "pulled"; t: number; showed: string }
  | { state: "unconfirmed"; t: number; why: string }
  | { state: "noOverlay" };

let byKey: Map<string, ClipCheck> | null = null;
const keyed = () => new Map(CLIP_CHECKS.map((c) => [`${c.videoId}|${c.code}`, c]));

/** The sweep's result for a match's clock clip in a video, or null where that video wasn't checked. */
export function clipCheck(videoId: string, code: string, label: string): ClipCheckState | null {
  byKey ??= keyed();
  const c = byKey.get(`${videoId}|${code}`);
  if (!c) return null;
  const p = c.pulled?.[label];
  if (p) return { state: "pulled", ...p };
  const u = c.unconfirmed?.[label];
  if (u) return { state: "unconfirmed", ...u };
  if (c.ok?.includes(label)) return { state: "ok" };
  return c.noOverlay ? { state: "noOverlay" } : null;
}

/** Whether a match's clock clip in a video was pulled: its first frame names another match. */
export function clipPulled(videoId: string, code: string, label: string): boolean {
  return clipCheck(videoId, code, label)?.state === "pulled";
}

/** Every pulled clip, for the owner console's findings: video, event, match, the clip's start and what it showed. */
export function clipCheckFindings(): { videoId: string; season: number; code: string; label: string; t: number; showed: string }[] {
  return CLIP_CHECKS.flatMap((c) => Object.entries(c.pulled ?? {}).map(([label, p]) => ({ videoId: c.videoId, season: c.season, code: c.code, label, ...p })));
}

/** The sweep's measured totals: clips checked, confirmed, pulled, unconfirmed, and videos that can't be checked. */
export function clipCheckTotals(): { checked: number; ok: number; pulled: number; unconfirmed: number; noOverlayVideos: number } {
  let ok = 0, pulled = 0, unconfirmed = 0, noOverlayVideos = 0;
  for (const c of CLIP_CHECKS) {
    ok += c.ok?.length ?? 0;
    pulled += Object.keys(c.pulled ?? {}).length;
    unconfirmed += Object.keys(c.unconfirmed ?? {}).length;
    if (c.noOverlay) noOverlayVideos++;
  }
  return { checked: ok + pulled + unconfirmed, ok, pulled, unconfirmed, noOverlayVideos };
}

/** Tests only: these checks in place of the file's. */
export function setClipChecksForTests(list: ClipCheck[]) {
  CLIP_CHECKS.splice(0, CLIP_CHECKS.length, ...list);
  byKey = null;
}

// --- Data (scripts/clip-checks.ts writes from here on) ---
export const CLIP_CHECKS: ClipCheck[] = [
];
