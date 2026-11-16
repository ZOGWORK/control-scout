// Frame-read match timings for event recordings whose matches can't be placed from YouTube's facts alone.
//
// A recording shorter than its broadcast lost time somewhere (a stream stopped over lunch, the tail cut, the start
// trimmed), and an upload has no broadcast clock at all, so the server can't tell where a match sits in it
// (timingTrusted, src/shared/recording.ts). The video itself can: nearly every FTC stream carries FTC Live's overlay,
// which names the match ("Qualification 21 of 36", "Playoff Match 7") and runs its timer. This script plays the
// recording in a headless browser (YouTube's privacy-enhanced embed), reads the overlay and the timer at a few points
// (tesseract.js), and from them the second each match starts at.
//
// It reads few frames: a recording can lose time but never gain it, so two matches whose video second is the same
// distance from their real start (FIRST's actual start time) have every match between them that same distance from
// theirs. It reads the first and last match a video holds; where their distances differ it reads the middle one, and so
// on, so a video with one gap takes about 2 log n reads. A match is kept only where a read saw it, or where two reads
// that agree hold it between them.
//
// What it writes: server/data/frameTimings.ts (the server plays each match from there: server/videos/recordings.ts).
// Run it on a copy of the live database, on a computer that can play YouTube (YouTube refuses data-centre servers).
//
//   DATABASE_URL=file:/path/to/copy.db npx tsx scripts/video-frames.ts [--season 2025] [--codes USTXCMP4T,ROCMPVLC]
//     [--all] [--check] [--limit 10] [--dry]
//
//   --all     every recording, not only those with a match the server can't place now (and again those read on an earlier run)
//   --check   recordings the server already places, to compare: prints how far the frames are from the clock
//   --dry     print, don't write
//   --trace   print every frame read (where, what it named, the start it gave) to stderr
//   --verify  read no starts: check where each placed match's clip opens, for rows not yet checked (opens)
//   --bounds  read no starts: read each read video's first and last frames (opensOn, endsOn), the proof that a match
//             was played before it starts or after it ends (outsideRecording); a normal read reads them too
//   --live <file>  the timings the live site serves (a copy of main's server/data/frameTimings.ts): a re-read start
//             that is one of them (same video, match and second, within a read's slack) and whose opening frame names
//             nothing stays, unconfirmed, as --verify keeps it; only an overlay naming another match pulls a live clip
//   TESSERACT_JS=<path to tesseract.js's entry>  where tesseract.js is, when it isn't in node_modules
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { CLEAR_MAX_S, CLEAR_STEP_S, EDGE_AT, playedCount } from "./lib/videoFrames";
import { AUTO_S, OPEN_LEADS, startOffset, OVERLAY_UNREAD, SAME_S, SWITCH_S, TELEOP_S, TRIES, dataRows, divisionOf, elapsed, overlayDivision, leadIn, judge, NOTHING_READ, overlayLabel, secondsLoose, secondsOf, type Judged, type M } from "./lib/videoFrames";

// The command line: --name value or --name=value for the value flags, --name alone for the others. Anything else stops
// the run before it reads: a misspelt flag mustn't quietly read (and write) every recording of the season.
const VALUE_FLAGS = new Set(["season", "codes", "limit", "lanes", "live"]), BOOL_FLAGS = new Set(["all", "bounds", "check", "dry", "trace", "verify"]);
const args = new Map<string, string | true>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    const name = m?.[1] ?? "";
    if (m && VALUE_FLAGS.has(name)) {
      const v = m[2] ?? argv[++i];
      if (v == null || v === "" || v.startsWith("--")) { console.error(`--${name}: give it a value`); process.exit(2); }
      args.set(name, v);
    } else if (m && BOOL_FLAGS.has(name) && m[2] == null) args.set(name, true);
    else { console.error(`${argv[i]}: not a flag this script takes (--season, --codes, --limit, --lanes, --all, --check, --dry, --trace, --verify)`); process.exit(2); }
  }
}
const arg = (k: string) => { const v = args.get(k); return typeof v === "string" ? v : undefined; };
const flag = (k: string) => args.get(k) === true;
/** A number flag, or the run stops before anything is read: a misspelt one mustn't look like a run that read nothing. */
function count(name: string, fallback: number): number {
  const v = arg(name);
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) { console.error(`--${name} ${v}: give a whole number, 1 or more`); process.exit(2); }
  return Math.floor(n);
}
const season = count("season", 2025);
const only = arg("codes")?.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const limit = arg("limit") == null ? Infinity : count("limit", 1);
const lanes = count("lanes", 3);
const CHECK = flag("check"), ALL = flag("all"), DRY = flag("dry"), TRACE = flag("trace"), VERIFY = flag("verify"), BOUNDS = flag("bounds");

const { migrate, all } = await import("../server/db.js");
await migrate();
const R = await import("../server/videos/recordings.js");
const { CLIP_LEAD_S, actualStart } = await import("../src/shared/recording.js");
const { localToUtcMs } = await import("../src/shared/time.js");
const { FRAME_TIMINGS } = await import("../server/data/frameTimings.js");
/** --live: what the live site serves, by video and event (its starts). */
const LIVE = new Map<string, Record<string, number>>(
  arg("live") ? dataRows<{ videoId: string; code: string; starts: Record<string, number> }>(readFileSync(arg("live")!, "utf8")).map((f) => [`${f.videoId}|${f.code}`, f.starts]) : [],
);
type FrameTiming = (typeof FRAME_TIMINGS)[number];
const T: any = await import(process.env.TESSERACT_JS ?? "tesseract.js");
const createWorker = T.createWorker ?? T.default?.createWorker;

type Read = { label: string | null; start: number | null; at: number; text: string; why?: string; division?: "own" | "other" | null };

/** The video's event, when its divisions share a stream: its division's name and its siblings'. Each read says whose
 *  overlay it saw; a sibling's is never this event's match, and a start stands only when a read of it showed this
 *  division's name. */
const divisions = new WeakMap<Page, { own: string; others: string[] }>();

// --- Reading a frame -----------------------------------------------------------------------------------------------

// Two OCR workers shared by every lane (a tesseract.js worker does one job at a time). One that hangs is replaced, or
// every later read would queue behind its stuck job and time out too.
const ocr = async () => {
  const w = await createWorker("eng"), d = await createWorker("eng");
  await d.setParameters({ tessedit_char_whitelist: "0123456789:", tessedit_pageseg_mode: "7" });
  return [w, d] as const;
};
let [worker, digits] = await ocr();
let renewing: Promise<void> | null = null;
/** Set when hung workers couldn't be replaced: every later read then fails its video at once (written with the reason,
 *  read again next run) instead of queueing behind the stuck job. */
let ocrBroken: string | null = null;
function renewOcr(): Promise<void> {
  renewing ??= (async () => {
    const old = [worker, digits];
    try {
      [worker, digits] = await ocr();
      console.error("a frame read hung: the OCR workers were replaced");
    } catch (e) {
      ocrBroken = `the OCR workers hung and couldn't be replaced (${(e as Error).message.split("\n")[0]})`;
      console.error(ocrBroken);
    }
    await Promise.all(old.map((w) => w.terminate().catch(() => {})));
  })().finally(() => { renewing = null; });
  return renewing;
}
let failedVideos = 0;

/** The timer's places: FTC Live's bar along the bottom (also shrunk inside side bars), or its box over the field under a bar
 *  across the top (FTC Ontario's layout) ("bottom"); or a bar along the top (FIRST Texas's layout, "top"). Each counts a 0:30 Auto, then a
 *  2:00 TeleOp (elapsed, scripts/lib/videoFrames.ts). */
const TIMERS = [
  { where: "bottom" as const, clip: { x: 565, y: 618, width: 150, height: 86 } },
  { where: "top" as const, clip: { x: 603, y: 101, width: 74, height: 38 } },
  { where: "bottom" as const, clip: { x: 565, y: 175, width: 150, height: 68 } },
  // The bottom bar shrunk to 90% inside black side bars, raised off the bottom edge (ROCMPCND's Friday stream at Q2).
  { where: "bottom" as const, clip: { x: 580, y: 606, width: 120, height: 52 } },
  // The timer alone in a white box between the scores, a gamepad icon above it and Auto's dots below (FIRST AGE's bar,
  // USNMCMP 2025): with the icon in the crop the OCR reads "1:04" as "11040", so only the digits' row is read, and its
  // thin colon, often dropped ("117"), isn't needed (secondsLoose).
  { where: "bottom" as const, clip: { x: 585, y: 651, width: 110, height: 38 }, loose: true },
  // The same white box in a bar across the top (FIRST AGE's top layout, USPAKSN 2026): wider than FIRST Texas's.
  { where: "top" as const, clip: { x: 585, y: 92, width: 110, height: 50 }, loose: true },
];

/** The timer's reading. `auto`: whether a reading of 0:30 or less is Auto, told by readAt. */
async function timer(page: Page): Promise<{ where: "bottom" | "top"; left: number; auto: boolean } | null> {
  for (const t of TIMERS) {
    const text = (await digits.recognize(await page.screenshot({ clip: t.clip }))).data.text;
    const left = "loose" in t ? secondsLoose(text) : secondsOf(text);
    if (left == null || left > AUTO_S + SWITCH_S + TELEOP_S) continue;
    return { where: t.where, left, auto: false };
  }
  return null;
}

const now = (page: Page) => page.evaluate(() => document.querySelector("video")!.currentTime);

async function seek(page: Page, t: number) {
  await page.evaluate((t) => new Promise((r) => { const v = document.querySelector("video")!; v.addEventListener("seeked", r, { once: true }); v.currentTime = t; setTimeout(r, 15000); }), t);
  await page.waitForFunction(() => document.querySelector("video")!.readyState >= 3, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
}

/** What the frame at second t shows: the match its overlay names and, while that match is being played, the second it
 *  started at (its timer read twice, 1.5 s apart, must run). */
/** The most a frame read may take (seconds): a page that stops answering (a frozen player, OCR that never returns)
 *  fails its video with that reason instead of holding the run forever. */
const READ_LIMIT_S = 120;
/** Frames read on each player page (each point a read looks at, confirming reads included): what a video's budget
 *  counts. Per page, so lanes reading side by side never spend each other's budget. */
const pageReads = new WeakMap<Page, number>();
function readAt(page: Page, t: number, labelOnly = false): Promise<Read> {
  pageReads.set(page, (pageReads.get(page) ?? 0) + 1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    readAtOnce(page, t, labelOnly).finally(() => clearTimeout(timer)).then((r) => {
      if (TRACE) console.error(`    read ${Math.round(t)} s: ${r.label ?? "-"}${r.start != null ? ` from ${r.start}` : ""}${r.division ? ` (${r.division} division)` : ""}${r.why ? `: ${r.why}` : ""}`);
      return r;
    }),
    new Promise<never>((_, no) => { timer = setTimeout(() => { void renewOcr(); no(new Error(`a frame read at ${Math.round(t)} s hung over ${READ_LIMIT_S} s`)); }, READ_LIMIT_S * 1000); }),
  ]);
}

/** labelOnly: the overlay's match alone, not its timer (a clip opening's check). */
async function readAtOnce(page: Page, t: number, labelOnly = false): Promise<Read> {
  if (ocrBroken) throw new Error(ocrBroken);
  await seek(page, Math.max(0, t));
  const at = await now(page);
  const text = (await worker.recognize(await page.screenshot())).data.text as string;
  const ctx = divisions.get(page);
  const division = ctx ? overlayDivision(text, ctx.own, ctx.others) : undefined;
  // Another division's match on the shared stream: not this event's, whatever its number.
  if (division === "other") return { label: null, start: null, at, text, why: "another division's overlay", division };
  const label = overlayLabel(text);
  if (!label || labelOnly) return { label, start: null, at, text, division };
  const a = await timer(page);
  const atA = await now(page);
  await page.waitForTimeout(1500);
  const b = await timer(page);
  const atB = await now(page);
  if (!a || !b || a.where !== b.where) return { label, start: null, at, text, why: `timer read ${a ? `${a.where} ${a.left}` : "nothing"}, then ${b ? `${b.where} ${b.left}` : "nothing"}` };
  const ran = a.left - b.left, played = atB - atA;
  // Running: down by the time played (to the second either side). A paused or standing timer: not in play.
  if (played < 0.5 || Math.abs(ran - played) > 1.6) return { label, start: null, at, text, why: `timer ${a.left} then ${b.left} over ${played.toFixed(1)} s played` };
  // 0:30 or less on either bar: Auto, or the end of TeleOp. 45 s on, Auto has become TeleOp's 2:00 (well over 30 s
  // left); the end of TeleOp has finished.
  if (a.left <= AUTO_S) {
    await seek(page, atA + 45);
    const c = await timer(page);
    a.auto = !!c && c.where === a.where && c.left > AUTO_S && overlayLabel((await worker.recognize(await page.screenshot())).data.text) === label;
  }
  const e = elapsed(a);
  return { label, start: e == null ? null : Math.round(atA - e), at, text, division, ...(e == null ? { why: `timer ${a.left} isn't a running match's` } : {}) };
}

/** Seconds into a match the confirming read is tried at, in turn (all TeleOp, well clear of its last 8 s). Spread
 *  over most of TeleOp: a stream may cut away to a camera without the overlay for a minute or more (Romania's
 *  championship cuts to the floor cameras mid-match). */
const CONFIRM_AFTER = [70, 80, 95, 110, 125, 140];
/** Seconds into a match an Auto read confirms its start at, in turn, where a later read disagrees by time the video
 *  lost (confirmed). Early: before most of the match, where a cut in the recording is least likely to fall. */
const AUTO_CONFIRM = [12, 20];


/** A read stands only when frames before and after its start agree: 70 s on (TeleOp), the overlay names the same match
 *  and its timer gives the same start; 25 s before, that match isn't running yet. One read alone is never a start
 *  (a wrong match number on screen for a few seconds, a replay, a digit read wrong). */
async function confirmed(page: Page, label: string, start: number, own = false, other?: { start?: number }): Promise<string | null> {
  // A frame that reads nothing (the player still buffering after a long seek, the timer not caught running) says
  // nothing either way, so a later point of TeleOp is tried; a frame that reads another match or start disagrees.
  let why = "";
  for (const after of CONFIRM_AFTER) {
    const at = await readAt(page, start + after);
    if (at.division === "other") return `${after} s on the overlay named another division`;
    own ||= at.division === "own";
    if (at.label && at.label !== label) return `${after} s on the overlay read ${at.label}`;
    if (at.label && at.start != null) {
      if (Math.abs(at.start - start) > SAME_S) {
        const off = startOffset(start, at.start);
        // A recording cut mid-match: the start stands if an Auto read, early in the same match, agrees with it.
        if (off === "lost" && (await autoAgrees(page, label, start))) { why = ""; break; }
        // The first read came after a cut: the other start may be the real one (checked by the caller).
        if (off === "gained" && other) other.start = at.start;
        return `${after} s on its timer gave a start ${Math.round(at.start - start)} s off`;
      }
      why = "";
      break;
    }
    why = at.label ? `${CONFIRM_AFTER.join(", ")} s on its timer wasn't read running (last: ${at.why})` : `${CONFIRM_AFTER.join(", ")} s on the overlay read nothing`;
  }
  if (why) return why;
  const before = await readAt(page, start - 25);
  if (before.label === label && before.start != null) return `25 s before it was already running (start ${Math.round(before.start - start)} s off)`;
  if (divisions.has(page) && !own) return "no read of it showed its division's name (the stream carries another division too)";
  return null;
}

/** An Auto read early in the match (AUTO_CONFIRM) gives the same start: the frames right after it agree with it. */
async function autoAgrees(page: Page, label: string, start: number): Promise<boolean> {
  for (const after of AUTO_CONFIRM) {
    const at = await readAt(page, start + after);
    if (at.division === "other" || (at.label && at.label !== label)) return false;
    if (at.label && at.start != null) return Math.abs(at.start - start) <= SAME_S;
  }
  return false;
}

/** Matches in a row with no read before a video counts as one without the overlay. */
const MISSES = 3;

// --- Where each clip opens ---------------------------------------------------------------------------------------

/**
 * Every placed match's clip must open on that match: its first frame's overlay names it (and, on a stream divisions
 * share, not a sibling division's). Tried 20, 12 and 5 s before its start; the first that names it is where the clip
 * opens. One that names another match there (the previous match's result still up) is tried closer in; a match whose
 * clip can't open on it goes to review, and one whose overlay can't be read there at all is missing with
 * OVERLAY_UNREAD. Nothing is a clip unchecked.
 */
async function checkOpenings(page: Page, j: Judged, log: (s: string) => void, unread?: Set<string>, live?: Record<string, number>): Promise<void> {
  const failed: string[] = [];
  for (const [label, p] of [...j.placed]) {
    if (j.opens.has(label)) continue; // checked on an earlier --verify
    let named: string | null = null, at: number | null = null;
    for (const lead of OPEN_LEADS) {
      const t = p.t - lead;
      if (t < 0) continue;
      const r = await readAt(page, t, true);
      if (r.division === "other") { named = "another division's match"; continue; }
      // The overlay names a replay (a tiebreak's "M6-2") by its match alone ("M6"), as placeVideo reads it.
      if (r.label === label.replace(/-\d+$/, "")) { at = t; break; }
      if (r.label) named = r.label;
    }
    if (at != null) { j.opens.set(label, at); continue; }
    // A clip already live (--verify, or a re-read start the live site serves: --live) whose opening frame named nothing
    // (blank, a transition, a cutaway) stays, to be read again: only an overlay naming another match pulls it.
    if (unread && !named && (!live || (live[label] != null && Math.abs(live[label] - p.t) <= SAME_S))) { unread.add(label); continue; }
    j.placed.delete(label);
    failed.push(label);
    if (named) j.review.set(label, { t: p.t, why: `its clip's first frame shows ${named}, not ${label}` });
    else j.missing.set(label, OVERLAY_UNREAD);
  }
  log(`    clip openings: ${j.opens.size} name their match${unread?.size ? `; ${unread.size} unconfirmed, to read again: ${[...unread].join(" ")}` : ""}${failed.length ? `; ${unread && !live ? "pulled" : "not placed"}: ${failed.join(" ")}` : ""}`);
}

/** --verify: a row read before clip openings were checked gets them checked, its starts as they were read. */
async function verifyRow(row: FrameTiming, division: { own: string; others: string[] } | null, log: (s: string) => void): Promise<void> {
  let page: Page | null = null;
  try {
    page = await player();
    if (division) divisions.set(page, division);
    await open(page, row.videoId);
    log(`  ${row.videoId}: checking ${Object.keys(row.starts).length} clip openings`);
    const medium = new Set(row.medium ?? []);
    const j: Judged = {
      placed: new Map(Object.entries(row.starts).map(([l, t]) => [l, { t, confidence: medium.has(l) ? "medium" as const : "high" as const }])),
      review: new Map(Object.entries(row.review ?? {})), missing: new Map(Object.entries(row.missing ?? {})),
      earlyStart: new Map(Object.entries(row.earlyStart ?? {})), opens: new Map(Object.entries(row.opens ?? {})),
    };
    const unread = new Set<string>();
    await checkOpenings(page, j, log, unread);
    const starts = Object.fromEntries([...j.placed].sort((a, b) => a[1].t - b[1].t).map(([l, p]) => [l, p.t]));
    const med = (row.medium ?? []).filter((l) => l in starts);
    keep(`${row.videoId}|${row.code}`, {
      videoId: row.videoId, code: row.code, checked: row.checked, starts,
      ...(med.length ? { medium: med } : {}),
      ...(j.review.size ? { review: Object.fromEntries(j.review) } : {}),
      ...(j.missing.size ? { missing: Object.fromEntries(j.missing) } : {}),
      ...(j.earlyStart.size ? { earlyStart: Object.fromEntries(j.earlyStart) } : {}),
      opens: Object.fromEntries(j.opens),
      ...(unread.size ? { unconfirmed: [...unread] } : {}),
    });
  } catch (e) {
    log(`    couldn't check: ${(e as Error).message.split("\n")[0]} (the row is kept unchecked; the next --verify tries it again)`);
    failedVideos++;
  } finally {
    await page?.context().close().catch(() => {});
  }
}

// --- The recording's edges ----------------------------------------------------------------------------------------

type Edge = { at: number; label?: string; played?: number; of?: number; clear?: boolean; underway?: boolean };
/** What a recording's first and last frames show (EDGE_AT from each end): the first frame from that end that names a
 *  match (this division's; another's names none) or counts the matches played. None does, and none shows a timer: read
 *  on every CLEAR_STEP_S (up to CLEAR_MAX_S, or half the video) while each frame shows no match at all, and the first
 *  that names one is the edge, "clear" of matches before it. A timer on screen with no match named: no edge. */
async function readEdges(page: Page, length: number): Promise<{ opensOn?: Edge; endsOn?: Edge }> {
  const named = async (t: number): Promise<Edge | null> => {
    const r = await readAt(page, t, true);
    const n = playedCount(r.text);
    return r.label || n ? { at: Math.round(t), ...(r.label ? { label: r.label } : {}), ...(n ? { played: n.played, of: n.of } : {}) } : null;
  };
  const edge = async (from: (s: number) => number): Promise<Edge | undefined> => {
    let quiet = true;
    for (const s of EDGE_AT) {
      const t = from(s);
      if (t < 0 || t > length) continue;
      const e = await named(t);
      if (e) return e;
      if (quiet && await timer(page)) quiet = false;
    }
    if (!quiet) return undefined;
    for (let s = EDGE_AT[EDGE_AT.length - 1] + CLEAR_STEP_S; s <= Math.min(CLEAR_MAX_S, length / 2); s += CLEAR_STEP_S) {
      const e = await named(from(s));
      if (e) return { ...e, clear: true };
      if (await timer(page)) return undefined;
    }
    return undefined;
  };
  const opensOn = await edge((s) => s);
  // The match it opens on, already being played: its timer runs between two reads 3 s apart, and even its least
  // elapsed reading (an Auto reading of 0:30 or less could be either period) puts its start before the recording's.
  if (opensOn?.label && !opensOn.clear) {
    await seek(page, opensOn.at);
    const a = await timer(page);
    await seek(page, opensOn.at + 3);
    const b = await timer(page);
    if (a && b && a.where === b.where && a.left - b.left >= 1 && a.left - b.left <= 5) {
      const ways = [elapsed({ ...a, auto: false }), ...(a.left <= AUTO_S ? [elapsed({ ...a, auto: true })] : [])].filter((x): x is number => x != null);
      if (ways.length && Math.min(...ways) > opensOn.at) opensOn.underway = true;
    }
  }
  const endsOn = await edge((s) => length - s);
  return { ...(opensOn ? { opensOn } : {}), ...(endsOn ? { endsOn } : {}) };
}

/** An edge as the log says it: "M1 at 400 s (no match before it)", "4/23 played at 3 s", "nothing". */
const saidEdge = (e?: Edge, side = "before") => (e ? `${e.label ?? ""}${e.played != null ? ` ${e.played}/${e.of} played` : ""} at ${e.at} s${e.clear ? ` (no match on screen ${side} it)` : ""}${e.underway ? " (already being played)" : ""}` : "nothing");

/** --bounds: a read row gets its video's edges (opensOn, endsOn), its starts as they were. */
async function boundsRow(row: FrameTiming, length: number, division: { own: string; others: string[] } | null, log: (s: string) => void): Promise<void> {
  let page: Page | null = null;
  try {
    page = await player();
    if (division) divisions.set(page, division);
    await open(page, row.videoId);
    const { opensOn, endsOn } = await readEdges(page, length);
    log(`  ${row.videoId}: opens on ${saidEdge(opensOn)}, ends on ${saidEdge(endsOn, "after")}`);
    const { opensOn: _o, endsOn: _e, ...rest } = row;
    keep(`${row.videoId}|${row.code}`, { ...rest, ...(opensOn ? { opensOn } : {}), ...(endsOn ? { endsOn } : {}) });
  } catch (e) {
    log(`    couldn't read its edges: ${(e as Error).message.split("\n")[0]} (the row is kept as it was)`);
    failedVideos++;
  } finally {
    await page?.context().close().catch(() => {});
  }
}

// --- Finding each match --------------------------------------------------------------------------------------------

/** The second each of a video's matches starts at, as far as its frames show. `shift`: the video's second for a moment
 *  minus that moment (epoch seconds), when YouTube gives the broadcast's start (an upload has none). */
async function placeVideo(page: Page, ms: M[], shift: number | null, length: number, log: (s: string) => void, unread?: Set<string>, live?: Record<string, number>): Promise<Judged> {
  // The overlay names a replay ("M14-2", a tiebreak) by its match alone (M14): each name, its matches in order.
  const byName = new Map<string, number[]>();
  ms.forEach((m, i) => { const n = m.label.replace(/-\d+$/, ""); byName.set(n, [...(byName.get(n) ?? []), i]); });
  const seen = new Map<number, number>(); // index → confirmed start second
  const tried = new Set<number>(); // matches a read named, confirmed or not
  const from = pageReads.get(page) ?? 0, reads = () => (pageReads.get(page) ?? 0) - from;
  // At most a few reads per match, every read counted (confirming ones too): checked before each read or confirmation.
  // A recording cut mid-match costs extra confirming reads (confirmed, autoAgrees): 4 a match left a cut stream's later
  // matches unread (USIAPOMPM11 2025, 81 frames of 72).
  const budget = Math.max(60, 8 * ms.length);
  let unconfirmed = 0;
  const near = (i: number): number | null => {
    // The distance of the read nearest by order, else the broadcast's.
    let best: number | null = null, d = Infinity;
    for (const [k, s] of seen) if (Math.abs(k - i) < d) { d = Math.abs(k - i); best = s - ms[k].epoch; }
    return best ?? shift;
  };
  /** The distances of the nearest reads before and after a match by order (one where they agree), else the broadcast's. */
  const sides = (i: number): number[] => {
    const ks = [...seen.keys()];
    const before = ks.filter((k) => k < i).sort((a, b) => b - a)[0], after = ks.filter((k) => k > i).sort((a, b) => a - b)[0];
    const ds = [before, after].filter((k): k is number => k != null).map((k) => seen.get(k)! - ms[k].epoch).sort((a, b) => Math.abs(a - near(i)!) - Math.abs(b - near(i)!));
    if (!ds.length) return shift == null ? [] : [shift];
    return ds.length === 2 && Math.abs(ds[0] - ds[1]) <= SAME_S ? [ds[0]] : ds;
  };
  const note = async (r: Read) => {
    const named = r.label ? byName.get(r.label) : undefined;
    if (!named || r.start == null) return;
    // A match with replays and nothing yet to place the read against (no read placed, no broadcast clock): which of
    // them it shows can't be told, so the read is left rather than guessed.
    if (named.length > 1 && near(named[0]) == null) return;
    // Of a match and its replays, the one whose clock place (by the nearest read's distance) the read's start is nearest.
    const off = (k: number) => Math.abs(r.start! - (ms[k].epoch + (near(k) ?? 0)));
    const i = named.reduce((a, b) => (off(b) < off(a) ? b : a));
    tried.add(i);
    if (seen.has(i) || reads() >= budget) return;
    const other: { start?: number } = {};
    const no = await confirmed(page, r.label!, r.start, r.division === "own", other);
    if (no == null) { seen.set(i, r.start); return; }
    // The read came after a cut in the recording (a later read gives a later start): the later start, checked the same way.
    if (other.start != null && reads() < budget && (await confirmed(page, r.label!, other.start, r.division === "own")) == null) {
      seen.set(i, other.start);
      log(`    ${r.label} at ${r.start} s read after a cut in the video; its start is ${other.start} s`);
      return;
    }
    unconfirmed++;
    log(`    ${r.label} at ${r.start} s not confirmed: ${no}`);
  };

  // Any match at all, a frame every 10 minutes: where there's no clock to go by (an upload), or the clock's guesses read
  // nothing (a broadcast whose start YouTube has wrong).
  const scan = async () => { for (let t = 300; t < length && !seen.size && reads() < budget; t += 600) { await note(await readAt(page, t)); } };
  if (shift == null) {
    await scan();
    if (!seen.size) { log("    no match found in it"); return judge(ms, seen, shift, length, tried); }
  }

  // A video without FTC Live's overlay (a camera-only stream) reads nothing: stop after a few matches in a row with no
  // read at all. Any video: never more than a few reads per match.
  let missed = 0;
  const blind = () => missed >= MISSES && !seen.size;
  async function anchor(i: number): Promise<number | null> {
    if (seen.has(i)) return seen.get(i)!;
    if (blind() || reads() >= budget) return null;
    // Where the reads either side put the video, each in turn: where they disagree (a gap where the video lost time),
    // the match sits at one of them, and the nearest read alone may be the wrong side (CAONMIQ 2025's M10, at M9's
    // distance while its tie M11 sits 345 s earlier, was looked for only at M11's).
    for (const dist of sides(i)) {
      for (let k = 0; k < TRIES && reads() < budget; k++) {
        // Into the match (its timer running), then either side of where it should be.
        const t = ms[i].epoch + dist + [45, 100, -40, 160, -120, 240, -240][k];
        if (t < 0 || t > length) continue;
        const r = await readAt(page, t);
        await note(r);
        if (seen.has(i)) { missed = 0; return seen.get(i)!; }
      }
    }
    missed++;
    return null;
  }

  // The first and last match, then the middle of any stretch whose ends disagree.
  async function span(i: number, j: number): Promise<void> {
    let a = await anchor(i), b = await anchor(j);
    // A match that can't be read: its neighbour inward stands in.
    while (a == null && i < j && !blind() && reads() < budget) a = await anchor(++i);
    while (b == null && j > i && !blind() && reads() < budget) b = await anchor(--j);
    if (a == null || b == null) return;
    if (Math.abs((a - ms[i].epoch) - (b - ms[j].epoch)) <= SAME_S || j - i <= 1) return;
    const mid = (i + j) >> 1;
    await span(i, mid);
    await span(mid, j);
  }
  await span(0, ms.length - 1);
  // The matches before the first read, each from the nearest read's distance now (the clock alone may put them before
  // the video's start): the first that can't be read ends it.
  const firstSeen = Math.min(...seen.keys());
  for (let i = firstSeen - 1; i >= 0 && Number.isFinite(firstSeen) && !blind() && reads() < budget; i--) if ((await anchor(i)) == null) break;
  if (blind() && shift != null) {
    await scan();
    if (seen.size) { log(`    the clock read nothing; found by scanning, ${reads()} frames in`); missed = 0; await span(0, ms.length - 1); }
  }
  if (blind()) log(`    no overlay read in ${reads()} frames`);
  const j = judge(ms, seen, shift, length, tried);
  await checkOpenings(page, j, log, live ? unread : undefined, live);
  const out = new Map([...j.placed].map(([l, p]) => [l, p.t]));
  const high = [...j.placed.values()].filter((p) => p.confidence === "high").length;
  log(`    ${out.size} of ${ms.length} placed (${high} high, ${out.size - high} medium), ${seen.size} read, ${unconfirmed} reads not confirmed, ${reads()} frames`);
  if (j.review.size) log(`    for review: ${[...j.review].map(([l, r]) => `${l} (${r.why})`).join("; ")}`);
  if (j.missing.size) {
    const why = new Map<string, string[]>();
    for (const [l, w] of j.missing) why.set(w, [...(why.get(w) ?? []), l]);
    log(`    missing: ${[...why].map(([w, ls]) => `${ls.join(" ")} (${w})`).join("; ")}`);
  }
  // Each stretch the video holds without a gap: its matches and how far the video sits from the clock there.
  const runs: string[] = [];
  let prev: number | null = null, first = "", last = "";
  for (const m of ms) {
    const s = out.get(m.label);
    if (s == null) continue;
    const d = Math.round(s - m.epoch - (shift ?? 0));
    if (prev != null && Math.abs(d - prev) > SAME_S) { runs.push(`${first}–${last} ${prev} s`); first = ""; }
    if (!first) first = m.label;
    last = m.label;
    prev = d;
  }
  if (first) runs.push(`${first}–${last} ${prev} s`);
  log(`    video minus clock${shift == null ? " (from the first read)" : ""}: ${runs.join(", ")}`);
  return j;
}

// --- The recordings ------------------------------------------------------------------------------------------------

const recs = await R.seasonRecordings(season);
const codes = [...recs.keys()].filter((c) => !only || only.includes(c)).sort();
// A misspelt code (or a season with no recordings) mustn't look like a run that read and wrote: it stops here.
const unknown = (only ?? []).filter((c) => !recs.has(c));
if (unknown.length) { console.error(`--codes: no ${season} recording for ${unknown.join(", ")}`); process.exit(2); }
if (!codes.length) { console.error(`no ${season} recordings to read`); process.exit(2); }
const kept = new Map<string, FrameTiming>(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, { ...f, starts: { ...f.starts } }]));
// The rows this run wrote. Every other row is taken from the file at each save, so rows written meanwhile (another
// run with other --codes, a merge bringing a data PR) aren't overwritten by the start-of-run copy.
const touched = new Set<string>();
const keep = (key: string, row: FrameTiming) => { kept.set(key, row); touched.add(key); };
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const today = new Date().toISOString().slice(0, 10);
let done = 0;
const report: string[] = [];

/** Write the timings kept so far (after each event, so a run cut short keeps what it read). A file another program
 *  holds open for a moment (an editor, git, a test run reading it) only delays the write: it's tried again, and if it
 *  still can't be written the next event's save writes everything kept. */
let unsaved = false;
function save(): void {
  if (CHECK || DRY) return;
  const file = "server/data/frameTimings.ts";
  for (let tries = 1; ; tries++) {
    try {
      const text = readFileSync(file, "utf8");
      const head = text.split("// --- Data")[0];
      // The file is what counts for every row this run didn't write: added there, changed there, or deleted there.
      const onDisk = new Map(dataRows<FrameTiming>(text).map((f) => [`${f.videoId}|${f.code}`, f]));
      for (const key of [...kept.keys()]) if (!touched.has(key) && !onDisk.has(key)) kept.delete(key);
      for (const [key, f] of onDisk) if (!touched.has(key)) kept.set(key, f);
      const list = [...kept.values()].sort((a, b) => a.code.localeCompare(b.code) || a.videoId.localeCompare(b.videoId));
      const rows = list.map((f) => `  ${JSON.stringify(f)},`).join("\n");
      writeFileSync(file, `${head}// --- Data (scripts/video-frames.ts writes from here on) ---\nexport const FRAME_TIMINGS: FrameTiming[] = [\n${rows}\n];\n`);
      unsaved = false;
      return;
    } catch (e) {
      if (tries >= 5) { unsaved = true; console.error(`couldn't write ${file} (${(e as Error).message.split("\n")[0]}): the next save tries again`); return; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * tries);
    }
  }
}

/** The start of the reason a match is missing when its video couldn't be played at all: such a video is tried again
 *  on the next run. */
const PLAY_FAILED = "the video couldn't be played";

/** A fresh player page (its own browser context). */
async function player(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // tsx names the functions it hands the page with a helper of its own: the page gets one that does nothing.
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  return ctx.newPage();
}

/** Load a video in the privacy-enhanced embed, playing, with nothing drawn over the overlay. */
async function open(page: Page, videoId: string): Promise<void> {
  await page.goto(`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&rel=0&iv_load_policy=3&cc_load_policy=0`, { referer: "https://controlscout.org/" });
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2, null, { timeout: 30000 });
  // No captions over the overlay.
  await page.evaluate(() => { try { (document.querySelector("#movie_player") as any)?.unloadModule?.("captions"); } catch { /* none */ } });
  // Auto-captions sit right over the bottom bar's timer, and the embed's own bars over the top: hidden.
  await page.addStyleTag({ content: ".ytp-caption-window-container, .caption-window, .ytp-chrome-top, .ytp-pause-overlay, .ytp-show-cards-title, .ytp-ce-element, .ytp-player-content.ytp-iv-player-content, .ytp-large-play-button, .ytp-bezel, .ytp-chrome-bottom { display: none !important; }" });
}

async function doCode(code: string): Promise<void> {
  const rec = recs.get(code)!;
  const rows = await all<{ label: string; time: string; timezone: string | null; played: number }>(
    "SELECT m.label, m.time, e.timezone, m.played FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND m.code = ? AND m.played = 1 AND m.time IS NOT NULL", [season, code]);
  const played = rows.filter((r) => actualStart(r.time)).map((r) => ({ label: String(r.label), time: String(r.time), epoch: (localToUtcMs(r.time, r.timezone) ?? NaN) / 1000 }))
    .filter((m) => Number.isFinite(m.epoch)).sort((a, b) => a.epoch - b.epoch);
  // A played match with no time the clock can place (the event has no timezone) can't be read: said, not skipped quietly.
  const timeless = rows.filter((r) => actualStart(r.time)).length - played.length;
  if (timeless) report.push(`${code}: ${timeless} played matches not read: no timezone for the event, so their start can't be placed`);
  if (!played.length) return;
  // Divisions of one event can share a stream: each read must be this division's overlay (divisionOf, overlayDivision).
  const [ev] = await all<{ name: string; division_code: string | null }>("SELECT name, division_code FROM events WHERE season = ? AND code = ?", [season, code]);
  const siblings = ev?.division_code ? await all<{ name: string }>("SELECT name FROM events WHERE season = ? AND division_code = ? AND code != ?", [season, ev.division_code, code]) : [];
  const ownDiv = ev ? divisionOf(ev.name) : null, others = siblings.map((x) => divisionOf(x.name));
  const division = ownDiv && others.length && others.every((x): x is string => x != null) ? { own: ownDiv, others: others as string[] } : null;
  const span = await R.eventMatchSpan(season, code);
  const views = played.map((m) => ({ label: m.label, time: m.time, played: true, startsAt: new Date(m.epoch * 1000).toISOString(), clip: undefined as any }));
  // Without this script's own timings: what YouTube's facts alone give.
  const placed = R.withClips(views, rec, Date.now(), span, { frames: false });
  const missing = placed.filter((v) => !v.clip).map((v) => v.label);
  if (CHECK ? !placed.some((v) => v.clip) : !ALL && !VERIFY && !BOUNDS && !missing.length) return;
  // Read on an earlier run (each event is written as it finishes): not again, unless --all.
  // Any of its videos that couldn't be played at all keeps the event unread, so the next run tries it again. (An event's
  // rows are saved once all its videos are read, so a run cut short leaves none of them.)
  // So does a video whose facts YouTube hasn't given yet (it isn't read until they come).
  // Read means each of this event's own videos that holds a played match has a row (by video, not by code: a code
  // recurs from season to season, and a video linked since is new).
  const own = [rec, ...(rec.more ?? [])];
  const waiting = own.some((v) => !v.meta || v.meta.status === "error");
  const holds = (v: (typeof own)[number]) => {
    const m = v.meta;
    if (m?.status !== "ok" || !m.length) return false;
    if (!m.start) return true;
    const a = Date.parse(m.start) / 1000, b = m.end ? Date.parse(m.end) / 1000 : Infinity;
    return played.some((x) => a <= x.epoch && x.epoch <= b);
  };
  const rowOf = (v: (typeof own)[number]) => kept.get(`${v.videoId}|${code}`);
  const read = own.filter(holds).every((v) => { const f = rowOf(v); return f && !Object.values(f.missing ?? {}).some((w) => w.startsWith(PLAY_FAILED)); });
  if (!CHECK && !ALL && !VERIFY && !BOUNDS && !waiting && own.some(holds) && read) return;
  // Checked again once claimed: a lane that passed its check while another was still loading would read past --limit.
  if (++done > limit) return;
  // An event's lines together (events run side by side).
  const lines: string[] = [];
  const log = (s: string) => { lines.push(s); };
  try {
  log(`${code}: ${missing.length} of ${played.length} matches without a clip`);
  const videos = [rec, ...(rec.more ?? [])].filter((v) => v.meta?.status === "ok" && v.meta.length);
  const held = new Set<string>();
  for (const v of videos) {
    const m = v.meta!;
    const from = m.start ? Date.parse(m.start) / 1000 : null;
    // The matches this video holds: inside its broadcast, or, with no broadcast start (an upload), every match no other video holds.
    const windows = videos.map((o) => ({ start: o.meta?.start ? Date.parse(o.meta.start) / 1000 : null, end: o.meta?.end ? Date.parse(o.meta.end) / 1000 : null }));
    const inside = (o: (typeof videos)[number], at: number) => !!o.meta?.start && Date.parse(o.meta.start) / 1000 <= at && (!o.meta.end || at <= Date.parse(o.meta.end) / 1000);
    const lead = (x: (typeof played)[number]) => leadIn(x.epoch, videos.indexOf(v), windows);
    const mine = played.filter((x) => !held.has(x.label) && (from == null ? !videos.some((o) => o !== v && inside(o, x.epoch))
      : (from <= x.epoch && (!m.end || x.epoch <= Date.parse(m.end) / 1000)) || lead(x)));
    // A video read well on an earlier run keeps its row: the event is back for another of its videos (a new link, one
    // that couldn't be played), and a re-read now could place fewer of this one's matches. --all reads it again.
    const prior = kept.get(`${v.videoId}|${code}`);
    if (BOUNDS) {
      // Only a video's first and last frames, for a row read before they were (or every row, with --all).
      if (prior && (ALL || (!prior.opensOn && !prior.endsOn))) await boundsRow(prior, m.length!, division, log);
      continue;
    }
    if (VERIFY) {
      // Only where each clip opens, for a row read before that was checked: its starts stay as read.
      if (prior && (!prior.opens || prior.unconfirmed?.length) && Object.keys(prior.starts).length) await verifyRow(prior, division, log);
      continue;
    }
    if (!CHECK && !ALL && prior && !Object.values(prior.missing ?? {}).some((w) => w.startsWith(PLAY_FAILED))) {
      for (const l of Object.keys(prior.starts)) held.add(l);
      log(`  ${v.videoId}: read on an earlier run, kept`);
      continue;
    }
    if (!mine.length) {
      // Its matches are another video's (FIRST's link and an organiser's recording of the same day): read, with none.
      if (!CHECK && !kept.has(`${v.videoId}|${code}`)) keep(`${v.videoId}|${code}`, { videoId: v.videoId, code, checked: today, starts: {} });
      continue;
    }
    // Made inside the try: a browser that can't open a page fails this video, not the run.
    let page: Page | null = null;
    try {
      page = await player();
      if (division) divisions.set(page, division);
      await open(page, v.videoId);
      log(`  ${v.videoId}: ${mine.length} matches`);
      console.error(`${new Date().toISOString().slice(11, 19)} ${code} ${v.videoId}: ${mine.length} matches`);
      // Live starts whose opening reads nothing stay, unconfirmed (--live).
      const live = LIVE.get(`${v.videoId}|${code}`), unread = new Set<string>();
      let j = await placeVideo(page, mine, from == null ? null : -from, m.length!, log, unread, live);
      // Nothing read at all: a player that never showed the stream (an interstitial, a stalled load) looks the same as a
      // video without the overlay, so it gets one more go in a fresh player before its matches count as missing.
      if (!j.placed.size && !j.review.size && [...j.missing.values()].every((w) => w === NOTHING_READ)) {
        log("    nothing read: again in a fresh player");
        await page.context().close();
        page = await player();
        if (division) divisions.set(page, division);
        await open(page, v.videoId);
        unread.clear();
        j = await placeVideo(page, mine, from == null ? null : -from, m.length!, log, unread, live);
      }
      const out = new Map([...j.placed].map(([l, p]) => [l, p.t]));
      for (const l of out.keys()) held.add(l);
      if (CHECK) {
        const clock = new Map(placed.filter((x) => x.clip?.videoId === v.videoId).map((x) => [x.label, x.clip!.t + CLIP_LEAD_S + (x.clip!.early ?? 0)]));
        const diffs = [...out].filter(([l]) => clock.has(l)).map(([l, s]) => s - clock.get(l)!);
        log(`    frames minus clock: ${diffs.length ? `median ${diffs.sort((a, b) => a - b)[diffs.length >> 1]} s, range ${diffs[0]} to ${diffs.at(-1)} s over ${diffs.length}` : "none to compare"}`);
      } else {
        // Every match the video holds is written: placed with its confidence, for review, or missing with the reason.
        const key = `${v.videoId}|${code}`;
        const sorted = [...j.placed].sort((a, b) => a[1].t - b[1].t);
        const nothing = !j.placed.size && !j.review.size && [...j.missing.values()].every((w) => w === NOTHING_READ);
        // A re-read (--all) that read nothing at all (a player stuck on an interstitial) keeps what an earlier read placed.
        if (nothing && Object.keys(kept.get(key)?.starts ?? {}).length) log("    nothing read: the earlier read is kept");
        else {
          const edges = await readEdges(page, m.length!);
          log(`    opens on ${saidEdge(edges.opensOn)}, ends on ${saidEdge(edges.endsOn, "after")}`);
          keep(key, {
          videoId: v.videoId, code, checked: today,
          starts: Object.fromEntries(sorted.map(([l, p]) => [l, p.t])),
          ...(sorted.some(([, p]) => p.confidence === "medium") ? { medium: sorted.filter(([, p]) => p.confidence === "medium").map(([l]) => l) } : {}),
          ...(j.review.size ? { review: Object.fromEntries(j.review) } : {}),
          ...(j.missing.size ? { missing: Object.fromEntries(j.missing) } : {}),
          ...(j.earlyStart.size ? { earlyStart: Object.fromEntries(j.earlyStart) } : {}),
          opens: Object.fromEntries(j.opens),
          ...(unread.size ? { unconfirmed: [...unread] } : {}),
          ...edges,
          });
        }
      }
    } catch (e) {
      const why = (e as Error).message.split("\n")[0];
      log(`    couldn't play: ${why}`);
      failedVideos++;
      // Its matches get the reason; a row from an earlier read that worked is kept as it was.
      const key = `${v.videoId}|${code}`;
      if (!CHECK && !Object.keys(kept.get(key)?.starts ?? {}).length) {
        keep(key, { videoId: v.videoId, code, checked: today, starts: {}, missing: Object.fromEntries(mine.map((x) => [x.label, `${PLAY_FAILED}: ${why}`])) });
      }
    } finally {
      await page?.context().close().catch(() => {});
    }
  }
  } finally {
    console.log(lines.join("\n"));
    report.push(...lines);
    save();
  }
}

// A few events at a time: most of a read is waiting for YouTube to seek.
const queue = [...codes];
// One event that fails (a database read before its videos) is reported and the lane goes on to the next.
let failedEvents = 0;
const lane = async () => {
  while (queue.length && done < limit) {
    const code = queue.shift()!;
    try { await doCode(code); } catch (e) { failedEvents++; console.error(`${code}: ${(e as Error).message.split("\n")[0]} (not read)`); }
  }
};
await Promise.all(Array.from({ length: lanes }, lane));
// The last save's retry comes before cleanup, and no cleanup step can skip what follows it.
if (!CHECK && !DRY && unsaved) save();
await browser.close().catch(() => {});
await (renewing as Promise<void> | null)?.catch(() => {});
await worker.terminate().catch(() => {});
await digits.terminate().catch(() => {});
if (failedEvents) { console.error(`${failedEvents} events failed before their videos were read`); process.exitCode = 1; }
// Videos that couldn't be played are written as such and read again on the next run, but this run didn't finish them.
if (failedVideos) { console.error(`${failedVideos} videos couldn't be played (written with the reason; the next run reads them again)`); process.exitCode = 1; }
if (!CHECK && !DRY) {
  // The last save may have failed with no save after it (retried above): the run then says so and fails.
  if (unsaved) { console.error("server/data/frameTimings.ts could not be written: this run's timings are lost"); process.exitCode = 1; }
  else console.log(`wrote ${kept.size} videos to server/data/frameTimings.ts`);
}
mkdirSync(".data", { recursive: true });
writeFileSync(".data/video-frames-report.txt", report.join("\n"));
process.exit(process.exitCode ?? 0);
