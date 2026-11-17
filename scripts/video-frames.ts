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
// What it writes: server/data/frameTimings/<season>.ts, the --season's own file and no other (the server plays each match
// from server/data/frameTimings.ts, every season's rows together: server/videos/recordings.ts).
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
//   --clips   read no starts: check each clip the live site plays from the clock by its first frame, paused (ok,
//             pulled when it names another match, unconfirmed when it names none), into server/data/clipChecks.ts
//   --live <file>  the timings the live site serves (a copy of main's server/data/frameTimings/<season>.ts): a re-read start
//             that is one of them (same video, match and second, within a read's slack) and whose opening frame names
//             nothing stays, unconfirmed, as --verify keeps it; only an overlay naming another match pulls a live clip
//   TESSERACT_JS=<path to tesseract.js's entry>  where tesseract.js is, when it isn't in node_modules
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { CLEAR_MAX_S, CLEAR_STEP_S, EDGE_AT, playedCount } from "./lib/videoFrames";
import { AUTO_S, LOSS_S, MATCH_S, OPEN_LEADS, startOffset, OVERLAY_UNREAD, SAME_S, SWITCH_S, TELEOP_S, TRIES, dataRows, divisionOf, elapsed, overlayDivision, overlayEvent, leadIn, judge, NOTHING_READ, overlayBand, overlayLabel, rowAbove, rowLabel, stepOn, autoLeadsTo, eventLabel, timerRan, sameMatch, secondsLoose, secondsOf, secondsPlain, type Judged, type M } from "./lib/videoFrames";

// The command line: --name value or --name=value for the value flags, --name alone for the others. Anything else stops
// the run before it reads: a misspelt flag mustn't quietly read (and write) every recording of the season.
const VALUE_FLAGS = new Set(["season", "codes", "limit", "lanes", "live"]), BOOL_FLAGS = new Set(["all", "bounds", "check", "clips", "dry", "trace", "verify"]);
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
    else { console.error(`${argv[i]}: not a flag this script takes (--season, --codes, --limit, --lanes, --all, --check, --dry, --trace, --verify, --clips, --live <file>)`); process.exit(2); }
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
/** The season's own file of rows: the only file a run writes (a season with no file yet needs one, imported in
 *  server/data/frameTimings.ts, before it can be read). */
const FRAMES_FILE = `server/data/frameTimings/${season}.ts`;
if (!existsSync(FRAMES_FILE)) { console.error(`--season ${season}: no ${FRAMES_FILE} (add it, and its import in server/data/frameTimings.ts)`); process.exit(2); }
const CHECK = flag("check"), ALL = flag("all"), DRY = flag("dry"), TRACE = flag("trace"), VERIFY = flag("verify"), BOUNDS = flag("bounds"), CLIPS = flag("clips");

const { migrate, all } = await import("../server/db.js");
await migrate();
const R = await import("../server/videos/recordings.js");
const { CLIP_LEAD_S, actualStart } = await import("../src/shared/recording.js");
const { localToUtcMs } = await import("../src/shared/time.js");
const { localDate } = await import("../server/videos/officialVideos.js");
const { frameStart } = await import("../server/data/frameTimings.js");
/** --live: what the live site serves, by video and event (its starts). */
const liveRows = (path: string) => {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch (e) { console.error(`--live ${path}: can't be read (${(e as Error).message.split("\n")[0]})`); process.exit(2); }
  // A truncated or hand-edited row stops the run cleanly, before anything is read.
  try { return dataRows<{ videoId: string; code: string; starts: Record<string, number>; medium?: string[] }>(text); } catch (e) { console.error(`--live ${path}: a row doesn't parse (${(e as Error).message.split("\n")[0]})`); process.exit(2); }
};
const LIVE_ROWS = arg("live") ? liveRows(arg("live")!) : [];
const LIVE = new Map<string, Record<string, number>>(LIVE_ROWS.map((f) => [`${f.videoId}|${f.code}`, f.starts]));
/** The live starts placed from the clock between two reads, not read off the video (a row's `medium`): a live clip
 *  a read leaves out keeps that confidence when it goes back for its opening check. */
const LIVE_MEDIUM = new Map<string, Set<string>>(LIVE_ROWS.map((f) => [`${f.videoId}|${f.code}`, new Set(f.medium ?? [])]));
// A --live copy that gives no rows (a wrong file) would protect no live clip: stop, as an unknown --codes does.
if (arg("live") && !LIVE.size) { console.error(`--live ${arg("live")}: no frame timing rows in it (a copy of main's server/data/frameTimings/${season}.ts?)`); process.exit(2); }
type FrameTiming = import("../server/data/frameTimings.js").FrameTiming;
const T: any = await import(process.env.TESSERACT_JS ?? "tesseract.js");
const createWorker = T.createWorker ?? T.default?.createWorker;

type Read = { label: string | null; start: number | null; at: number; text: string; why?: string; division?: "own" | "other" | null };

/** The video's event, when its divisions share a stream: its division's name and its siblings'. Each read says whose
 *  overlay it saw; a sibling's is never this event's match, and a start stands only when a read of it showed this
 *  division's name. */
const divisions = new WeakMap<Page, { own: string; others: string[] }>();
/** Each event's name (events.name), and the event a page reads: a frame whose overlay names another event is never
 *  this one's (overlayEvent: two league meets split on one stream, USTXCAM1 2024). */
const eventNames = new Map<string, { name: string; quals: number }>();
const pageEvent = new WeakMap<Page, { name: string; quals: number }>();

// --- Reading a frame -----------------------------------------------------------------------------------------------

// Three OCR workers shared by every lane (a tesseract.js worker does one job at a time). One that hangs is replaced, or
// every later read would queue behind its stuck job and time out too. `rowOcr` reads the overlay bar's row alone
// (labelRow) with tesseract's own page layout (psm 3, tesseract.js's default being one block, psm 6): read as one
// block, USMNCMPNANO 2024's "Playoff Match 1" comes out "PlayoffMach1"; laid out, as it is.
const ocr = async () => {
  const w = await createWorker("eng"), d = await createWorker("eng"), r = await createWorker("eng");
  await d.setParameters({ tessedit_char_whitelist: "0123456789:", tessedit_pageseg_mode: "7" });
  await r.setParameters({ tessedit_pageseg_mode: "3" });
  return [w, d, r] as const;
};
let [worker, digits, rowOcr] = await ocr();
let renewing: Promise<void> | null = null;
/** Set when hung workers couldn't be replaced: every later read then fails its video at once (written with the reason,
 *  read again next run) instead of queueing behind the stuck job. */
let ocrBroken: string | null = null;
function renewOcr(): Promise<void> {
  renewing ??= (async () => {
    const old = [worker, digits, rowOcr];
    try {
      [worker, digits, rowOcr] = await ocr();
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
  // USNMCMP 2025): with the icon in the crop the OCR reads "1:04" as "11040", so only the digits' row is read (with a
  // margin round them: a tight crop reads 1:37 as 1:29 and 1:22 as 1:92, this one read 1:57 to 1:17 right), and its
  // thin colon, often dropped ("117"), isn't needed (secondsLoose).
  { where: "bottom" as const, clip: { x: 580, y: 647, width: 120, height: 48 }, loose: true },
  // The same white box in a bar across the top (FIRST AGE's top layout, USPAKSN 2026): wider than FIRST Texas's.
  { where: "top" as const, clip: { x: 585, y: 92, width: 110, height: 50 }, loose: true },
];
/** FTC Live's overlay from 2019 to 2022 shows the timer as bare seconds ("30", "112": secondsPlain), in a box over the
 *  scores (SKYSTONE 2019, FREIGHT FRENZY 2021: USCHSCMPCARR) or under the centre graphic (POWERPLAY 2022: AUMPOS1).
 *  Read first for those seasons, before the bars whose crops would catch a score there ("150" reads 1:50 loose), and
 *  never for later ones, whose bars have other numbers in those places. */
const PLAIN_TIMERS = [
  { where: "plain" as const, clip: { x: 595, y: 594, width: 90, height: 36 }, plain: true },
  // POWERPLAY's box, inside the bar it sits on: a crop reaching the bar's coloured edge reads it as a "1" (USCHSCMPVIO
  // 2022 at 5664 s, "78" read "178"), every confirmation of the event's matches failing with it.
  { where: "plain" as const, clip: { x: 605, y: 686, width: 70, height: 30 }, plain: true },
];
/** Best-of-3 semifinals and finals (2019–2023; double elimination from 2024, whose playoffs FIRST numbers M1–M13): the
 *  overlay names every playoff "Semifinal 1 Match 2" or "Finals Match 1", never a bare "Match 1" (overlayLabel).
 *  CENTERSTAGE's (2023) too: USMOKSCMP's M2 opens on "Semifinal 2 Match 1", which a read losing "Semifinal" took
 *  for M1, pulling the clip. */
const SEMIFINALS = season <= 2023;
const TIMER_CROPS: { where: "bottom" | "top" | "plain"; clip: { x: number; y: number; width: number; height: number }; loose?: boolean; plain?: boolean }[] =
  season <= 2022 ? [...PLAIN_TIMERS, ...TIMERS] : TIMERS;

/** The timer's reading. `auto`: whether a reading of 0:30 or less is Auto, told by readAt. */
async function timer(page: Page): Promise<{ where: "bottom" | "top" | "plain"; left: number; auto: boolean } | null> {
  for (const t of TIMER_CROPS) {
    const text = (await digits.recognize(await page.screenshot({ clip: t.clip }))).data.text;
    const left = t.plain ? secondsPlain(text) : t.loose ? secondsLoose(text) : secondsOf(text);
    if (left == null || left > AUTO_S + SWITCH_S + TELEOP_S) continue;
    return { where: t.where, left, auto: false };
  }
  // None of the known places: the bar found in the frame itself (overlayBand), its timer read in the centre column.
  // Read as a bottom bar: a reading over 2:00 is then a 2:30 count's Auto (elapsed), which a 2:00 TeleOp never shows.
  const band = await barBand(page);
  if (!band) return null;
  // The digits fill the bar's upper half; the icon under them (a gamepad, a hand) reads as digits too ("1:17" as "127").
  const top = Math.max(0, band.top - 4);
  const clip = { x: 565, y: top, width: 150, height: Math.min(720, band.top + Math.round((band.bottom - band.top) * 0.55) + 4) - top };
  const left = secondsOf((await digits.recognize(await page.screenshot({ clip }))).data.text);
  return left == null || left > AUTO_S + SWITCH_S + TELEOP_S ? null : { where: "bottom", left, auto: false };
}

/** Where the score bar is in the frame on screen (overlayBand, run in the page on the screenshot's own pixels: a
 *  picture drawn from a data URL never taints the canvas). Null: no bar on screen. */
async function barBand(page: Page): Promise<{ top: number; bottom: number } | null> {
  const png = (await page.screenshot()).toString("base64");
  await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    (window as any).__frame = g.getImageData(0, 0, c.width, c.height);
  }, png);
  return page.evaluate(`(${overlayBand.toString()})(window.__frame.data, window.__frame.width, window.__frame.height)`) as Promise<{ top: number; bottom: number } | null>;
}

const now = (page: Page) => page.evaluate(() => document.querySelector("video")!.currentTime);

/** FTC Live's bottom bar's top row, over the timer's row: the event (or division) on its left half, the match
 *  ("Qualification 8 of 23", "Playoff Match 1") on its right half, read on its own (readRow). */
const LABEL_ROW = { x: 0, y: 548, width: 1280, height: 56 };
/** The match the bottom bar's row names, read on its own: a frame whose whole read names nothing because a busy field
 *  and crowd threw the page layout off, the bar's line lost with it (USARBEQ 2024 Q8 at 7097 s: the whole frame read a
 *  jumble, the row alone "Qualification 8 of 23"). The match's half alone: the whole row can lose it too, to the logo
 *  and event name beside it (USCHSGAQ1 2024 M1 at 19167 s, its half "Playoff Match 1"). Placement reads use it too:
 *  on CENTERSTAGE's (2023) streams nearly every frame of play loses the bar's line in a whole-frame read (NLBNM1 at
 *  3300 s: the row alone "Qualification 4 of 23"), so a video read nothing. A row-named read still needs the timer seen
 *  running and the confirming reads before and after its start, as any read does. On a shared stream the row has to
 *  name this division too (rowLabel), as a whole frame's read does. A bar somewhere else (overlayBand: Arizona's
 *  CENTERSTAGE bar flush with the top, "Qualification 3 of 32" in the strip over it) has the row over it read instead
 *  (rowAbove). CENTERSTAGE's bottom bar sits its line 8 px lower than later seasons' (ROW_LOWER): read at the usual
 *  row, tesseract runs "9 of" into "90f" there (USTXNTM1 2023 at 1108 s), so that row is read too. */
const ROW_LOWER = 8;
type PageEvent = { name: string; quals: number };
async function labelRow(page: Page, ctx: { own: string; others: string[] } | undefined, event?: PageEvent): Promise<string | null> {
  for (const row of [LABEL_ROW, { ...LABEL_ROW, y: LABEL_ROW.y + ROW_LOWER }]) {
    const fixed = await readRow(page, row, ctx, event);
    if (fixed) return fixed;
  }
  const band = await barBand(page);
  const row = band && rowAbove(band, LABEL_ROW);
  return row ? readRow(page, row, ctx, event) : null;
}
/** The row's match half, then (on a shared stream, or where the event is known) the whole row: the event name beside
 *  the match says whose it is (overlayEvent). Another event's is never this one's; on a split screen the match half may
 *  be the other event's, so the match beside this event's name in the row is taken. */
async function readRow(page: Page, row: { x: number; y: number; width: number; height: number }, ctx: { own: string; others: string[] } | undefined, event?: PageEvent): Promise<string | null> {
  const half = (await rowOcr.recognize(await page.screenshot({ clip: { ...row, x: row.width / 2, width: row.width / 2 } }))).data.text as string;
  if (!overlayLabel(half, SEMIFINALS) || (!ctx && !event)) return rowLabel(half, null, undefined, SEMIFINALS);
  const whole = (await rowOcr.recognize(await page.screenshot({ clip: row }))).data.text as string;
  const seen = event ? overlayEvent(whole, event.name, event.quals, SEMIFINALS) : null;
  if (seen?.event === "other") return null;
  const label = rowLabel(half, whole, ctx, SEMIFINALS);
  return label && (seen?.phrase ?? label);
}

/** The match a frame names: the whole frame's read, else the bar's row on its own (labelRow). `division`: whose the
 *  frame is on a shared stream; a match the row named there is this division's (labelRow checked the row). `event`:
 *  "other" where the overlay names another event beside the match (overlayEvent); on a split screen, this event's half. */
async function frameLabel(page: Page, text: string, ctx: { own: string; others: string[] } | undefined): Promise<{ label: string | null; division?: "own" | "other" | null; event?: "other" }> {
  const own = pageEvent.get(page);
  const seen = own ? overlayEvent(text, own.name, own.quals, SEMIFINALS) : null;
  if (seen?.event === "other") return { label: null, division: "other", event: "other" };
  const whole = seen?.label ?? overlayLabel(text, SEMIFINALS);
  const division = ctx ? overlayDivision(text, ctx.own, ctx.others) : undefined;
  if (whole || division === "other") return { label: whole, division };
  const row = await labelRow(page, ctx, own);
  return { label: row, division: row && ctx ? "own" : division };
}

/** Go to second t. Playing (a timer read needs the clock running), the frame read is about a second on by the time
 *  it's taken (LTCMP 2024 Q20: asked 8948, read 8948.9, the overlay already in). `still`: paused at t, so the frame
 *  read is t's own (a clip opening's check: the second the clip opens at is the frame read). */
async function seek(page: Page, t: number, still = false) {
  await page.evaluate(([t, still]) => new Promise((r) => {
    const v = document.querySelector("video")!;
    if (still) v.pause(); else void v.play().catch(() => {});
    v.addEventListener("seeked", r, { once: true }); v.currentTime = t as number; setTimeout(r, 15000);
  }), [t, still] as const);
  await page.waitForFunction((still) => document.querySelector("video")!.readyState >= (still ? 2 : 3), still, { timeout: 20000 }).catch(() => {});
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
  await seek(page, Math.max(0, t), labelOnly);
  const at = await now(page);
  const text = (await worker.recognize(await page.screenshot())).data.text as string;
  const ctx = divisions.get(page);
  const { label, division, event } = await frameLabel(page, text, ctx);
  // Another division's match on the shared stream, or another event's beside its name: not this event's, whatever its number.
  if (division === "other") return { label: null, start: null, at, text, why: event === "other" ? "another event's overlay" : "another division's overlay", division };
  if (!label || labelOnly) return { label, start: null, at, text, division };
  const a = await timer(page);
  const atA = await now(page);
  await page.waitForTimeout(1500);
  const b = await timer(page);
  const atB = await now(page);
  if (!a || !b || a.where !== b.where) return { label, start: null, at, text, why: `timer read ${a ? `${a.where} ${a.left}` : "nothing"}, then ${b ? `${b.where} ${b.left}` : "nothing"}` };
  const ran = a.left - b.left, played = atB - atA;
  // Running: down by the time played (to the second either side). A paused or standing timer: not in play (timerRan).
  if (!timerRan(ran, played)) return { label, start: null, at, text, why: `timer ${a.left} then ${b.left} over ${played.toFixed(1)} s played` };
  // 0:30 or less on either bar: Auto, or the end of TeleOp. 45 s on, Auto has become TeleOp's 2:00 (well over 30 s
  // left); the end of TeleOp has finished. That later frame is the same match by its overlay, or, where the overlay
  // can't be read there, by its TeleOp reading the very second Auto's leads to (2019IASQ4's "Semifinal 2 Match 1",
  // unread 45 s on: its Auto "0:10" was taken for TeleOp's, a start 128 s early).
  if (a.left <= AUTO_S) {
    await seek(page, atA + 45);
    const c = await timer(page);
    const atC = await now(page);
    const { label: named } = await frameLabel(page, (await worker.recognize(await page.screenshot())).data.text as string, ctx);
    a.auto = !!c && c.where === a.where && c.left > AUTO_S && (named === label || (!named && autoLeadsTo(a.left, atC - atA, c.left)));
  }
  const e = elapsed(a);
  return { label, start: e == null ? null : Math.round(atA - e), at, text, division, ...(e == null ? { why: `timer ${a.left} isn't a running match's` } : {}) };
}

/** Seconds into a match the confirming read is tried at, in turn (all TeleOp, well clear of its last 8 s). Spread
 *  over most of TeleOp: a stream may cut away to a camera without the overlay for a minute or more (Romania's
 *  championship cuts to the floor cameras mid-match). */
const CONFIRM_AFTER = [70, 80, 95, 110, 125, 140];
/** The walk through a video for matches with no start time from FIRST (placeVideo): a frame every 75 s; none of the
 *  event's matches named in its first 2 hours (an opening ceremony runs long, a camera-only stream never names one)
 *  stops it. */
const WALK_STEP_S = 75, WALK_BLIND_S = 7200;
/** Seconds into a match an Auto read confirms its start at, in turn, where a later read disagrees by time the video
 *  lost (confirmed). Early: before most of the match, where a cut in the recording is least likely to fall. */
const AUTO_CONFIRM = [12, 20];


/** A read stands only when frames before and after its start agree: 70 s on (TeleOp), the overlay names the same match
 *  and its timer gives the same start; 25 s before, that match isn't running yet. One read alone is never a start
 *  (a wrong match number on screen for a few seconds, a replay, a digit read wrong). */
async function confirmed(page: Page, label: string, start: number, own = false, other?: { start?: number; own?: boolean }): Promise<string | null> {
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
        // The first read came after a cut, or took Auto for TeleOp's end ("period"): the other start may be the real
        // one (checked by the caller, in full). Its division evidence goes with it: a read here that showed the own
        // division counts for the other start too.
        if ((off === "gained" || off === "period") && other) { other.start = at.start; other.own = own; }
        return `${after} s on its timer gave a start ${Math.round(at.start - start)} s off`;
      }
      why = "";
      break;
    }
    why = at.label ? `${CONFIRM_AFTER.join(", ")} s on its timer wasn't read running (last: ${at.why})` : `${CONFIRM_AFTER.join(", ")} s on the overlay read nothing`;
  }
  if (why) return why;
  const before = await readAt(page, start - 25);
  if (before.label === label) own ||= before.division === "own";
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
 * share, not a sibling division's). Tried 20, 12, 5, 2 and 0 s before its start (OPEN_LEADS); the first that names it
 * is where the clip opens. One that names another match there (the previous match's result still up) is tried closer
 * in; a match whose clip can't open on it goes to review, and one whose overlay can't be read there at all is missing
 * with OVERLAY_UNREAD. A read that fails leaves the openings not yet checked unread: a live clip stays unconfirmed, a new
 * placement is missing with PLAY_FAILED, so the next run reads the video again. Nothing is a clip unchecked.
 */
async function checkOpenings(page: Page, j: Judged, log: (s: string) => void, unread?: Set<string>, live?: Record<string, number>): Promise<void> {
  const failed: string[] = [];
  // A read that fails (a hang, OCR broken) leaves that opening, and the rest after it, unchecked: never the video's
  // other starts, which stand as placed.
  let broken = false;
  const isLive = (label: string, t: number) => !live || (live[label] != null && Math.abs(live[label] - t) <= SAME_S);
  for (const [label, p] of [...j.placed]) {
    if (j.opens.has(label)) continue; // checked on an earlier --verify
    let named: string | null = null, at: number | null = null;
    for (const lead of broken ? [] : OPEN_LEADS) {
      const t = p.t - lead;
      if (t < 0) continue;
      let r: Read;
      try { r = await readAt(page, t, true); } catch (e) { broken = true; log(`    an opening read failed (${(e as Error).message.split("\n")[0]}): the rest are left unchecked`); break; }
      // A seek that never landed shows whatever frame was up before (the last read's): that frame names nothing here.
      if (Math.abs(r.at - t) > 1) { log(`    ${label}: the opening read at ${t} s landed at ${Math.round(r.at)} s; not counted`); continue; }
      if (r.division === "other") { named = "another division's match"; continue; }
      // The overlay names a replay (a tiebreak's "M6-2") by its match alone ("M6"), as placeVideo reads it; a
      // semifinal's match by its series and number ("M1-2"), that match only (sameMatch).
      if (sameMatch(r.label ?? "", label)) { at = t; break; }
      if (r.label) named = eventLabel(r.label);
    }
    if (at != null) { j.opens.set(label, at); continue; }
    if (broken) {
      // Not checked: a live clip stays unconfirmed; a new placement waits for the video's next read.
      if (unread && isLive(label, p.t)) unread.add(label);
      else { j.placed.delete(label); failed.push(label); j.missing.set(label, `${PLAY_FAILED}: an opening read failed, so its opening wasn't checked`); }
      continue;
    }
    // A clip already live (--verify, or a re-read start the live site serves: --live) whose opening frame named nothing
    // (blank, a transition, a cutaway) stays, to be read again: only an overlay naming another match pulls it.
    if (unread && !named && isLive(label, p.t)) { unread.add(label); continue; }
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
    { const e = eventNames.get(row.code); if (e) pageEvent.set(page, e); }
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
    await closePage(page);
  }
}

// --- The recording's edges ----------------------------------------------------------------------------------------

type Edge = { at: number; label?: string; played?: number; of?: number; fromEnd?: number; clear?: boolean; underway?: boolean };
/** What a recording's first and last frames show (EDGE_AT from each end): the first frame from that end that names a
 *  match (this division's; another's names none) or counts the matches played. None does, and none shows a timer: read
 *  on every CLEAR_STEP_S (up to CLEAR_MAX_S, or half the video) while each frame shows no match at all, and the first
 *  that names one is the edge, "clear" of matches before it. A timer on screen with no match named: no edge. */
async function readEdges(page: Page, length: number): Promise<{ opensOn?: Edge; endsOn?: Edge }> {
  // A seek that never landed shows the frame that was up before (as in checkOpenings): it is no edge, and the stretch
  // it stood for wasn't seen, so it can't count toward "clear" either.
  const named = async (t: number): Promise<Edge | null | "missed"> => {
    const r = await readAt(page, t, true);
    if (Math.abs(r.at - t) > 1) return "missed";
    // A sibling division's frame on a shared stream is never this event's edge: neither its match nor its count.
    if (r.division === "other") return null;
    const n = playedCount(r.text);
    // Stored as the event names the match (a semifinal's first match "M2-1" is the event's M2), so outsideRecording
    // finds it among the event's matches.
    const label = r.label && eventLabel(r.label);
    return label || n ? { at: Math.round(t), ...(label ? { label } : {}), ...(n ? { played: n.played, of: n.of } : {}) } : null;
  };
  const edge = async (from: (s: number) => number): Promise<Edge | undefined> => {
    let quiet = true;
    for (const s of EDGE_AT) {
      const t = from(s);
      if (t < 0 || t > length) continue;
      const e = await named(t);
      if (e === "missed") { quiet = false; continue; }
      if (e) return e;
      if (quiet && await timer(page)) quiet = false;
    }
    if (!quiet) return undefined;
    for (let s = EDGE_AT[EDGE_AT.length - 1] + CLEAR_STEP_S; s <= Math.min(CLEAR_MAX_S, length / 2); s += CLEAR_STEP_S) {
      const e = await named(from(s));
      if (e === "missed") return undefined;
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
  const end = await edge((s) => length - s);
  const endsOn = end && { ...end, fromEnd: Math.max(0, Math.round(length - end.at)) };
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
    { const e = eventNames.get(row.code); if (e) pageEvent.set(page, e); }
    await open(page, row.videoId);
    const { opensOn, endsOn } = await readEdges(page, length);
    log(`  ${row.videoId}: opens on ${saidEdge(opensOn)}, ends on ${saidEdge(endsOn, "after")}`);
    // An edge this read didn't find keeps the one read before: a retry never erases a proven edge.
    keep(`${row.videoId}|${row.code}`, { ...row, ...(opensOn ? { opensOn } : {}), ...(endsOn ? { endsOn } : {}) });
  } catch (e) {
    log(`    couldn't read its edges: ${(e as Error).message.split("\n")[0]} (the row is kept as it was)`);
    failedVideos++;
  } finally {
    await closePage(page);
  }
}

// --- Finding each match --------------------------------------------------------------------------------------------

/** The second each of a video's matches starts at, as far as its frames show. `shift`: the video's second for a moment
 *  minus that moment (epoch seconds), when YouTube gives the broadcast's start (an upload has none). */
async function placeVideo(page: Page, ms: M[], shift: number | null, length: number, log: (s: string) => void, unread?: Set<string>, live?: Record<string, number>, liveMedium?: Set<string>): Promise<Judged> {
  // The overlay names a replay ("M14-2", a tiebreak) by its match alone (M14), and a semifinal's match by its series
  // and number ("M1-2" is that match only): each name, its matches in order (sameMatch).
  const byName = { get: (n: string) => { const is = ms.flatMap((m, i) => (sameMatch(n, m.label) ? [i] : [])); return is.length ? is : undefined; } };
  const seen = new Map<number, number>(); // index → confirmed start second
  const tried = new Set<number>(); // matches a read named, confirmed or not
  let namedAny = false; // a frame named one of the event's matches, timer read or not: the player showed the stream
  const from = pageReads.get(page) ?? 0, reads = () => (pageReads.get(page) ?? 0) - from;
  // At most a few reads per match, every read counted (confirming ones too): checked before each read or confirmation.
  // A recording cut mid-match costs extra confirming reads (confirmed, autoAgrees): 4 a match left a cut stream's later
  // matches unread (USIAPOMPM11 2025, 81 frames of 72).
  // Reads spent finding the matches when the clock reads nothing (scan) are added: they place none (USNMCMP 2025, 61
  // frames of scanning, then 232 left M1–M5 in a gap unread).
  let budget = Math.max(60, 8 * ms.length);
  let unconfirmed = 0;
  const near = (i: number): number | null => {
    // The distance of the read nearest by order, else the broadcast's.
    let best: number | null = null, d = Infinity;
    // Not a scheduled match's read: its time is hours from when it was played, so it says nothing of the clock.
    for (const [k, s] of seen) if (!ms[k].scheduled && Math.abs(k - i) < d) { d = Math.abs(k - i); best = s - ms[k].epoch; }
    return best ?? shift;
  };
  /** The distances of the nearest reads before and after a match by order (one where they agree), else the broadcast's. */
  const sides = (i: number): number[] => {
    const ks = [...seen.keys()].filter((k) => !ms[k].scheduled);
    const before = ks.filter((k) => k < i).sort((a, b) => b - a)[0], after = ks.filter((k) => k > i).sort((a, b) => a - b)[0];
    const ds = [before, after].filter((k): k is number => k != null).map((k) => seen.get(k)! - ms[k].epoch).sort((a, b) => Math.abs(a - near(i)!) - Math.abs(b - near(i)!));
    if (!ds.length) return shift == null ? [] : [shift];
    return ds.length === 2 && Math.abs(ds[0] - ds[1]) <= SAME_S ? [ds[0]] : ds;
  };
  const note = async (r: Read) => {
    const named = r.label ? byName.get(r.label) : undefined;
    if (named) namedAny = true;
    if (!named || r.start == null) return;
    // A match with replays and nothing yet to place the read against (no read placed, no broadcast clock): which of
    // them it shows can't be told, so the read is left rather than guessed.
    if (named.length > 1 && near(named[0]) == null) return;
    // Of a match and its replays, the one whose clock place (by the nearest read's distance) the read's start is nearest.
    const off = (k: number) => Math.abs(r.start! - (ms[k].epoch + (near(k) ?? 0)));
    const i = named.reduce((a, b) => (off(b) < off(a) ? b : a));
    tried.add(i);
    if (seen.has(i) || reads() >= budget) return;
    const other: { start?: number; own?: boolean } = {};
    const no = await confirmed(page, r.label!, r.start, r.division === "own", other);
    if (no == null) { seen.set(i, r.start); return; }
    // The read came after a cut in the recording (a later read gives a later start): the later start, checked the same way.
    if (other.start != null && reads() < budget && (await confirmed(page, r.label!, other.start, r.division === "own" || !!other.own)) == null) {
      seen.set(i, other.start);
      log(`    ${r.label} at ${r.start} s read after a cut in the video, or Auto taken for TeleOp; its start is ${other.start} s`);
      return;
    }
    unconfirmed++;
    log(`    ${r.label} at ${r.start} s not confirmed: ${no}`);
  };

  /** A clip already live that this read left out (one read of it out of order, a gap the reads around it disagree on:
   *  FPEWESEA 2025 Q97–Q100) goes back to its live second, where its opening decides it, as for any start: its overlay
   *  there keeps it, another match's pulls it, nothing read leaves it unconfirmed. Only a frame pulls a live clip. Not
   *  when no frame named any of the event's matches (a stuck player): the video is read again on a fresh player, or its
   *  earlier row kept, as before. And as judge places any start: inside the video, in played order, a match apart from
   *  this read's placements; one that isn't conflicts with what the frames show here, and goes to review saying with
   *  what. Then every placed start's opening is checked. */
  const liveBack = async (j: Judged) => {
    const order = new Map(ms.map((m, i) => [m.label, i]));
    if (live && namedAny) for (const [label, t] of Object.entries(live)) {
      if (j.placed.has(label) || !order.has(label)) continue;
      const i = order.get(label)!;
      const confidence = liveMedium?.has(label) ? "medium" : "high";
      // As judge allows: two starts read off the video closer than a match by no more than a cut loses (the recording
      // skipped the end of the first) both stand.
      const close = (p: { t: number; confidence: string }) => Math.abs(p.t - t) < MATCH_S - SAME_S && !(confidence === "high" && p.confidence === "high" && Math.abs(p.t - t) >= MATCH_S - LOSS_S);
      const clash = [...j.placed].find(([o, p]) => close(p) || (order.get(o)! < i) !== (p.t < t));
      j.missing.delete(label); j.earlyStart.delete(label);
      if (t < 0 || t + MATCH_S > length + SAME_S) { j.review.set(label, { t, why: "a live clip this read finds outside the video" }); continue; }
      if (clash) { j.review.set(label, { t, why: `a live clip this read finds ${clash[0]} too close to or out of order with (${clash[0]} at ${Math.round(clash[1].t)} s)` }); continue; }
      j.review.delete(label);
      j.placed.set(label, { t, confidence });
    }
    await checkOpenings(page, j, log, live ? unread : undefined, live);
  };

  // Any match at all, a frame every 10 minutes: where there's no clock to go by (an upload), or the clock's guesses read
  // nothing (a broadcast whose start YouTube has wrong).
  // A scan frame that names a match whose timer isn't running (the field being set before it, its score after it) has
  // that match within minutes: a minute on at a time, SCAN_AHEAD times at most, until a timer is read running (stepOn).
  // USTXNTM1 2023's upload: every scan frame named a match between two (Q11, Q13, Q15), none with its clock running.
  const scan = async () => {
    for (let t = 300; t < length && !seen.size && reads() < budget; t += 600) {
      let r = await readAt(page, t);
      const named = !!r.label;
      await note(r);
      for (let k = 1; stepOn(named, r.start, k) && !seen.size && t + 60 * k < length && reads() < budget; k++) await note(r = await readAt(page, t + 60 * k));
    }
  };
  // Matches with only their scheduled time (M.scheduled) have no clock to look for them by: the video is walked a frame
  // every WALK_STEP_S (each match's 2:38 shows on at least two), past each match once its start is confirmed. A video
  // naming none of its matches in its first WALK_BLIND_S has no overlay to read: the walk stops there.
  if (ms.some((m) => m.scheduled)) {
    budget += Math.ceil(length / WALK_STEP_S);
    for (let t = WALK_STEP_S; t < length && reads() < budget && (namedAny || t < WALK_BLIND_S);) {
      const r = await readAt(page, t);
      await note(r);
      const confirmedHere = r.start != null && [...seen.values()].some((s) => Math.abs(s - r.start!) <= SAME_S);
      t = confirmedHere ? Math.max(t + WALK_STEP_S, r.start! + MATCH_S + 20) : t + WALK_STEP_S;
    }
    log(`    walked for matches with no start time from FIRST: ${seen.size} read, ${reads()} frames`);
  }
  if (shift == null) {
    await scan();
    if (!seen.size) {
      log("    no match found in it");
      // Its frames named matches without a start confirmed (an upload): live clips still go back for their openings.
      const j = judge(ms, seen, shift, length, tried);
      if (live && namedAny) await liveBack(j);
      return j;
    }
  }

  // A video without FTC Live's overlay (a camera-only stream) reads nothing: stop after a few matches in a row with no
  // read at all. Any video: never more than a few reads per match.
  let missed = 0;
  const blind = () => missed >= MISSES && !seen.size;
  async function anchor(i: number): Promise<number | null> {
    // A match with only its scheduled time is the walk's (above): its time says nothing of where the video sits.
    if (ms[i].scheduled) return null;
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

  // The first and last match, then the middle of any stretch whose ends disagree: each stretch's left half before its
  // right, kept on a list of stretches still to read (no function calling itself).
  async function span(first: number, last: number): Promise<void> {
    const todo: [number, number][] = [[first, last]];
    while (todo.length) {
      let [i, j] = todo.pop()!;
      let a = await anchor(i), b = await anchor(j);
      // A match that can't be read: its neighbour inward stands in.
      while (a == null && i < j && !blind() && reads() < budget) a = await anchor(++i);
      while (b == null && j > i && !blind() && reads() < budget) b = await anchor(--j);
      if (a == null || b == null) continue;
      if (Math.abs((a - ms[i].epoch) - (b - ms[j].epoch)) <= SAME_S || j - i <= 1) continue;
      const mid = (i + j) >> 1;
      todo.push([mid, j], [i, mid]);
    }
  }
  await span(0, ms.length - 1);
  // The matches before the first read, each from the nearest read's distance now (the clock alone may put them before
  // the video's start): the first that can't be read ends it.
  const before = async () => {
    const firstSeen = Math.min(...seen.keys());
    for (let i = firstSeen - 1; i >= 0 && Number.isFinite(firstSeen) && !blind() && reads() < budget; i--) if ((await anchor(i)) == null) break;
  };
  await before();
  if (blind() && shift != null) {
    await scan();
    if (seen.size) {
      log(`    the clock read nothing; found by scanning, ${reads()} frames in`);
      budget += reads();
      missed = 0;
      await span(0, ms.length - 1);
      await before();
    }
  }
  if (blind()) log(`    no overlay read in ${reads()} frames`);
  const j = judge(ms, seen, shift, length, tried);
  await liveBack(j);
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
    if (s == null || m.scheduled) continue;
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
const kept = new Map<string, FrameTiming>(dataRows<FrameTiming>(readFileSync(FRAMES_FILE, "utf8")).map((f) => [`${f.videoId}|${f.code}`, { ...f, starts: { ...f.starts } }]));
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
  const file = FRAMES_FILE;
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
      writeFileSync(file, `${head}// --- Data (scripts/video-frames.ts writes from here on) ---\nexport const ROWS: FrameTiming[] = [\n${rows}\n];\n`);
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

// --- Live clock clips checked by their first frame (--clips) ----------------------------------------------------------

/** server/data/clipChecks.ts: the sweep's rows (owner decision 2026-11-15, "verify old"). */
const CLIPS_FILE = "server/data/clipChecks.ts";
type ClipCheck = import("../server/data/clipChecks.js").ClipCheck;
const clipKept = new Map<string, ClipCheck>(CLIPS ? dataRows<ClipCheck>(readFileSync(CLIPS_FILE, "utf8")).map((c) => [`${c.videoId}|${c.code}`, c]) : []);
const clipTouched = new Set<string>();
/** A video's clips read with nothing named at all (and at least this many read): its overlay can't be read, so its
 *  clips can't be checked by frame (counted, never pulled). */
const NO_OVERLAY_AFTER = 5;

/** Write the sweep's rows (as save() writes the timings: rows this run didn't touch are taken from the file). */
function saveClips(): void {
  if (DRY) return;
  const text = readFileSync(CLIPS_FILE, "utf8");
  const onDisk = new Map(dataRows<ClipCheck>(text).map((c) => [`${c.videoId}|${c.code}`, c]));
  for (const [key, c] of onDisk) if (!clipTouched.has(key)) clipKept.set(key, c);
  const list = [...clipKept.values()].sort((a, b) => a.code.localeCompare(b.code) || a.videoId.localeCompare(b.videoId));
  writeFileSync(CLIPS_FILE, `${text.split("// --- Data")[0]}// --- Data (scripts/clip-checks.ts writes from here on) ---\nexport const CLIP_CHECKS: ClipCheck[] = [\n${list.map((c) => `  ${JSON.stringify(c)},`).join("\n")}\n];\n`);
}

/** --clips: each clip the live site plays from the clock (not from frames: those are checked where they're placed,
 *  `opens`) is read paused at its first second, as a clip's opening is (checkOpenings). The frame names its match: ok.
 *  It names another match (or another division's): pulled, never served again. It names nothing: unconfirmed, read
 *  again next sweep; nothing ever pulls a clip but a frame naming another match. Clips already ok or pulled, and videos
 *  without a readable overlay, aren't read again. */
async function checkClips(code: string, rec: Parameters<typeof R.withClips>[1], views: Parameters<typeof R.withClips>[0], span: Parameters<typeof R.withClips>[3], division: { own: string; others: string[] } | null): Promise<void> {
  const todo = new Map<string, { label: string; t: number }[]>();
  for (const v of R.withClips(views, rec, Date.now(), span)) {
    const c = v.clip as { videoId: string; t: number } | undefined;
    if (!c || frameStart(c.videoId, code, v.label) != null) continue;
    const row = clipKept.get(`${c.videoId}|${code}`);
    if (row?.noOverlay || row?.ok?.includes(v.label) || row?.pulled?.[v.label]) continue;
    (todo.get(c.videoId) ?? todo.set(c.videoId, []).get(c.videoId)!).push({ label: v.label, t: c.t });
  }
  if (!todo.size || ++done > limit) return;
  const lines: string[] = [];
  const log = (s: string) => { lines.push(s); };
  try {
    log(`${code}: ${[...todo.values()].reduce((s, x) => s + x.length, 0)} clock clips to check by their first frame`);
    for (const [videoId, clips] of todo) {
      const key = `${videoId}|${code}`, prev = clipKept.get(key);
      const ok = new Set(prev?.ok ?? []), pulled = { ...prev?.pulled }, unconfirmed = { ...prev?.unconfirmed };
      let page: Page | null = null, named = 0, read = 0;
      try {
        page = await player();
        if (division) divisions.set(page, division);
        await open(page, videoId);
        for (const c of clips) {
          const r = await readAt(page, c.t, true);
          // A seek that never landed shows the frame before it: that says nothing of this clip.
          if (Math.abs(r.at - c.t) > 1) { unconfirmed[c.label] = { t: c.t, why: `the read at ${c.t} s landed at ${Math.round(r.at)} s` }; continue; }
          read++;
          delete unconfirmed[c.label];
          if (r.division === "other") { named++; pulled[c.label] = { t: c.t, showed: "another division's match" }; }
          else if (r.label && sameMatch(r.label, c.label)) { named++; ok.add(c.label); }
          else if (r.label) { named++; pulled[c.label] = { t: c.t, showed: eventLabel(r.label) }; }
          else unconfirmed[c.label] = { t: c.t, why: "its first frame names no match" };
        }
        const noOverlay = !named && read >= NO_OVERLAY_AFTER && !ok.size && !Object.keys(pulled).length;
        log(`  ${videoId}: ${clips.length} clips · ${ok.size} ok · ${Object.keys(pulled).length} pulled${Object.keys(pulled).length ? ` (${Object.entries(pulled).map(([l, p]) => `${l} at ${p.t} s shows ${p.showed}`).join(", ")})` : ""} · ${Object.keys(unconfirmed).length} unconfirmed${noOverlay ? " · no readable overlay" : ""}`);
        clipKept.set(key, {
          videoId, code, season, checked: today,
          ...(ok.size ? { ok: [...ok] } : {}),
          ...(Object.keys(pulled).length ? { pulled } : {}),
          ...(!noOverlay && Object.keys(unconfirmed).length ? { unconfirmed } : {}),
          ...(noOverlay ? { noOverlay: true as const } : {}),
        });
        clipTouched.add(key);
      } catch (e) {
        // Not played, or a read that hung: nothing written for this video, so the next sweep reads it again.
        log(`  ${videoId}: couldn't check (${(e as Error).message.split("\n")[0]}); read again next sweep`);
        failedVideos++;
      } finally {
        await closePage(page);
      }
    }
  } finally {
    console.log(lines.join("\n"));
    report.push(...lines);
    saveClips();
  }
}

/** A fresh player page (its own browser context). */
async function player(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // tsx names the functions it hands the page with a helper of its own: the page gets one that does nothing.
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  return ctx.newPage();
}

/** A step that can wait on a frozen page with no timeout of its own (a page's evaluate, closing its context): failed
 *  after `s` seconds instead, or the run waits forever (a --verify sat idle 50 minutes, 2026-11-16). */
function within<T>(p: Promise<T>, s: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} hung over ${s} s`)), s * 1000); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
/** Close a player page's context, never waiting on a frozen one. */
const closePage = (page: Page | null) => (page ? within(page.context().close(), 15, "closing the player").catch(() => {}) : Promise.resolve());

/** Load a video in the privacy-enhanced embed, playing, with nothing drawn over the overlay (90 s at most). */
const open = (page: Page, videoId: string) => within(openOnce(page, videoId), 90, "opening the video");
async function openOnce(page: Page, videoId: string): Promise<void> {
  await page.goto(`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&rel=0&iv_load_policy=3&cc_load_policy=0`, { referer: "https://controlscout.org/" });
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 2, null, { timeout: 30000 });
  // No captions over the overlay.
  await page.evaluate(() => { try { (document.querySelector("#movie_player") as any)?.unloadModule?.("captions"); } catch { /* none */ } });
  // Auto-captions sit right over the bottom bar's timer, and the embed's own bars over the top: hidden.
  // The newer embed also draws the video's title (often the event's name) over the top of a paused frame, outside
  // #movie_player: hidden too, or the event-name check (overlayEvent) could read the title instead of the overlay.
  // Only the title pieces, never their containers (#player-controls, #player-control-overlay): hiding those turns a
  // PLAYING frame pure black (USNVCMP 2024: 30 of 30 black; this rule: 77 of 77 drawn, top bar clear).
  await page.addStyleTag({ content: ".ytp-caption-window-container, .caption-window, .ytp-chrome-top, .ytp-pause-overlay, .ytp-show-cards-title, .ytp-ce-element, .ytp-player-content.ytp-iv-player-content, .ytp-large-play-button, .ytp-bezel, .ytp-chrome-bottom, player-top-controls, .ytwPlayerTopControlsHost, embedded-player-video-details, .ytmCuedOverlayGradient { display: none !important; }" });
}

async function doCode(code: string): Promise<void> {
  const rec = recs.get(code)!;
  const rows = await all<{ label: string; time: string; timezone: string | null; played: number }>(
    "SELECT m.label, m.time, e.timezone, m.played FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND m.code = ? AND m.played = 1 AND m.time IS NOT NULL", [season, code]);
  // A match FIRST gives only its scheduled time for (2019's qualifications) is read too, by its frames alone (M.scheduled):
  // its time orders it among the others and places nothing.
  const played = rows.map((r) => ({ label: String(r.label), time: String(r.time), epoch: (localToUtcMs(r.time, r.timezone) ?? NaN) / 1000, ...(actualStart(r.time) ? {} : { scheduled: true }) }))
    .filter((m) => Number.isFinite(m.epoch)).sort((a, b) => a.epoch - b.epoch);
  // A played match with no time the clock can place (the event has no timezone) can't be read: said, not skipped quietly.
  const timeless = rows.length - played.length;
  if (timeless) report.push(`${code}: ${timeless} played matches not read: no timezone for the event, so their start can't be placed`);
  if (!played.length) return;
  // Divisions of one event can share a stream: each read must be this division's overlay (divisionOf, overlayDivision).
  const [ev] = await all<{ name: string; division_code: string | null }>("SELECT name, division_code FROM events WHERE season = ? AND code = ?", [season, code]);
  // Its name and qualification total, to tell its overlay from another event's on the same stream (overlayEvent).
  const [q] = await all<{ n: number }>("SELECT COUNT(*) AS n FROM matches WHERE season = ? AND code = ? AND label LIKE 'Q%'", [season, code]);
  if (ev?.name) eventNames.set(code, { name: ev.name, quals: Number(q?.n ?? 0) });
  const siblings = ev?.division_code ? await all<{ name: string }>("SELECT name FROM events WHERE season = ? AND division_code = ? AND code != ?", [season, ev.division_code, code]) : [];
  const ownDiv = ev ? divisionOf(ev.name) : null, others = siblings.map((x) => divisionOf(x.name));
  const division = ownDiv && others.length && others.every((x): x is string => x != null) ? { own: ownDiv, others: others as string[] } : null;
  const span = await R.eventMatchSpan(season, code);
  const views = played.map((m) => ({ label: m.label, time: m.time, played: true, startsAt: new Date(m.epoch * 1000).toISOString(), clip: undefined as any }));
  // Without this script's own timings: what YouTube's facts alone give.
  // --clips: the clips the live site plays from the clock, checked by their first frame; nothing else.
  if (CLIPS) return checkClips(code, rec, views, span, division);
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
  // --verify: an event none of whose rows still has openings to check doesn't count against --limit.
  if (VERIFY && !own.some((v) => { const f = rowOf(v); return f && (!f.opens || f.unconfirmed?.length) && Object.keys(f.starts).length; })) return;
  // --bounds: likewise an event none of whose rows still lacks an edge (every row, with --all).
  if (BOUNDS && !own.some((v) => { const f = rowOf(v); return f && (ALL || !f.opensOn || !f.endsOn); })) return;
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
    // A match with only its scheduled time can't be put in a broadcast's window by it (2019IASQ4's Q1 "04:15" local,
    // its stream starting 11:00): it's in the event's only video, or in the one broadcast (or listed) on its day, the
    // venue's date (a Saturday 09:00 broadcast in Sydney starts on Friday in UTC).
    const day = v.day ?? (m.start ? localDate(m.start, rows[0]?.timezone) : undefined);
    const mine = played.filter((x) => !held.has(x.label) && (x.scheduled ? videos.length === 1 || !day || x.time.slice(0, 10) === day
      : from == null ? !videos.some((o) => o !== v && inside(o, x.epoch))
      : (from <= x.epoch && (!m.end || x.epoch <= Date.parse(m.end) / 1000)) || lead(x)));
    // A video read well on an earlier run keeps its row: the event is back for another of its videos (a new link, one
    // that couldn't be played), and a re-read now could place fewer of this one's matches. --all reads it again.
    const prior = kept.get(`${v.videoId}|${code}`);
    if (BOUNDS) {
      // Only a video's first and last frames, for a row read before they were (or every row, with --all).
      if (prior && (ALL || !prior.opensOn || !prior.endsOn)) await boundsRow(prior, m.length!, division, log);
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
      { const e = eventNames.get(code); if (e) pageEvent.set(page, e); }
      await open(page, v.videoId);
      log(`  ${v.videoId}: ${mine.length} matches`);
      console.error(`${new Date().toISOString().slice(11, 19)} ${code} ${v.videoId}: ${mine.length} matches`);
      // Live starts whose opening reads nothing stay, unconfirmed (--live).
      const live = LIVE.get(`${v.videoId}|${code}`), liveMedium = LIVE_MEDIUM.get(`${v.videoId}|${code}`), unread = new Set<string>();
      let j = await placeVideo(page, mine, from == null ? null : -from, m.length!, log, unread, live, liveMedium);
      // Nothing read at all: a player that never showed the stream (an interstitial, a stalled load) looks the same as a
      // video without the overlay, so it gets one more go in a fresh player before its matches count as missing.
      if (!j.placed.size && !j.review.size && [...j.missing.values()].every((w) => w === NOTHING_READ)) {
        log("    nothing read: again in a fresh player");
        await closePage(page);
        page = await player();
        if (division) divisions.set(page, division);
        { const e = eventNames.get(code); if (e) pageEvent.set(page, e); }
        await open(page, v.videoId);
        unread.clear();
        j = await placeVideo(page, mine, from == null ? null : -from, m.length!, log, unread, live, liveMedium);
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
          // The edges are read after the matches are placed: one that fails keeps the placed row, without edges (a
          // later --bounds reads them).
          const edges = await readEdges(page, m.length!).catch((e: Error) => {
            log(`    couldn't read its edges: ${e.message.split("\n")[0]} (the row is kept without them)`);
            return {} as { opensOn?: Edge; endsOn?: Edge };
          });
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
      await closePage(page);
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
await rowOcr.terminate().catch(() => {});
if (failedEvents) { console.error(`${failedEvents} events failed before their videos were read`); process.exitCode = 1; }
// Videos that couldn't be played are written as such and read again on the next run, but this run didn't finish them.
if (failedVideos) { console.error(`${failedVideos} videos couldn't be played (written with the reason; the next run reads them again)`); process.exitCode = 1; }
if (!CHECK && !DRY) {
  // The last save may have failed with no save after it (retried above): the run then says so and fails.
  if (unsaved) { console.error(`${FRAMES_FILE} could not be written: this run's timings are lost`); process.exitCode = 1; }
  else console.log(`wrote ${kept.size} videos to ${FRAMES_FILE}`);
}
mkdirSync(".data", { recursive: true });
writeFileSync(".data/video-frames-report.txt", report.join("\n"));
process.exit(process.exitCode ?? 0);
