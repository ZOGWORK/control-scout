// The rules a frame-read row and a first-frame clip check must keep before the live site serves them: one definition,
// used by the clip autopilot on its computer (scripts/lib/autopilotRows.ts, autopilotClips.ts re-export these) and by
// the server when the autopilot hands it a read (server/videos/autoReads.ts): a row that keeps every rule goes live at
// once, one that breaks any waits for the owner (Owner › Clip coverage, Waiting for approval).
//
// Frame rows (docs/frame-timings.md):
//   - every start is plausible: inside the order, a match apart (plausibleStarts, the server's own reading);
//   - every start the read placed or moved has its opening checked: the clip opens 20, 12, 5, 2 or 0 s before it (or 2
//     or 4 s after it), where a paused frame named the match (`opens`). A live clip whose opening frame named nothing may
//     stay `unconfirmed`, never a new one;
//   - a clip the live site plays leaves only when a frame names another match there ("its clip's first frame shows Q7,
//     not Q6", the reader's review): a frame that names nothing never pulls one;
//   - a re-read row carries a newer `checked` date than the live one.
// Clip checks: a clip is pulled only where its first frame names another match; one whose frame names its own match is
// ok; one that names nothing stays served (unconfirmed); what the live row settled stays.
import { plausibleStarts, playableStarts, type FrameTiming } from "./frameTimings.js";
import type { ClipCheck } from "./clipChecks.js";

/** Two reads closer than this (seconds) are the same distance: the timer reads to the second, and the frame read lags it. */
export const SAME_S = 6;
/** Where a clip may open, seconds before its match's start, earliest first: the first whose frame names the match.
 *  The 2 and 0 open at the start itself: a results card ("Match 6 results", CAONMIQ 2025 M7) or a bracket card
 *  (USIAWESTLT 2025 M3) can stay up until the match's own overlay comes on, seconds before it starts. The last two open
 *  just after it, where nothing before the start names the match: an upload cut from one match's results straight into
 *  the next match's first second (USMOKSKCM2 2021 Q15: Q14's results at 4651 s, Q15's Auto running at 4657 s), so the
 *  clip opens 2 or 4 s into its match rather than not at all. Still only on a frame that names it. */
export const OPEN_LEADS = [20, 12, 5, 2, 0, -2, -4];
/** OPEN_LEADS in words, for checks and summaries. */
export const OPEN_LEADS_TEXT = "20, 12, 5, 2 or 0 s before its start, or 2 or 4 s after it";
/** Where a clip opens against its match's start, in words: "12 s before its start", "2 s after its start". */
export const leadText = (lead: number): string => (lead >= 0 ? `${lead} s before its start` : `${-lead} s after its start`);
/** Why a match is missing when no frame of its video could be read at all. */
export const NOTHING_READ = "no frame of the video could be read";
/** The start of the reason a match is missing when its video couldn't be played at all (scripts/video-frames.ts). */
export const PLAY_FAILED = "the video couldn't be played";

/** The review reason that pulls a live clip: a frame at its opening names another match. */
const PULLED = /^its clip's first frame shows (.+), not (.+)$/;
/** Whether a review reason is the reader's pull of this match: its opening frame names a different match. */
const namesAnother = (label: string, why: string | undefined) => { const m = PULLED.exec(why ?? ""); return !!m && m[2] === label && m[1] !== label; };
/** A calendar date, YYYY-MM-DD, that exists ("2026-02-30" doesn't). */
const isDate = (s: string) => {
  const t = /^\d{4}-\d\d-\d\d$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** What's wrong with a row the reader wrote, against the row the live site serves for that video and event (none: a
 *  new one). `order`: the event's played matches in the order they were played (by their real starts), for the order
 *  check. Empty: it can go live. */
export function rowProblems(next: FrameTiming, live?: FrameTiming, order?: string[]): string[] {
  const out: string[] = [];
  if (!isDate(next.checked)) out.push(`checked "${next.checked}" isn't a date`);
  if (live && JSON.stringify(live) !== JSON.stringify(next) && !(next.checked > live.checked)) out.push(`changed without a newer checked date than the live row's (${live.checked})`);
  for (const [l, t] of Object.entries(next.starts)) if (!Number.isInteger(t) || t < 0) out.push(`${l}: start ${t} isn't a second in the video`);
  for (const [l, t] of Object.entries(next.opens ?? {})) if (!Number.isInteger(t) || t < 0) out.push(`${l}: opening ${t} isn't a second in the video`);
  const plausible = plausibleStarts(next.starts, next.opens);
  for (const l of Object.keys(next.starts)) if (plausible[l] == null) out.push(`${l}: its start overlaps another match's`);
  // In the order the matches were played (their real starts: a match played late, a replay, keeps its place in time,
  // not its number's), as the reader judges them.
  if (order) {
    const at = new Map(order.map((l, i) => [l, i]));
    for (const l of Object.keys(next.starts)) if (!at.has(l)) out.push(`${l}: not a match the event played`);
    const byOrder = Object.entries(next.starts).filter(([l]) => at.has(l)).sort((a, b) => at.get(a[0])! - at.get(b[0])!);
    for (let i = 1; i < byOrder.length; i++) if (byOrder[i][1] <= byOrder[i - 1][1]) out.push(`${byOrder[i][0]}: starts before ${byOrder[i - 1][0]}, out of the order they were played`);
  }
  const was = live ? live.starts : {};
  if (live?.opens && !next.opens) out.push("openings the live row checked are gone");
  for (const [l, t] of Object.entries(next.starts)) {
    // A start the live site already plays where it was, its opening as the live row has it (none, on an older row):
    // stands. A new or moved opening is checked like any other.
    const open = next.opens?.[l];
    if (was[l] != null && Math.abs(was[l] - t) <= SAME_S && (open == null || open === live?.opens?.[l])) {
      if (next.opens && open == null && !next.unconfirmed?.includes(l)) out.push(`${l}: a live clip left with no opening and not unconfirmed`);
      continue;
    }
    if (open != null) {
      if (!OPEN_LEADS.includes(t - open)) out.push(`${l}: opens ${leadText(t - open)}, not ${OPEN_LEADS_TEXT}`);
    } else if (!next.unconfirmed?.includes(l)) out.push(`${l}: no opening frame checked for it`);
  }
  // Unconfirmed only ever a live clip, at its live second, whose opening named nothing (so none checked for it).
  for (const l of next.unconfirmed ?? []) {
    const t = next.starts[l];
    if (t == null || was[l] == null || Math.abs(was[l] - t) > SAME_S) out.push(`${l}: unconfirmed, but not a live clip at that second`);
    else if (next.opens?.[l] != null) out.push(`${l}: unconfirmed, yet its opening is checked`);
  }
  // Live clips: kept (anywhere in starts, a read's slack from where they were), or pulled by a frame naming another match.
  if (live) {
    for (const [l, t] of Object.entries(playableStarts(live))) {
      const now = next.starts[l];
      if (now != null && Math.abs(now - t) <= SAME_S) continue;
      // Pulled at its own live second: the frame read there, not where a re-read placed it.
      const pull = next.review?.[l];
      if (!pull || !Number.isFinite(pull.t) || Math.abs(pull.t - t) > SAME_S || !namesAnother(l, pull.why)) out.push(`${l}: a live clip ${now == null ? "dropped" : "moved"} without a frame naming another match`);
    }
  }
  for (const [l, e] of Object.entries(next.earlyStart ?? {})) if (!(e.previousEnds > e.t)) out.push(`${l}: early start ${e.t} isn't before the previous match's end ${e.previousEnds}`);
  return out;
}

/** A row whose video showed the reader nothing: no start, and every match missing because no frame of the video could
 *  be read, or because the video couldn't be played at all. That's the player failing (no picture, a codec the reading
 *  computer's browser can't play, a video YouTube wouldn't play there), not what the video shows: never live (it would
 *  mark every match read, with no clip), never the owner's to approve; the event is read again later. */
export function nothingRead(r: Pick<FrameTiming, "starts" | "missing">): boolean {
  const why = Object.values(r.missing ?? {});
  return Object.keys(r.starts ?? {}).length === 0 && why.length > 0 && why.every((w) => w === NOTHING_READ || (typeof w === "string" && w.startsWith(PLAY_FAILED)));
}

/** The match an overlay names, as the reader compares them: a replay ("M6-2") by its match. */
const base = (label: string) => label.replace(/-\d+$/, "");

/** What's wrong with a sweep row, against the row live now (none: new). Empty: it can go live. */
export function clipCheckProblems(next: ClipCheck, live?: ClipCheck): string[] {
  const out: string[] = [];
  if (!Number.isInteger(next.season)) out.push(`season ${next.season} isn't a season`);
  if (!isDate(next.checked)) out.push(`checked "${next.checked}" isn't a date`);
  if (live && JSON.stringify(live) !== JSON.stringify(next) && !(next.checked >= live.checked)) out.push(`changed with an older checked date than the live row's (${live.checked})`);
  const ok = new Set(next.ok ?? []), pulled = next.pulled ?? {}, unconfirmed = next.unconfirmed ?? {};
  for (const [l, p] of Object.entries(pulled)) {
    if (!Number.isInteger(p.t) || p.t < 0) out.push(`${l}: pulled at ${p.t}, not a second in the video`);
    // Pulled only by a frame naming a different match.
    if (!p.showed || base(p.showed) === base(l)) out.push(`${l}: pulled, but its frame names ${p.showed || "nothing"}`);
    if (ok.has(l)) out.push(`${l}: both ok and pulled`);
    if (unconfirmed[l]) out.push(`${l}: both pulled and unconfirmed`);
  }
  for (const l of ok) if (unconfirmed[l]) out.push(`${l}: both ok and unconfirmed`);
  for (const [l, u] of Object.entries(unconfirmed)) if (!Number.isInteger(u.t) || u.t < 0) out.push(`${l}: unconfirmed at ${u.t}, not a second in the video`);
  if (next.noOverlay && (ok.size || Object.keys(pulled).length)) out.push("no readable overlay, yet a frame was read");
  // What the live row settled stays: a pull is lifted only by a frame naming its own match (ok), and an ok clip is
  // pulled only by a frame naming another.
  for (const l of Object.keys(live?.pulled ?? {})) if (!pulled[l] && !ok.has(l)) out.push(`${l}: a pulled clip back without a frame naming it`);
  for (const l of live?.ok ?? []) if (!ok.has(l) && !pulled[l]) out.push(`${l}: an ok clip dropped without a frame naming another match`);
  return out;
}
