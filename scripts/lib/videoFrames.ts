// The pure parts of scripts/video-frames.ts: reading FTC Live's overlay text, the timer's elapsed time, and placing a
// video's matches from the frames read. Kept apart so they can be tested without a browser.

/** A played match: its label and its real start (epoch seconds, from FIRST's actual start time). */
/** A match the video holds: its label and its start (epoch seconds). `scheduled`: FIRST gives only its scheduled time
 *  (2019's qualifications: "04:34:00" in Missouri, whole minutes), not when it was played, so `epoch` orders it and
 *  says nothing of where it sits: it's placed only where its own frames show it (judge). */
export type M = { label: string; epoch: number; scheduled?: boolean };

/**
 * An event's played matches as a read goes by them, in played order, each with its time (null: none). A match with no
 * time at all (results posted with none: the Chicago Robotics Invitational's) is read as a scheduled one is, by its
 * frames alone (M.scheduled), ordered after the timed ones by its label (`rank`, labelRank); `epoch` only orders it. A
 * time the event's zone can't place (none known) leaves its match out (the caller says so).
 */
export function playedMatches(
  rows: { label: string; time: string | null; timezone: string | null }[],
  f: { utcMs: (time: string, timezone: string | null) => number | null; actual: (time: string | null) => boolean; rank: (label: string) => number },
): (M & { time: string | null })[] {
  const timed = rows.filter((r) => r.time != null)
    .map((r) => ({ label: String(r.label), time: String(r.time), epoch: (f.utcMs(String(r.time), r.timezone) ?? NaN) / 1000, ...(f.actual(r.time) ? {} : { scheduled: true }) }))
    .filter((m) => Number.isFinite(m.epoch)).sort((a, b) => a.epoch - b.epoch);
  const after = timed.length ? timed[timed.length - 1].epoch : 0;
  const untimed = rows.filter((r) => r.time == null).map((r) => String(r.label)).sort((a, b) => f.rank(a) - f.rank(b))
    .map((label, i) => ({ label, time: null, epoch: after + 1 + i, scheduled: true }));
  return [...timed, ...untimed];
}

/** Two reads closer than this (seconds) are the same distance: the timer reads to the second, and the frame read lags it. */
export const SAME_S = 6;
/** The most frames read looking for one match. */
export const TRIES = 7;
/** Reads a match between two reads gets of its own once the video's budget is spent: each side's tries and a confirm. */
export const GAP_READS = 2 * TRIES + 4;
/** A DECODE match: 30 s of Auto, 8 s to switch, 2:00 of TeleOp (FTC Live's timer stops between them). */
export const AUTO_S = 30, SWITCH_S = 8, TELEOP_S = 120;

/** The match an overlay names: "Qualification 21 of 36" → Q21, "Finals Match 2" → F2, "Playoff Match 7" or just
 *  "Match 7" (a playoff on 2025's overlay) → M7; anything else none. A frame's label only counts with its timer seen
 *  running and confirmed a minute on (scripts/video-frames.ts), so a bracket screen or schedule naming a match, with no
 *  timer running, gives no start. `semifinals`: the event's playoffs are best-of-3 semifinals and finals (2019–2023),
 *  whose overlay names each as "Semifinal 1 Match 2" or "Finals Match 1": a bare "Match 1" there is one of those read
 *  with its first word lost (2019IASQ4's "Finals Match 1" read "Match 1"), so it names none. */
export function overlayLabel(text: string, semifinals = false): string | null {
  const q = /Qualification\s+(\d{1,3})\s+of\s+\d{1,3}/i.exec(text);
  if (q) return `Q${Number(q[1])}`;
  // "Finals" with a letter the OCR reads as another ("Finais", "Fnals").
  const f = /(?<!Semi-?\s?)\bF[il1]?na[il1|]s?\s+Match\s+(\d)\b/i.exec(text);
  if (f) return `F${Number(f[1])}`;
  // Best-of-3 semifinals (2019–2023's playoffs): "Semifinal 2 Match 1" is the second semifinal's first match, the
  // event's M2 (series 2, number 1), and "Semifinal 1 Match 2" is its M1-2, never M2. Named with series and number
  // ("M2-1", "M1-2") so it's never taken for a replay (sameMatch).
  const sf = /Semi-?\s?finals?\s+(\d)\s+Match\s+(\d)\b/i.exec(text);
  if (sf) return `M${Number(sf[1])}-${Number(sf[2])}`;
  if (semifinals) return null;
  // A full-screen card can name several matches: a bracket ("Up Next Match 4", "Winner advances to Playoff Match 7") or
  // a result ("Match 6", "Advances to: Playoff Match 8"). A match it says a team advances to is a later one, never the
  // one on screen; of the rest, two different numbers name no one match, so the frame names none (CAONMIQ 2025). A
  // "Test Match 1" is the field check before the event's matches start (USNMCMP 2025 opens on one): none of its matches.
  // A bracket's boxes ("M4 vs A5", "M3 vs A6", "M8") make it one even where its "advances to" line is cut off at the
  // top (USIAWESTLT 2025 M3: "Playoff Match 5" alone): three different M-numbers, and the frame names no match, unless
  // its header says which is up next ("Up Next  Match 4", CAONMIQ 2025).
  const next = /Up\s+Next\W+(?:Playoff\s+)?Match\s+(\d{1,2})\b/i.exec(text);
  if (next) return `M${Number(next[1])}`;
  if (new Set([...text.matchAll(/\bM(\d{1,2})\b/g)].map((m) => m[1])).size >= 3) return null;
  const named = new Set<number>();
  // FIRST DIVE's 2024 playoff bar puts the bracket's next steps beside the match on screen ("Winner → Match 7",
  // "Loser → Match 5", AUCMP and FPECA 2024): those are later matches too, whatever the arrow reads as.
  // A results banner ("Scan for detailed Playoff Match 3 results", USNYEXHJQ 2025 beside its M4) names the match
  // just played, never the one on screen.
  for (const m of text.matchAll(/(advances\s+to:?\s+(?:Playoff\s+)?|\bTest\s+|\b(?:Winner|Lo[s5]er)[^A-Za-z0-9\n]{0,8})?\bMatch\s+(\d{1,2})\b(\s+results\b)?/gi)) if (!m[1] && !m[3]) named.add(Number(m[2]));
  return named.size === 1 ? `M${[...named][0]}` : null;
}

/** Whether a timer read twice `played` seconds of video apart ran: down by the time played, to the second either
 *  side, and down at all. A timer standing still is no match in play however little was played between the reads:
 *  RIQUAL3 2019's "30" waiting for the next match, read 1.6 s apart, passed as running and gave starts 150 s early. */
export const timerRan = (ran: number, played: number) => played >= 0.5 && ran >= 1 && Math.abs(ran - played) <= 1.6;

/** Whether a timer reading `later` seconds after an Auto reading of `left` is that same match's TeleOp, to within 3 s:
 *  Auto's rest, the 8 s switch, then TeleOp counting down from 2:00. The end of TeleOp (the other way to read a
 *  reading of 0:30 or less) leads to a finished match, never to that reading. */
export function autoLeadsTo(left: number, later: number, reading: number): boolean {
  const into = later - left - SWITCH_S;
  return into > 0 && into < TELEOP_S && Math.abs(reading - (TELEOP_S - into)) <= 3;
}

/** Whether a frame's match (overlayLabel) is the event's match `label`. A semifinal's ("M1-2": series and number) is
 *  that match only: the event's M1 is "M1-1", its M1-2 "M1-2". Any other ("M6", 2025's overlay) also names its
 *  replays ("M6-2", a tiebreak), which that overlay names by their match alone. */
export function sameMatch(named: string, label: string): boolean {
  if (/^M\d+-\d+$/.test(named)) return (/^M\d+$/.test(label) ? `${label}-1` : label) === named;
  return named === label.replace(/-\d+$/, "");
}

/** A frame's match (overlayLabel) as the event names it, where that's one match: a semifinal's first match ("M2-1")
 *  is the event's M2; every other name is the event's own already ("M1-2", "Q4", "F1"; "M6" of 2025's overlay, whose
 *  replays it can't tell apart, stays "M6"). What a recording's edge stores (opensOn, endsOn), so outsideRecording
 *  finds the match in the event's order. */
export const eventLabel = (named: string) => named.replace(/^(M\d+)-1$/, "$1");

/** FTC Live's rankings card counts the matches played so far ("4 / 23 matches played"): the count and the total. */
export function playedCount(text: string): { played: number; of: number } | null {
  const m = /(\d{1,3})\s*\/\s*(\d{1,3})\s+matches\s+played/i.exec(text);
  return m && Number(m[1]) <= Number(m[2]) ? { played: Number(m[1]), of: Number(m[2]) } : null;
}

/** A player's duration as a video length: whole seconds, or null for a live stream (Infinity), nothing loaded (NaN, 0). */
export const wholeLength = (d: number): number | null => (Number.isFinite(d) && d >= 1 ? Math.round(d) : null);

/** Seconds from a recording's start (or back from its end) its edge is read at, in turn: the first frame that names a
 *  match or counts the matches played is the edge (within EDGE_S, server/data/frameTimings.ts). */
export const EDGE_AT = [3, 20, 45, 75, 110];
/** Where none of those frames names a match (a stream opening on an empty field, USORIMLT 2025), the edge is read on
 *  every CLEAR_STEP_S, up to CLEAR_MAX_S in, until one does: under a match's 2:38, so a match played in that stretch
 *  would show on at least two of the frames. Every frame before it showing no match makes it the edge ("clear"). */
export const CLEAR_STEP_S = 60;
export const CLEAR_MAX_S = 2400;

/** "2:25" → 145; anything else null. */
export const secondsOf = (s: string) => { const m = /(\d):([0-5]\d)/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** secondsOf, where the font's colon is too thin for the OCR to keep ("1:17" read "117", FIRST AGE's white box): the
 *  whole reading is one timer, with or without its colon, at most 2:59. */
export const secondsLoose = (s: string) => { const m = /^([0-2]):?([0-5]\d)$/.exec(s.replace(/\s/g, "")); return m ? Number(m[1]) * 60 + Number(m[2]) : secondsOf(s); };
/** A crop of a bottom bar, for the same bar flipped to the top of a `height`-tall frame: the bar's rows in reverse, so
 *  what sat `n` px off the bottom edge sits `n` px off the top (POWERPLAY's timer at y 686 of 720, 4 px above the
 *  bottom, is at y 4 in Arizona's flipped bar). */
export const flippedClip = (c: { x: number; y: number; width: number; height: number }, height = 720) => ({ ...c, y: height - c.y - c.height });

/** The fewest characters a piece of YouTube's title (or channel) shown over the frame must have to count as it: a
 *  shorter text ("FTC", "2025", a team number) is as likely the overlay's own. */
export const TITLE_MIN = 8;
const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
/**
 * The texts on screen that are YouTube's title or channel name (`texts`: each visible text in the player page, as
 * visibleTexts lists them), by their indexes. A text counts when it is the title or channel, or a piece of either at
 * least TITLE_MIN long (the newer embed cuts a long title to a line). The title often IS the event's name ("FTC
 * Harrisonburg 1 Qualifier"), so a frame showing it names the event whatever its score bar says: the event-name check
 * (overlayEvent) took such frames for this event's.
 */
export function titleLeaks(title: string, channel: string, texts: string[]): number[] {
  const whole = [squash(title), squash(channel)].filter((t) => t.length > 0);
  const out: number[] = [];
  texts.forEach((raw, i) => {
    const t = squash(raw).replace(/(?:\.{3}|…)$/, "").trim();
    if (!t) return;
    if (whole.some((w) => t === w || (t.length >= TITLE_MIN && w.includes(t)))) out.push(i);
  });
  return out;
}

/** A self-contained function's call, as a script for the page to run. tsx names each function it compiles with a
 *  helper of its own (`__name(walk, "walk")`), which a page doesn't have: the call brings a do-nothing one along, so it
 *  runs on any page, not only those the reader's player() gave one (visibleTexts under tsx: "__name is not defined"). */
export const inPage = (fn: { toString(): string }): string => `(() => { const __name = (f) => f; return (${fn.toString()})(); })()`;

/**
 * Each visible text in the page (a leaf element's own text, shadow roots included), in document order; the elements
 * are kept on window.__texts in the same order, so the reader can hide one by its index. Visible: a box on screen,
 * not hidden by display, visibility or opacity on it or any ancestor. Self-contained (no imports, no outer names): the
 * reader runs it in the page.
 */
export function visibleTexts(): string[] {
  const els: Element[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if ((el as HTMLElement).shadowRoot) walk((el as HTMLElement).shadowRoot!);
      if (el.children.length || !(el.textContent ?? "").trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      let shown = true;
      for (let e: Element | null = el; e && shown; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null)) {
        const c = getComputedStyle(e);
        if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) shown = false;
      }
      if (shown) els.push(el);
    }
  };
  walk(document);
  (window as any).__texts = els;
  return els.map((e) => (e.textContent ?? "").trim());
}

/** The order the timer's crops are tried in: `first` (the crop the frame's bar names, or whose clock last ran) ahead,
 *  the rest in their usual order. A `first` that isn't one of them changes nothing. */
export const cropOrder = <T>(crops: readonly T[], first?: T | null): T[] =>
  first != null && crops.includes(first) ? [first, ...crops.filter((c) => c !== first)] : [...crops];

/** A timer that shows bare seconds (FTC Live's overlay from 2019 to 2022: Auto's "30" down to "0", the switch's "8" to
 *  "0", TeleOp's "120" to "0"): one to three digits and nothing else, at most TeleOp's 120. A colon is another bar's
 *  timer, never this one. */
export const secondsPlain =(s: string) => { const m = /^\d{1,3}$/.exec(s.replace(/\s/g, "")); return m && Number(m[0]) <= TELEOP_S ? Number(m[0]) : null; };

/** Seconds since the match started, from its timer (where it's running: a timer standing at its full time is a match
 *  not started yet). Either bar counts Auto down from 0:30, then TeleOp from 2:00, so a reading of 0:30 or less is Auto
 *  only when `auto` says so (readAt tells it by a second read 45 s on); some bottom bars instead count the whole match
 *  down from 2:30, Auto being above 2:00. */
export function elapsed(t: { where: "bottom" | "top" | "plain"; left: number; auto: boolean }): number | null {
  // Between Auto and TeleOp the timer counts down the 8 s to pick up the controllers ("0:05" under a hand): the same
  // digits as TeleOp's last seconds. Either could be meant, so no reading that low is used.
  if (t.left <= SWITCH_S) return null;
  if (t.auto) return t.left >= AUTO_S ? null : AUTO_S - t.left;
  if (t.where === "bottom" && t.left > TELEOP_S) return t.left >= AUTO_S + TELEOP_S ? null : AUTO_S + TELEOP_S - t.left;
  return t.left >= TELEOP_S ? null : AUTO_S + SWITCH_S + TELEOP_S - t.left;
}

/** A match's start in the video, and how sure: "high" (a confirmed read, with another read or the broadcast's own
 *  clock agreeing on how far the video sits from the clock), "medium" (between two reads that agree). */
export type Placed = { t: number; confidence: "high" | "medium" };
/** What a video's frames say about each of its matches: placed, for review (one signal only, or implausible), or
 *  missing with the reason. */
export type Judged = {
  placed: Map<string, Placed>; review: Map<string, { t: number; why: string }>; missing: Map<string, string>;
  /** A match whose frame start lands inside the previous match's play (both read off the video): when it starts, and
   *  when the previous one's play ends. */
  earlyStart: Map<string, { t: number; previousEnds: number }>;
  /** Each placed match's clip start: the first second, of those tried before its start, whose overlay names it
   *  (filled by the reader's opening check, never by judge). */
  opens: Map<string, number>;
};

/** Why a match is missing when no frame of its video could be read at all. */
export const NOTHING_READ = "no frame of the video could be read";
/** A match FIRST gives only a scheduled time for (M.scheduled) that no frame walked through the video showed running. */
export const SCHEDULED_UNREAD = "no start time from FIRST, and no frame of it read";

/** The least a match can take in a video: 30 s Auto, 8 s switch, 2:00 TeleOp. Two placed starts closer than this
 *  overlap. */
export const MATCH_S = AUTO_S + SWITCH_S + TELEOP_S;
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

/** Where a clip opens: OPEN_LEADS in order, the first second whose frame names the match (`names` reads it: true names
 *  it, false doesn't, "stop" when the read failed and no more are tried). Every lead-in second (20 … 0 s before) is
 *  tried before the start's +2 and +4, so a clip opens late only where no frame before its start names it. */
export async function firstOpening(start: number, names: (t: number) => Promise<boolean | "stop">): Promise<number | null> {
  for (const lead of OPEN_LEADS) {
    const t = start - lead;
    if (t < 0) continue;
    const r = await names(t);
    if (r === "stop") return null;
    if (r) return t;
  }
  return null;
}

/** The reason a placed match whose clip opening couldn't be checked gets: never a clip, never a clock reason. */
export const OVERLAY_UNREAD = "overlay could not be read at its clip's start";

/** The most a recording loses in one cut, as a confirming read can explain it (USIAPOMPM11 2025 loses 19 s mid-match). */
export const LOSS_S = 60;

/**
 * How a confirming read's start compares with the start it checks, the confirming read being later in the match. A
 * recording can be cut mid-match (a stream that dropped a few seconds): the video loses time, never gains it, so a read
 * after the cut gives an earlier start by the time lost ("lost"), and a start that a later read puts later came from a
 * read after a cut itself ("gained": the later start is the one to check). Later by TeleOp's 2:00 and the 8 s switch
 * ("period"): the first read took an Auto reading for TeleOp's last 30 s (its overlay unread 45 s on, USCHSCHQ2 2022
 * Q16), and the later start is the one to check, as after a cut. Further off, it's another start ("other").
 */
export function startOffset(start: number, later: number): "same" | "lost" | "gained" | "period" | "other" {
  const off = later - start;
  if (Math.abs(off) <= SAME_S) return "same";
  if (off < 0 && -off <= LOSS_S) return "lost";
  if (off > 0 && off <= LOSS_S) return "gained";
  if (Math.abs(off - (TELEOP_S + SWITCH_S)) <= SAME_S) return "period";
  return "other";
}

/** A division's own name from its event's ("Romania Championship - COANDA Division" → "COANDA"), or null. */
export function divisionOf(name: string): string | null {
  const m = /\s[-–]\s*(.+?)\s+Division\s*$/i.exec(name.trim());
  return m ? m[1] : null;
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whose division an overlay names, when an event's divisions share a stream (one feed cutting between fields): "own",
 * "other" (a sibling division's name is on it), or null (no division name read: the ticker scrolled it off).
 */
export function overlayDivision(text: string, own: string, others: string[]): "own" | "other" | null {
  const t = plain(text);
  const has = (d: string) => new RegExp(`(^|[^A-Z])${escape(plain(d)).replace(/\s+/g, "\\s+")}([^A-Z]|$)`).test(t);
  if (others.some(has)) return "other";
  return has(own) ? "own" : null;
}

/** Words in an event's name that say nothing about which event it is. */
const GENERIC = new Set(["LEAGUE", "MEET", "QUALIFIER", "QUALIFIERS", "CHAMPIONSHIP", "CHAMPIONSHIPS", "FTC", "FIT", "FIRST",
  "TECH", "CHALLENGE", "DIVISION", "EVENT", "THE", "AND", "STATE", "REGIONAL", "MATCH", "PLAYOFF", "FINALS", "QUALIFICATION",
  // The season's logo beside the name ("FIRST DIVE", "CANOPY", "INTO THE DEEP", "BIOBUZZ presented by RTX").
  "DIVE", "CANOPY", "INTO", "DEEP", "DECODE", "BIOBUZZ", "CENTERSTAGE", "POWERPLAY", "FREIGHT", "FRENZY", "ULTIMATE", "GOAL",
  "SKYSTONE", "PRESENTED", "QUALCOMM", "RTX", "ENERGIZE"]);
const words = (s: string) => (plain(s).match(/[A-Z]{3,}/g) ?? []).filter((w) => !GENERIC.has(w));
/** The short tokens of a name that `words` drops: a league or stage letter (FiT-North's X-League), AM/PM, a meet's
 *  number or time ("Lawson Meet @ 8 AM"). */
const shortTokens = (s: string) => new Set((plain(s).match(/[A-Z0-9]+/g) ?? []).filter((t) => t.length <= 2));
/** Whether a name read beside a match clashes with this event's in a short token: one of this event's is missing and
 *  another stands in the read ("U" for "X", "10 30" for "8"). Sibling meets of one day share every long word. */
export function shortClash(read: string, own: string): boolean {
  const mine = shortTokens(own), seen = shortTokens(read);
  return [...mine].some((t) => !seen.has(t)) && [...seen].some((t) => !mine.has(t));
}
/** Where the overlay names a match, and the event name just before it on the same line. */
// A semifinal (2019–2022's "Semifinal 2 Match 1", or "Semifinals Match 1" with its series lost) is taken whole, before
// its "finals Match 1" or "Match 1" could be: overlayLabel names it by series and number (M2-1), or none.
const MATCH_PHRASE = /Qualification\s+\d{1,3}\s+of\s+(\d{1,3})|Semi-?\s?finals?(?:\s+\d)?\s+Match\s+\d\b|(?:Playoff\s+|F[il1]?na[il1|]s?\s+)?Match\s+\d{1,2}\b/gi;

/** Whose a match's "of M" is, by the event's qualification total: its own; or, where the read is the start of the
 *  total's digits, nothing to tell by (OCR loses a last digit: USNVCMP 2024's "of 46" read "of 4" at 2700 s, its own
 *  Q7 taken for another event's); any other M another event's. */
function totalSays(total: number, quals: number): "own" | "other" | null {
  if (total === quals) return "own";
  return String(quals).startsWith(String(total)) ? null : "other";
}

/**
 * Which event a frame's overlay names: "own" (this event), "other" (another event: two league meets split on one
 * stream, USTXCAM1 2024 its right half, the left "FiT-Central North San Antonio League Meet 1 — Qualification 3 of 24"),
 * or null (nothing to tell by). Two things beside a match say whose it is:
 * - its "of M", against the event's qualification total (`quals`), where its name isn't read (often lost to OCR:
 *   USTXCAM1's left half read "—E— Qualification 3 of 24"): any other M is another event's, or a misread.
 * - the event name before it on its line, which decides where read. The ticker scrolls and cuts names at either end and orders their words its
 *   own way ("…n Division Michiana Premier Event -", "Austin Semi-Area Championship" for FiT-Central Semi-Area
 *   Championship Austin), so a name is another event's only where at least two of its telling words of four letters or
 *   more are read and fewer than half of its words are this event's (a cut word matching the start or end of one). A
 *   logo misread beside the match is no name: POWERPLAY's (2022) "FIRST ENERGIZE" read "FIRST ZN=RGIZ= swe" on KZCMP's
 *   playing frames, two words, neither this event's, and every one of its matches was taken for another event's.
 *   Nor can a name overrule a total either way: a total that is this event's stands over a name read as another's (a
 *   misread), and another event's total over a name read as this event's (a sibling meet's name, told apart only by a
 *   letter too short to be a word).
 * On a split screen the half that is this event's gives its match (`label`); `phrase`, the match beside its name.
 */
export function overlayEvent(text: string, own: string, quals?: number, semifinals = false): { event: "own" | "other" | null; label?: string; phrase?: string } {
  const mine = words(own);
  const verdict = (name: string): "own" | "other" | null => {
    const read = words(name);
    const ours = (w: string) => mine.some((o) => o === w || o.startsWith(w) || o.endsWith(w));
    const hit = read.filter(ours).length;
    // Only telling words weigh: a 3-letter scrap of the logo beside the name is no word of another event's (USNVCMP 2024
    // at 2509 s: "rer DIVE — Nevada Chan qualification 6 of 4", its own Nevada one word in three, "Chan" its cut name).
    const telling = read.filter((w) => w.length >= 4);
    if (telling.length >= 2 && telling.filter(ours).length * 2 < telling.length) return "other";
    // Its long words this event's, but a short one another's: a sibling meet's (FiT-North U-League AM Meet 3 for its
    // X-League AM Meet 3). Only a total read in full can make it this event's.
    if (hit && shortClash(name, own)) return "other";
    return hit ? "own" : null;
  };
  let other = false, ownLabel: string | undefined, ownSeen = false;
  for (const line of text.split("\n")) {
    let from = 0;
    for (const m of line.matchAll(MATCH_PHRASE)) {
      const total = m[1] != null ? Number(m[1]) : null;
      const name = verdict(line.slice(from, m.index));
      // The total, where read, decides: a name read as another's beside this event's own total is a misread, and a name
      // read as this event's beside another event's total is a sibling's (FiT-North's league meets of one day, each on
      // its own field's stream: "FiT-North U-League AM Meet 3 · Qualification 5 of 23" reads as FiT-North X-League AM
      // Meet 3's own name, its league letter too short to be a word, and X-League has 19). With no total, the name.
      const byTotal = quals && total != null ? totalSays(total, quals) : null;
      const v = byTotal ?? name;
      from = m.index! + m[0].length;
      if (v === "other") other = true;
      if (v === "own" && !ownSeen) { ownSeen = true; ownLabel = overlayLabel(m[0], semifinals) ?? undefined; }
    }
  }
  // `phrase`: the match this event's name stands beside (the bar's row, read on its own, has one line). `label`: that
  // match, given for the whole frame only where another event's match is beside it too (a split screen). Several
  // matches with no other event's among them stay overlayLabel's to judge: a bracket naming several names none.
  const phrase = ownLabel ? { phrase: ownLabel } : {};
  if (ownSeen) return other ? { event: "own", ...(ownLabel ? { label: ownLabel } : {}), ...phrase } : { event: "own", ...phrase };
  return { event: other ? "other" : null };
}

/**
 * The match FTC Live's bottom bar names when its row is read on its own (the reader's labelRow): `half` is the read of
 * the row's right half, where the match sits ("Qualification 10 of 17"), `row` the whole row's, where the event or
 * division sits. On a stream an event's divisions share (`ctx`), the row must name this division, as a whole frame's
 * read must; a row naming no division, or a sibling's, names no match of this event. `semifinals`: as overlayLabel's.
 */
export function rowLabel(half: string, row: string | null, ctx?: { own: string; others: string[] }, semifinals = false): string | null {
  const label = overlayLabel(half, semifinals);
  if (!label || !ctx) return label;
  return row != null && overlayDivision(row, ctx.own, ctx.others) === "own" ? label : null;
}

/**
 * Where FTC Live's score bar sits in a frame (RGBA pixels, `width` × `height`): the rows where one alliance's colour
 * fills much of the half left of the timer's column and the other's the half right of it (blue then red, or red then
 * blue): whole halves, as a bar's white score badges can fill the stretch beside the timer (Arizona's, USAZGIQ 2023). Its tallest run of such rows (a row or two of icons and digits breaking it is bridged) is the bar, wherever the
 * stream put it: along the bottom (FTC Live's default), under a title bar at the top (FIRST in Texas), or flush with the
 * top (Arizona's CENTERSTAGE streams, the timer 56–96 px down). Null: no run at least 3% of the frame tall (a frame with
 * no bar: a slate, a camera, a results card). Self-contained (no imports, no outer names): the reader runs it in the page.
 */
export function overlayBand(px: ArrayLike<number>, width: number, height: number): { top: number; bottom: number } | null {
  const BLUE = 1, RED = 2;
  const colour = (i: number): number => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // By hue more than brightness: Arizona's bar is a dark navy (2, 46, 80) and maroon (111, 12, 17). Red twice the
    // green and blue, so an orange wood floor (200, 130, 60) is neither.
    if (b >= 60 && b > r + 40 && b > g * 1.4) return BLUE;
    if (r >= 70 && r > g * 2 && r > b * 2) return RED;
    return 0;
  };
  // Share of a stretch's pixels in each colour, every other pixel.
  const share = (y: number, from: number, to: number): [number, number] => {
    let blue = 0, red = 0, n = 0;
    for (let x = Math.round(from * width); x < Math.round(to * width); x += 2) {
      const c = colour((y * width + x) * 4);
      if (c === BLUE) blue++; else if (c === RED) red++;
      n++;
    }
    return [blue / n, red / n];
  };
  const MIN = 0.4, GAP = 3, TALL = Math.round(height * 0.03), CARD = Math.round(height * 0.2);
  let best: { top: number; bottom: number } | null = null, top = -1, last = -1;
  for (let y = 0; y <= height; y++) {
    let bar = false;
    if (y < height) {
      const [lb, lr] = share(y, 0.02, 0.44), [rb, rr] = share(y, 0.56, 0.98);
      bar = (lb >= MIN && rr >= MIN) || (lr >= MIN && rb >= MIN);
    }
    if (bar) { if (top < 0 || y - last > GAP + 1) top = y; last = y; continue; }
    if (top >= 0 && (y - last > GAP || y === height)) {
      if (last - top + 1 >= TALL && last - top + 1 <= CARD && (!best || last - top + 1 > best.bottom - best.top)) best = { top, bottom: last + 1 };
      top = -1;
    }
  }
  return best;
}

/**
 * The row over a score bar found in the frame (overlayBand), where FTC Live names the match: as tall as the usual row
 * (`usual`, over the bottom bar), cut at the frame's top. Null where it would be the usual row again (a bar where the
 * bottom bar always is), or there's no room over the bar for a line of text.
 */
export function rowAbove(band: { top: number }, usual: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } | null {
  const y = Math.max(0, band.top - usual.height), height = band.top - y;
  if (height < 24 || Math.abs(y - usual.y) <= 16) return null;
  return { x: usual.x, y, width: usual.width, height };
}

/** Reads a minute apart the upload scan takes past a frame naming a match not yet running: a match's turnaround is 4–8
 *  minutes, so three minutes on usually lands in its play (the next scan frame, 10 minutes on, tries again if not). */
export const SCAN_AHEAD = 3;
/** Whether the upload scan reads a minute on again (the k-th step): the scan frame named a match (`named`) and no read
 *  since gave a running start (`start`, the last read's). Only the first frame's naming counts: a step landing on a camera
 *  cutaway that names nothing keeps stepping, as the match is still to come. */
export function stepOn(named: boolean, start: number | null, k: number): boolean {
  return named && start == null && k <= SCAN_AHEAD;
}

/** How long before a broadcast's start a match no broadcast holds is still looked for in it (seconds). */
export const LEAD_IN_S = 6 * 3600;

/**
 * Whether the video `i` (of an event's videos, by broadcast window, epoch seconds) should be read for a match at `at`
 * that its broadcast starts after. The clock says before it, yet it's often in it: FIRST's times can be the schedule's,
 * and YouTube's broadcast start can be late. So a match no broadcast holds, up to LEAD_IN_S before this one's start,
 * with no other broadcast starting between them, is looked for here too. Its frames decide, as for any match.
 */
export function leadIn(at: number, i: number, windows: { start: number | null; end: number | null }[]): boolean {
  const from = windows[i]?.start;
  if (from == null || at >= from || from - at > LEAD_IN_S) return false;
  if (windows.some((w) => w.start != null && w.start <= at && (w.end == null || at <= w.end))) return false;
  return !windows.some((w, k) => k !== i && w.start != null && at < w.start && w.start < from);
}

/** The rows of a server/data/frameTimings/<season>.ts file as written (one JSON row a line after the data marker). */
export function dataRows<T>(text: string): T[] {
  const data = text.split("// --- Data")[1] ?? "";
  return data.split("\n").flatMap((line) => { const m = /^\s*(\{.*\}),?\s*$/.exec(line); return m ? [JSON.parse(m[1]) as T] : []; });
}

/**
 * Judge a video's matches from its confirmed reads (index → start second). The clock (FIRST's actual start of each
 * match) is the anchor; the frames are the second signal. A video loses time and never gains it, so how far it sits
 * from the clock only ever falls, match by match: a read that breaks that is a misread (a replay, an overlay left on the
 * last match, a digit read wrong), and only the longest run of reads that never rises (by more than a read's slack) is
 * kept. Reads that agree on how far the video sits from the clock form stretches. A stretch of two or more reads
 * places its reads ("high") and every match between them ("medium"). A stretch of one read is a confirmed read too
 * (its overlay and timer agree at two points, and 25 s before it the match wasn't running): the video is the truth, so
 * it places that match where the frames show it, however far that is from FIRST's times (owner, 2026-11-16: never
 * flag a read for its distance from the schedule). Placed starts must be in order,
 * a match apart and inside the video; any that aren't go to review too. Every other match is missing, with the reason.
 *
 * A match with only its scheduled time (M.scheduled) has no clock to weigh its read against: of those reads, the longest
 * run whose starts rise in the matches' order is kept (a read out of that order is a misread), each placed where its
 * own frames show it ("high"), and nothing is ever filled between them or between the clock's reads on its account.
 */
export function judge(ms: M[], seen: Map<number, number>, shift: number | null, length: number, read: Set<number> = new Set(seen.keys())): Judged {
  const timed = (i: number) => !ms[i].scheduled;
  const idx = [...seen.keys()].filter(timed).sort((a, b) => a - b);
  const d = (i: number) => seen.get(i)! - ms[i].epoch;
  // low: the least distance on the run so far. A read may sit at most a read's slack above it, so slack can't add up
  // read by read into a rise (0, +6, +12).
  const len = idx.map(() => 1), from = idx.map(() => -1), low = idx.map((i) => d(i));
  for (let b = 0; b < idx.length; b++) for (let a = 0; a < b; a++) {
    if (d(idx[b]) <= low[a] + SAME_S && len[a] + 1 > len[b]) { len[b] = len[a] + 1; from[b] = a; low[b] = Math.min(low[a], d(idx[b])); }
  }
  // Of the longest runs, the one with the most reads that agree with a neighbour (0, -120, 0 keeps the two zeros, not
  // a zero and the misread); then the later one.
  const runOf = (k: number) => { const r: number[] = []; for (; k >= 0; k = from[k]) r.unshift(idx[k]); return r; };
  const agreeing = (r: number[]) => r.filter((i, n) => [r[n - 1], r[n + 1]].some((o) => o != null && Math.abs(d(o) - d(i)) <= SAME_S)).length;
  let kept: number[] = [];
  const longest = Math.max(0, ...len);
  len.forEach((l, k) => { if (l === longest) { const r = runOf(k); if (!kept.length || agreeing(r) >= agreeing(kept)) kept = r; } });
  const dropped = new Set(idx.filter((i) => !kept.includes(i)));
  // The scheduled matches' reads: those on every longest run rising with the matches' order (a match apart at least,
  // less what a cut in the recording loses, as for two high starts below). Two runs as long that differ can't say which read is wrong, so neither of theirs stands.
  const sched = [...seen.keys()].filter((i) => !timed(i)).sort((a, b) => a - b);
  const after = (a: number, b: number) => seen.get(sched[b])! - seen.get(sched[a])! >= MATCH_S - LOSS_S;
  const pre = sched.map(() => 1), suf = sched.map(() => 1);
  for (let b = 0; b < sched.length; b++) for (let a = 0; a < b; a++) if (after(a, b)) pre[b] = Math.max(pre[b], pre[a] + 1);
  for (let a = sched.length - 1; a >= 0; a--) for (let b = a + 1; b < sched.length; b++) if (after(a, b)) suf[a] = Math.max(suf[a], suf[b] + 1);
  const L = Math.max(0, ...pre);
  const onLongest = sched.map((_, n) => pre[n] + suf[n] - 1 === L);
  const sKept = new Set(sched.filter((_, n) => onLongest[n] && sched.filter((__, m) => onLongest[m] && pre[m] === pre[n]).length === 1));
  for (const i of sched) if (!sKept.has(i)) dropped.add(i);

  const placedAt = new Map<string, Placed>();
  for (const i of sched) if (sKept.has(i)) placedAt.set(ms[i].label, { t: seen.get(i)!, confidence: "high" });
  const review = new Map<string, { t: number; why: string }>();
  // Stretches: kept reads in a row agreeing on the distance.
  const stretches: number[][] = [];
  for (const i of kept) {
    const s = stretches.at(-1);
    // Against the stretch's first read, so a slow drift (0, +6, +12) isn't taken as agreement.
    if (s && Math.abs(d(s[0]) - d(i)) <= SAME_S) s.push(i);
    else stretches.push([i]);
  }
  for (const s of stretches) {
    if (s.length === 1) {
      const i = s[0];
      // A confirmed read: where its frames show it, never weighed against the schedule.
      placedAt.set(ms[s[0]].label, { t: seen.get(s[0])!, confidence: "high" });
      continue;
    }
    for (let n = 0; n < s.length; n++) {
      placedAt.set(ms[s[n]].label, { t: seen.get(s[n])!, confidence: "high" });
      const j = s[n + 1];
      if (j != null) for (let k = s[n] + 1; k < j; k++) if (timed(k)) placedAt.set(ms[k].label, { t: Math.round(ms[k].epoch + d(s[n])), confidence: "medium" });
    }
  }

  // Plausible: inside the video, in order, a match apart.
  const order = ms.map((m) => m.label).filter((l) => placedAt.has(l));
  const bad = new Set<string>();
  const earlyStart = new Map<string, { t: number; previousEnds: number }>();
  order.forEach((l, n) => {
    const t = placedAt.get(l)!.t;
    if (t < 0 || t + MATCH_S > length + SAME_S) bad.add(l);
    const next = order[n + 1];
    // Two starts each read off its own frames, closer than a match by no more than a cut loses (LOSS_S): the recording
    // skipped the end of the first (USTXSASQ 2025 cuts from Q14 at 1:07 to Q13's results, then Q15). Both stand; each
    // clip is still checked to open on its match (checkOpenings).
    const cut = next != null && placedAt.get(l)!.confidence === "high" && placedAt.get(next)!.confidence === "high" && t + MATCH_S - placedAt.get(next)!.t <= LOSS_S;
    if (next != null && !cut && placedAt.get(next)!.t - t < MATCH_S - SAME_S) {
      bad.add(l); bad.add(next);
      // Only where both starts were read off the video: a start filled from the clock between two reads (medium) shows
      // nothing about where that match began.
      if (placedAt.get(l)!.confidence === "high" && placedAt.get(next)!.confidence === "high") earlyStart.set(next, { t: placedAt.get(next)!.t, previousEnds: t + MATCH_S });
    }
  });
  for (const l of bad) { review.set(l, { t: placedAt.get(l)!.t, why: "placed outside the video, out of order, or overlapping the next match" }); placedAt.delete(l); }

  const missing = new Map<string, string>();
  ms.forEach((m, i) => {
    if (placedAt.has(m.label) || review.has(m.label)) return;
    const before = kept.filter((k) => k < i).at(-1), after = kept.find((k) => k > i);
    missing.set(m.label,
      dropped.has(i) ? "its frame read disagrees with the matches around it"
      : read.has(i) ? "its frames didn't confirm a start"
      : m.scheduled && (kept.length || sKept.size || read.size) ? SCHEDULED_UNREAD
      : before != null && after != null ? "in a gap: the reads either side disagree where the video sits, so it may not be in the video"
      : !kept.length && !read.size ? NOTHING_READ
      : "no frame read of it, and no agreeing reads on both sides");
  });
  return { placed: placedAt, review, missing, earlyStart, opens: new Map() };
}

/** How long one event's read may take at most (scripts/video-frames.ts --event-limit is the floor): its videos'
 *  summed length times EVENT_LIMIT_RATIO, never less than the floor, so a long event's legitimate read isn't stopped
 *  and only a stuck one is. Measured 11-17/18: 2022 ROBUQ1 (3 videos, ~27 h) read whole in 40 and 68 min, 0.025-0.042
 *  of its length; four 2024 events together in 37 min. 2022 ROBUQ2's 9.8 h video was still unfinished after 6 h
 *  (over 0.45 of the event's 13.2 h): stuck. 0.25 leaves about six times the slowest real read and still stops that one. */
export const EVENT_LIMIT_RATIO = 0.25;
export function eventLimitMs(floorMs: number, videoSeconds: number[], ratio = EVENT_LIMIT_RATIO): number {
  const total = videoSeconds.reduce((s, x) => s + (Number.isFinite(x) && x > 0 ? x : 0), 0);
  return Math.max(floorMs, Math.ceil((ratio * total) / 60) * 60_000);
}

/** A match with reads on both sides of it (a scheduled match's read says nothing of the clock): it is in the recording
 *  unless a cut took it out, so it is still looked for once the video's read budget is spent (GAP_READS). */
export function between(ms: M[], seen: Map<number, number>, i: number): boolean {
  let lo = false, hi = false;
  for (const k of seen.keys()) if (!ms[k].scheduled) { if (k < i) lo = true; else if (k > i) hi = true; }
  return lo && hi;
}
