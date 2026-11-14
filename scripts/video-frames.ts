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
//   TESSERACT_JS=<path to tesseract.js's entry>  where tesseract.js is, when it isn't in node_modules
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { AUTO_S, SAME_S, SWITCH_S, TELEOP_S, TRIES, elapsed, judge, NOTHING_READ, overlayLabel, secondsOf, type Judged, type M } from "./lib/videoFrames";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const season = Number(arg("season") ?? 2025);
const only = arg("codes")?.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const limit = Number(arg("limit") ?? Infinity);
const CHECK = flag("check"), ALL = flag("all"), DRY = flag("dry");

const { migrate, all } = await import("../server/db.js");
await migrate();
const R = await import("../server/videos/recordings.js");
const { actualStart } = await import("../src/shared/recording.js");
const { localToUtcMs } = await import("../src/shared/time.js");
const { FRAME_TIMINGS } = await import("../server/data/frameTimings.js");
type FrameTiming = (typeof FRAME_TIMINGS)[number];
const T: any = await import(process.env.TESSERACT_JS ?? "tesseract.js");
const createWorker = T.createWorker ?? T.default?.createWorker;

type Read = { label: string | null; start: number | null; at: number; text: string };

// --- Reading a frame -----------------------------------------------------------------------------------------------

const worker = await createWorker("eng");
const digits = await createWorker("eng");
await digits.setParameters({ tessedit_char_whitelist: "0123456789:", tessedit_pageseg_mode: "7" });

/** The timer's places: FTC Live's bar along the bottom, or its box over the field under a bar across the top (FTC
 *  Ontario's layout) ("bottom"); or a bar along the top (FIRST Texas's layout, "top"). Each counts a 0:30 Auto, then a
 *  2:00 TeleOp (elapsed, scripts/lib/videoFrames.ts). */
const TIMERS = [
  { where: "bottom" as const, clip: { x: 565, y: 618, width: 150, height: 86 } },
  { where: "top" as const, clip: { x: 603, y: 101, width: 74, height: 38 } },
  { where: "bottom" as const, clip: { x: 565, y: 175, width: 150, height: 68 } },
];

/** The timer's reading. `auto`: whether a reading of 0:30 or less is Auto, told by readAt. */
async function timer(page: Page): Promise<{ where: "bottom" | "top"; left: number; auto: boolean } | null> {
  for (const t of TIMERS) {
    const left = secondsOf((await digits.recognize(await page.screenshot({ clip: t.clip }))).data.text);
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
function readAt(page: Page, t: number): Promise<Read> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    readAtOnce(page, t).finally(() => clearTimeout(timer)),
    new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`a frame read at ${Math.round(t)} s hung over ${READ_LIMIT_S} s`)), READ_LIMIT_S * 1000); }),
  ]);
}

async function readAtOnce(page: Page, t: number): Promise<Read> {
  await seek(page, Math.max(0, t));
  const at = await now(page);
  const text = (await worker.recognize(await page.screenshot())).data.text as string;
  const label = overlayLabel(text);
  if (!label) return { label, start: null, at, text };
  const a = await timer(page);
  const atA = await now(page);
  await page.waitForTimeout(1500);
  const b = await timer(page);
  const atB = await now(page);
  if (!a || !b || a.where !== b.where) return { label, start: null, at, text };
  const ran = a.left - b.left, played = atB - atA;
  // Running: down by the time played (to the second either side). A paused or standing timer: not in play.
  if (played < 0.5 || Math.abs(ran - played) > 1.6) return { label, start: null, at, text };
  // 0:30 or less on either bar: Auto, or the end of TeleOp. 45 s on, Auto has become TeleOp's 2:00 (well over 30 s
  // left); the end of TeleOp has finished.
  if (a.left <= AUTO_S) {
    await seek(page, atA + 45);
    const c = await timer(page);
    a.auto = !!c && c.where === a.where && c.left > AUTO_S && overlayLabel((await worker.recognize(await page.screenshot())).data.text) === label;
  }
  const e = elapsed(a);
  return { label, start: e == null ? null : Math.round(atA - e), at, text };
}

/** A read stands only when frames before and after its start agree: 70 s on (TeleOp), the overlay names the same match
 *  and its timer gives the same start; 25 s before, that match isn't running yet. One read alone is never a start
 *  (a wrong match number on screen for a few seconds, a replay, a digit read wrong). */
async function confirmed(page: Page, label: string, start: number): Promise<string | null> {
  const at = await readAt(page, start + 70);
  if (at.label !== label) return `70 s on the overlay read ${at.label ?? "nothing"}`;
  if (at.start == null) return "70 s on its timer wasn't read running";
  if (Math.abs(at.start - start) > SAME_S) return `70 s on its timer gave a start ${Math.round(at.start - start)} s off`;
  const before = await readAt(page, start - 25);
  if (before.label === label && before.start != null) return `25 s before it was already running (start ${Math.round(before.start - start)} s off)`;
  return null;
}

/** Matches in a row with no read before a video counts as one without the overlay. */
const MISSES = 3;

// --- Finding each match --------------------------------------------------------------------------------------------

/** The second each of a video's matches starts at, as far as its frames show. `shift`: the video's second for a moment
 *  minus that moment (epoch seconds), when YouTube gives the broadcast's start (an upload has none). */
async function placeVideo(page: Page, ms: M[], shift: number | null, length: number, log: (s: string) => void): Promise<Judged> {
  const byLabel = new Map(ms.map((m, i) => [m.label, i]));
  const seen = new Map<number, number>(); // index → confirmed start second
  const tried = new Set<number>(); // matches a read named, confirmed or not
  let reads = 0, unconfirmed = 0;
  const near = (i: number): number | null => {
    // The distance of the read nearest by order, else the broadcast's.
    let best: number | null = null, d = Infinity;
    for (const [k, s] of seen) if (Math.abs(k - i) < d) { d = Math.abs(k - i); best = s - ms[k].epoch; }
    return best ?? shift;
  };
  const note = async (r: Read) => {
    if (!r.label || r.start == null || !byLabel.has(r.label)) return;
    const i = byLabel.get(r.label)!;
    tried.add(i);
    if (seen.has(i)) return;
    reads += 2;
    const no = await confirmed(page, r.label, r.start);
    if (no == null) seen.set(i, r.start);
    else { unconfirmed++; log(`    ${r.label} at ${r.start} s not confirmed: ${no}`); }
  };

  // Any match at all, a frame every 10 minutes: where there's no clock to go by (an upload), or the clock's guesses read
  // nothing (a broadcast whose start YouTube has wrong).
  const scan = async () => { for (let t = 300; t < length && !seen.size; t += 600) { await note(await readAt(page, t)); reads++; } };
  if (shift == null) {
    await scan();
    if (!seen.size) { log("    no match found in it"); return judge(ms, seen, shift, length, tried); }
  }

  // A video without FTC Live's overlay (a camera-only stream) reads nothing: stop after a few matches in a row with no
  // read at all. Any video: never more than a few reads per match.
  let missed = 0;
  const blind = () => missed >= MISSES && !seen.size;
  const budget = Math.max(40, 4 * ms.length);
  async function anchor(i: number): Promise<number | null> {
    if (seen.has(i)) return seen.get(i)!;
    if (blind() || reads >= budget) return null;
    for (let k = 0; k < TRIES; k++) {
      const est = ms[i].epoch + near(i)!;
      // Into the match (its timer running), then either side of where it should be.
      const t = est + [45, 100, -40, 160, -120, 240, -240][k];
      if (t < 0 || t > length) continue;
      const r = await readAt(page, t);
      reads++;
      await note(r);
      if (seen.has(i)) { missed = 0; return seen.get(i)!; }
    }
    missed++;
    return null;
  }

  // The first and last match, then the middle of any stretch whose ends disagree.
  async function span(i: number, j: number): Promise<void> {
    let a = await anchor(i), b = await anchor(j);
    // A match that can't be read: its neighbour inward stands in.
    while (a == null && i < j && !blind() && reads < budget) a = await anchor(++i);
    while (b == null && j > i && !blind() && reads < budget) b = await anchor(--j);
    if (a == null || b == null) return;
    if (Math.abs((a - ms[i].epoch) - (b - ms[j].epoch)) <= SAME_S || j - i <= 1) return;
    const mid = (i + j) >> 1;
    await span(i, mid);
    await span(mid, j);
  }
  await span(0, ms.length - 1);
  if (blind() && shift != null) {
    await scan();
    if (seen.size) { log(`    the clock read nothing; found by scanning, ${reads} frames in`); missed = 0; await span(0, ms.length - 1); }
  }
  if (blind()) log(`    no overlay read in ${reads} frames`);
  const j = judge(ms, seen, shift, length, tried);
  const out = new Map([...j.placed].map(([l, p]) => [l, p.t]));
  const high = [...j.placed.values()].filter((p) => p.confidence === "high").length;
  log(`    ${out.size} of ${ms.length} placed (${high} high, ${out.size - high} medium), ${seen.size} read, ${unconfirmed} reads not confirmed, ${reads} frames`);
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
const kept = new Map<string, FrameTiming>(FRAME_TIMINGS.map((f) => [`${f.videoId}|${f.code}`, { ...f, starts: { ...f.starts } }]));
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const today = new Date().toISOString().slice(0, 10);
let done = 0;
const report: string[] = [];

/** Write the timings kept so far (after each event, so a run cut short keeps what it read). */
function save() {
  if (CHECK || DRY) return;
  const file = "server/data/frameTimings.ts";
  const head = readFileSync(file, "utf8").split("// --- Data")[0];
  const list = [...kept.values()].sort((a, b) => a.code.localeCompare(b.code) || a.videoId.localeCompare(b.videoId));
  const rows = list.map((f) => `  ${JSON.stringify(f)},`).join("\n");
  writeFileSync(file, `${head}// --- Data (scripts/video-frames.ts writes from here on) ---\nexport const FRAME_TIMINGS: FrameTiming[] = [\n${rows}\n];\n`);
}

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
  const played = rows.filter((r) => actualStart(r.time)).map((r) => ({ label: String(r.label), time: String(r.time), epoch: localToUtcMs(r.time, r.timezone)! / 1000 }))
    .filter((m) => Number.isFinite(m.epoch)).sort((a, b) => a.epoch - b.epoch);
  if (!played.length) return;
  const span = await R.eventMatchSpan(season, code);
  const views = played.map((m) => ({ label: m.label, time: m.time, played: true, startsAt: new Date(m.epoch * 1000).toISOString(), clip: undefined as any }));
  // Without this script's own timings: what YouTube's facts alone give.
  const placed = R.withClips(views, rec, Date.now(), span, { frames: false });
  const missing = placed.filter((v) => !v.clip).map((v) => v.label);
  if (CHECK ? !placed.some((v) => v.clip) : !ALL && !missing.length) return;
  // Read on an earlier run (each event is written as it finishes): not again, unless --all.
  if (!CHECK && !ALL && [...kept.values()].some((f) => f.code === code)) return;
  done++;
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
    const mine = played.filter((x) => !held.has(x.label) && (from == null ? !videos.some((o) => o !== v && o.meta?.start && Date.parse(o.meta.start) / 1000 <= x.epoch && (!o.meta.end || x.epoch <= Date.parse(o.meta.end) / 1000))
      : from <= x.epoch && (!m.end || x.epoch <= Date.parse(m.end) / 1000)));
    if (!mine.length) continue;
    let page = await player();
    try {
      await open(page, v.videoId);
      log(`  ${v.videoId}: ${mine.length} matches`);
      console.error(`${new Date().toISOString().slice(11, 19)} ${code} ${v.videoId}: ${mine.length} matches`);
      let j = await placeVideo(page, mine, from == null ? null : -from, m.length!, log);
      // Nothing read at all: a player that never showed the stream (an interstitial, a stalled load) looks the same as a
      // video without the overlay, so it gets one more go in a fresh player before its matches count as missing.
      if (!j.placed.size && !j.review.size && [...j.missing.values()].every((w) => w === NOTHING_READ)) {
        log("    nothing read: again in a fresh player");
        await page.context().close();
        page = await player();
        await open(page, v.videoId);
        j = await placeVideo(page, mine, from == null ? null : -from, m.length!, log);
      }
      const out = new Map([...j.placed].map(([l, p]) => [l, p.t]));
      for (const l of out.keys()) held.add(l);
      if (CHECK) {
        const clock = new Map(placed.filter((x) => x.clip?.videoId === v.videoId).map((x) => [x.label, x.clip!.t + 20]));
        const diffs = [...out].filter(([l]) => clock.has(l)).map(([l, s]) => s - clock.get(l)!);
        log(`    frames minus clock: ${diffs.length ? `median ${diffs.sort((a, b) => a - b)[diffs.length >> 1]} s, range ${diffs[0]} to ${diffs.at(-1)} s over ${diffs.length}` : "none to compare"}`);
      } else {
        // Every match the video holds is written: placed with its confidence, for review, or missing with the reason.
        const key = `${v.videoId}|${code}`;
        const sorted = [...j.placed].sort((a, b) => a[1].t - b[1].t);
        kept.set(key, {
          videoId: v.videoId, code, checked: today,
          starts: Object.fromEntries(sorted.map(([l, p]) => [l, p.t])),
          ...(sorted.some(([, p]) => p.confidence === "medium") ? { medium: sorted.filter(([, p]) => p.confidence === "medium").map(([l]) => l) } : {}),
          ...(j.review.size ? { review: Object.fromEntries(j.review) } : {}),
          ...(j.missing.size ? { missing: Object.fromEntries(j.missing) } : {}),
        });
      }
    } catch (e) {
      log(`    couldn't play: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      await page.context().close();
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
const lane = async () => { while (queue.length && done < limit) await doCode(queue.shift()!); };
await Promise.all(Array.from({ length: Math.max(1, Number(arg("lanes") ?? 3)) }, lane));
await browser.close();
await worker.terminate();
await digits.terminate();
if (!CHECK && !DRY) console.log(`wrote ${kept.size} videos to server/data/frameTimings.ts`);
writeFileSync(".data/video-frames-report.txt", report.join("\n"));
process.exit(0);
