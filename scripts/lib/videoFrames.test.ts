// The pure parts of the frame reader (scripts/video-frames.ts): the overlay's match, the timer's elapsed time, and
// placing a video's matches from what was read.
import { describe, expect, it } from "vitest";
import { dataRows, launchPlayerBrowser, clockReading, divisionOf, cropOrder, elapsed, flippedClip, inkOnly, INK_MAX, darkInk, DARK_FILL_MAX, DARK_INK_MAX, inPage, titleLeaks, titleUnchecked, cardClip, cardStill, countsThrough, overlayDivision, overlayEvent, leadIn, LEAD_IN_S, judge, NOTHING_READ, SCHEDULED_UNREAD, autoLeadsTo, overlayBand, overlayLabel, rowAbove, rowLabel, SCAN_AHEAD, stepOn, eventLabel, sameMatch, timerRan, secondsLoose, secondsOf, secondsPlain, startOffset, playedCount, playedMatches, wholeLength, firstOpening, OPEN_LEADS, shortClash, type M, eventDivisions, teamsSay } from "./videoFrames";
import { between, edgeReject, EVENT_LIMIT_RATIO, eventLimitMs, GAP_READS, lookAgain, MISREAD, onSwitch, TRIES } from "./videoFrames";

describe("the frame reader", () => {
  it("skips an opening lead that sits on the overlay's switch to its match", () => {
    // USMOKSCMP 2023 Q9: a second before its 20 s lead the overlay names Q8.
    expect(onSwitch("Q8", "Q9")).toBe(true);
    // Nothing named a second before (a transition, a cutaway), or the same match: no switch.
    expect(onSwitch(null, "Q9")).toBe(false);
    expect(onSwitch("Q9", "Q9")).toBe(false);
    // A semifinal's first match names the event's M2 as "M2-1"; a replay's frame names its match alone.
    expect(onSwitch("M2-1", "M2")).toBe(false);
    expect(onSwitch("M1-1", "M2")).toBe(true);
    expect(onSwitch("M6", "M6-2")).toBe(false);
  });

  // A 1280 × 720 frame: a grey field, and a score bar from `top` to `bottom` with one alliance's colour each side of the
  // timer (white digits in a dark box at the centre), its rows broken here and there by white icons and digits.
  const frame = (bars: { top: number; bottom: number; left?: "blue" | "red"; dark?: boolean }[], floor = [120, 115, 110]) => {
    const w = 1280, h = 720, px = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, [r, g, b]: number[]) => { const i = (y * w + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, floor);
    for (const bar of bars) {
      const BLUE = bar.dark ? [2, 46, 80] : [20, 80, 200], RED = bar.dark ? [111, 12, 17] : [210, 30, 40];
      const [l, r] = bar.left === "red" ? [RED, BLUE] : [BLUE, RED];
      for (let y = bar.top; y < bar.bottom; y++) for (let x = 0; x < w; x++) {
        const icon = (x % 40 < 8 && y % 12 < 6) || y === bar.top + 5;
        put(x, y, icon ? [250, 250, 250] : x < 560 ? l : x >= 720 ? r : [15, 15, 15]);
      }
    }
    return px;
  };
  it("finds FTC Live's score bar wherever the stream put it", () => {
    // FTC Live's default: along the bottom (most streams, CENTERSTAGE's FiT-North and Benelux ones).
    expect(overlayBand(frame([{ top: 612, bottom: 700 }]), 1280, 720)).toEqual({ top: 612, bottom: 700 });
    // Flush with the top under a title strip, in dark navy and maroon (Arizona's CENTERSTAGE qualifiers, USAZGIQ 2023:
    // the bar 48–170 px down).
    expect(overlayBand(frame([{ top: 48, bottom: 170, dark: true }]), 1280, 720)).toEqual({ top: 48, bottom: 170 });
    // Under a title bar at the top (FIRST in Texas).
    expect(overlayBand(frame([{ top: 98, bottom: 142, left: "red" }]), 1280, 720)).toEqual({ top: 98, bottom: 142 });
    // Red on the left is a bar too; of two, the taller.
    expect(overlayBand(frame([{ top: 20, bottom: 40 }, { top: 600, bottom: 690, left: "red" }]), 1280, 720)).toEqual({ top: 600, bottom: 690 });
    // The taller by a single row wins too, whichever comes first.
    expect(overlayBand(frame([{ top: 100, bottom: 190 }, { top: 500, bottom: 591 }]), 1280, 720)).toEqual({ top: 500, bottom: 591 });
    expect(overlayBand(frame([{ top: 100, bottom: 191 }, { top: 500, bottom: 590 }]), 1280, 720)).toEqual({ top: 100, bottom: 191 });
    // No bar: a plain frame, or one alliance's colour alone (a results card's half), or a strip too thin to be one.
    expect(overlayBand(frame([]), 1280, 720)).toBeNull();
    // An orange wood floor is neither alliance's colour.
    expect(overlayBand(frame([], [200, 130, 60]), 1280, 720)).toBeNull();
    const card = frame([]);
    for (let y = 100; y < 600; y++) for (let x = 0; x < 640; x++) { const i = (y * 1280 + x) * 4; card[i] = 20; card[i + 1] = 80; card[i + 2] = 200; }
    expect(overlayBand(card, 1280, 720)).toBeNull();
    expect(overlayBand(frame([{ top: 300, bottom: 310 }]), 1280, 720)).toBeNull();
    // A results card: its blue half and red half fill the frame's height (CENTERSTAGE's "WINNER" card).
    expect(overlayBand(frame([{ top: 60, bottom: 660 }]), 1280, 720)).toBeNull();
  });

  it("steps the upload scan on past a named match until its timer runs, through a cutaway", () => {
    // USTXNTM1 2023: the scan frame names Q11 with no timer running; a minute on, a camera cutaway names nothing; the
    // steps go on (k = 2, 3) all the same.
    expect(stepOn(true, null, 1)).toBe(true);
    expect(stepOn(true, null, 2)).toBe(true);
    expect(stepOn(true, null, SCAN_AHEAD)).toBe(true);
    expect(stepOn(true, null, SCAN_AHEAD + 1)).toBe(false);
    // A running start read: done. A scan frame naming nothing: no stepping.
    expect(stepOn(true, 2275, 2)).toBe(false);
    expect(stepOn(false, null, 1)).toBe(false);
  });

  it("reads the match's row over a bar found somewhere other than the bottom", () => {
    const usual = { x: 0, y: 548, width: 1280, height: 56 };
    // Arizona's bar flush with the top: the strip over it, cut at the frame's edge.
    expect(rowAbove({ top: 54 }, usual)).toEqual({ x: 0, y: 0, width: 1280, height: 54 });
    // FIRST in Texas's bar under a title bar.
    expect(rowAbove({ top: 98 }, usual)).toEqual({ x: 0, y: 42, width: 1280, height: 56 });
    // The bottom bar where it always is: the usual row, already read. No room over a bar at the very top.
    expect(rowAbove({ top: 612 }, usual)).toBeNull();
    expect(rowAbove({ top: 10 }, usual)).toBeNull();
  });

  it("names the match the bar's row names on its own, on a shared stream only with this division's name", () => {
    // Reads of CENTERSTAGE (2023) rows, whose whole frames named nothing: USTXNTM1 at 1500 s, NLBNM1 at 3300 s.
    expect(rowLabel("TE FiT-North T-League Meet 1 Qualification 10 of 17 PERS [Ah", null)).toBe("Q10");
    expect(rowLabel("wens SHN— NL Benelux LM Leek Qualification 4 of 23 PUERS TAT", null)).toBe("Q4");
    expect(rowLabel("Playoff Match 1", null)).toBe("M1");
    // The bar at the top edge (USNVCMP 2024 at 8100 s): its row's match half, read on its own, the logo under it.
    expect(rowLabel("Qualification 36 of 46\nDEEP", null)).toBe("Q36");
    expect(rowLabel("os 55 pe", null)).toBeNull();
    // A shared stream: the whole row must name this division, never a sibling's or none.
    const ctx = { own: "Solo", others: ["Duo"] };
    expect(rowLabel("Qualification 3 of 28", "Illinois State Championship - Solo  Qualification 3 of 28", ctx)).toBe("Q3");
    expect(rowLabel("Qualification 3 of 28", "Illinois State Championship - Duo  Qualification 3 of 28", ctx)).toBeNull();
    expect(rowLabel("Qualification 3 of 28", "Illinois State Championship  Qualification 3 of 28", ctx)).toBeNull();
    expect(rowLabel("Qualification 3 of 28", null, ctx)).toBeNull();
    // A match a team advances to is never the one on screen, read whole or by row.
    expect(rowLabel("Advances to: Playoff Match 8", null)).toBeNull();
  });

  it("names the match the overlay shows, and nothing else", () => {
    expect(overlayLabel("FIRST AGE  Qualification 21 of 36  2:05")).toBe("Q21");
    expect(overlayLabel("Playoff Match 10")).toBe("M10");
    expect(overlayLabel("APOC Decode 2026  Finals Match 2")).toBe("F2");
    expect(overlayLabel("FiT-North I&S League Tournament  Match 1  DECODE")).toBe("M1");
    // USNMCMP 2025's recording opens on the field check: "Test Match 1", Test Team 1–4. None of the event's matches.
    expect(overlayLabel("New Mexico Championship  Test Match 1  -1 Test Team 1  -3 Test Team 3")).toBeNull();
    // USNYEXHJQ 2025 M4 (27840 s): a QR banner for the match just played sits beside the one on screen.
    expect(overlayLabel("John Jay Qualifier  Scan for detailed Playoff Match 3 results  Playoff Match 4  2:30")).toBe("M4");
    expect(overlayLabel("Scan for detailed Playoff Match 3 results")).toBeNull();
    // USIAWESTLT 2025, 20 s before M3: a bracket whose "advances to" line is cut off at the top names no match.
    expect(overlayLabel("Playoff Match 5  M4 vs A5  M5 M3 vs A6  M8 M6 vs M5  M9 M7 vs M8  Easter Island & Chichen Itza")).toBeNull();
    // Two boxes' numbers aren't a bracket: "Playoff Match 3" still names M3.
    expect(overlayLabel("Easter Island & Chichen Itza  Playoff Match 3  Alliance 1  M1")).toBe("M3");
    expect(overlayLabel("Upcoming matches")).toBeNull();
  });

  it("names a best-of-3 semifinal's match by its series and number (2019–2022)", () => {
    // USCHSCMPCARR 2021's bar and IASQ4 2019's preview card: the event's M2 and M1-2, never M2 for "Match 2".
    expect(overlayLabel("FIRST FORWARD  Semifinal 2 Match 1  Carriers Division  FREIGHT FRENZY")).toBe("M2-1");
    expect(overlayLabel("Semifinal 1 Match 2  Match Preview  8588 Finger Puppet Mafia")).toBe("M1-2");
    expect(overlayLabel("Semi-Final 1 Match 3")).toBe("M1-3");
    expect(overlayLabel("AU APOC 2023  Finals Match 2")).toBe("F2");
    expect(overlayLabel("Finais Match 1  Super Qualifier: Iowa City")).toBe("F1");
    // A bare "Match 1" in a season of semifinals is one of those with its first word lost: none (2019IASQ4 F1).
    expect(overlayLabel("Match 1  Super Qualifier: Iowa City", true)).toBeNull();
    expect(overlayLabel("Semifinal 1 Match 1  Super Qualifier: Iowa City", true)).toBe("M1-1");
    expect(overlayLabel("Qualification 4 of 36", true)).toBe("Q4");
    expect(overlayLabel("Match 1  Super Qualifier: Iowa City")).toBe("M1");
    // AUMPOS1 2022's bracket card names its semifinals with no match: none.
    expect(overlayLabel("Elimination Bracket  Semifinal 1  12993 8644 20871  Semifinal 2  Finals")).toBeNull();
    expect(sameMatch("M2-1", "M2")).toBe(true);
    expect(sameMatch("M1-2", "M1-2")).toBe(true);
    expect(sameMatch("M1-1", "M1-2")).toBe(false);
    expect(sameMatch("M1-2", "M2")).toBe(false);
    expect(sameMatch("M1-2", "M1")).toBe(false);
    // 2025's overlay names a tiebreak replay by its match alone.
    expect(sameMatch("M6", "M6-2")).toBe(true);
    expect(sameMatch("M6", "M6")).toBe(true);
    expect(sameMatch("Q12", "Q12")).toBe(true);
    expect(sameMatch("Q1", "Q12")).toBe(false);
    // A recording's edge stores the event's own name, so outsideRecording finds it in the event's order.
    expect(eventLabel("M2-1")).toBe("M2");
    expect(eventLabel("M1-2")).toBe("M1-2");
    expect(eventLabel("M6")).toBe("M6");
    expect(eventLabel("F1")).toBe("F1");
    expect(eventLabel("Q11")).toBe("Q11");
  });

  it("finds a bottom bar's crop in the same bar flipped to the top", () => {
    // POWERPLAY's timer box, 4 px above the bottom edge of a 720 px frame, is 4 px below the top in Arizona's flipped
    // bar (USAZCMPGC23 2022: "85" read there at 8640 s); x, width and height stay.
    expect(flippedClip({ x: 605, y: 686, width: 70, height: 30 })).toEqual({ x: 605, y: 4, width: 70, height: 30 });
    // Flipping twice is the crop itself; another frame height flips about its own middle.
    const c = { x: 1, y: 600, width: 2, height: 50 };
    expect(flippedClip(flippedClip(c))).toEqual(c);
    expect(flippedClip({ x: 0, y: 1000, width: 10, height: 40 }, 1080)).toEqual({ x: 0, y: 40, width: 10, height: 40 });
  });

  it("tries the crop whose clock last ran first, then the rest in order", () => {
    const [a, b, c, d] = [{ n: "a" }, { n: "b" }, { n: "c" }, { n: "d" }];
    expect(cropOrder([a, b, c, d])).toEqual([a, b, c, d]);
    // USAZCMPGC23 2022: the flipped bar's crop ran, so it's read before the bottom crops' stray field digits.
    expect(cropOrder([a, b, c, d], c)).toEqual([c, a, b, d]);
    expect(cropOrder([a, b, c, d], a)).toEqual([a, b, c, d]);
    // None, or a crop that isn't one of these (the bar found in the frame): the usual order.
    expect(cropOrder([a, b, c, d], null)).toEqual([a, b, c, d]);
    expect(cropOrder([a, b, c, d], { n: "a" })).toEqual([a, b, c, d]);
  });

  it("keeps a plain timer's ink alone, the progress fill behind it gone (USCANOSCQ 2021: 75 over deep blue)", () => {
    // A digit's black, the blue fill, the light pill, the green fill (USMOKSKNM1), a 6's grey edge, a digit's edge.
    const px = [18, 22, 40, 255, 34, 66, 150, 255, 205, 207, 212, 255, 20, 140, 40, 255, 60, 60, 70, 255, 30, 30, 35, 128];
    inkOnly(px, INK_MAX);
    expect(px).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  });

  it("reads POWERPLAY's box gone black behind faint digits, and leaves a box that isn't (darkInk)", () => {
    // USTXNONLM1 2022 at 902 s: the fill 0–2, the digits of "38" 5–37 (sampled off the frame).
    const black = [0, 0, 0, 255, 2, 1, 2, 255, 1, 0, 1, 255, 26, 24, 30, 255, 37, 33, 36, 255, 1, 1, 1, 255];
    expect(darkInk(black, DARK_FILL_MAX, DARK_INK_MAX)).toBe(true);
    expect(black).toEqual([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    // USTXNODLM3 2022 at 6700 s: the light pill (147, 187) and its black digits: not that fill, left for inkOnly.
    const pill = [147, 147, 147, 255, 187, 187, 187, 255, 0, 0, 0, 255, 190, 190, 190, 255];
    expect(darkInk(pill, DARK_FILL_MAX, DARK_INK_MAX)).toBe(false);
    expect(pill).toEqual([147, 147, 147, 255, 187, 187, 187, 255, 0, 0, 0, 255, 190, 190, 190, 255]);
    // A fill's grey edge brighter than the ink band stays white, not a stray digit stroke.
    const edge = [0, 0, 0, 255, 0, 0, 0, 255, 120, 120, 120, 255];
    expect(darkInk(edge, DARK_FILL_MAX, DARK_INK_MAX)).toBe(true);
    expect(edge.slice(8)).toEqual([255, 255, 255, 255]);
  });

  it("runs a function in a page that has no __name of tsx's (inPage)", () => {
    // tsx's own output for a function with an inner named arrow, as the page gets it from toString.
    const compiled = { toString: () => '() => { const walk = __name((n) => n * 2, "walk"); return walk(21); }' };
    expect(() => new Function(`return (${compiled.toString()})()`)()).toThrow(/__name/);
    expect(new Function(`return ${inPage(compiled)}`)()).toBe(42);
  });

  it("finds YouTube's title and channel among the page's texts, never the overlay's own (2023's .ytp-title leak)", () => {
    const title = "FTC Harrisonburg 1 Qualifier - February 8th, 2022 FTC Event";
    const texts = ["FTC Harrisonburg 1 Qualifier - February 8th, 2022 FTC Event", "Qualification 13 of 18", "FTC", "Harrisonburg 1 Qualifier - Febr...", "Chesapeake FIRST", "Harrisonburg 1 Qualifier", "0:30"];
    expect(titleLeaks(title, "Chesapeake FIRST", texts)).toEqual([0, 3, 4, 5]);
    // Every text in the page is YouTube's: the overlay is pixels in the video, never a page element. So a piece of the
    // title counts even when it is the event's name. No title or channel known: nothing counts.
    expect(titleLeaks("", "", texts)).toEqual([]);
    expect(titleLeaks(title, "", ["2022", "FTC Event"])).toEqual([1]);
  });
  it("says the title can't be checked only when the player gave neither a title nor a channel", () => {
    expect(titleUnchecked("", "")).toMatch(/can't be checked/);
    expect(titleUnchecked("  ", "\n")).toMatch(/can't be checked/);
    expect(titleUnchecked("FTC Harrisonburg 1 Qualifier", "")).toBeNull();
    expect(titleUnchecked("", "Chesapeake FIRST")).toBeNull();
  });
  it("reads a bare-seconds timer (FTC Live's overlay, 2019–2022)", () => {
    // AUMPOS1 2022: Auto "24", TeleOp "112"; IASQ4 2019 TeleOp "101".
    expect(secondsPlain("24\n")).toBe(24);
    expect(secondsPlain("112")).toBe(112);
    expect(secondsPlain(" 101 ")).toBe(101);
    expect(secondsPlain("0")).toBe(0);
    // A colon is another bar's timer; more than TeleOp's 120 or four digits is a score, not this timer.
    expect(secondsPlain(":1")).toBeNull();
    expect(secondsPlain("1:12")).toBeNull();
    expect(secondsPlain("150")).toBeNull();
    expect(secondsPlain("3000")).toBeNull();
    expect(secondsPlain("")).toBeNull();
    // Bare seconds count Auto 30 to 0, the switch, then TeleOp 120 to 0: as any timer once read.
    expect(elapsed({ where: "plain", left: 112, auto: false })).toBe(46);
    expect(elapsed({ where: "plain", left: 24, auto: true })).toBe(6);
    expect(elapsed({ where: "plain", left: 24, auto: false })).toBe(134);
    expect(elapsed({ where: "plain", left: 120, auto: false })).toBeNull();
  });

  it("counts a timer running only when it went down", () => {
    expect(timerRan(2, 1.7)).toBe(true);
    expect(timerRan(1, 1.6)).toBe(true);
    // RIQUAL3 2019: the next match's "30" standing, read 1.6 s apart.
    expect(timerRan(0, 1.6)).toBe(false);
    expect(timerRan(0, 0.4)).toBe(false);
    expect(timerRan(5, 1.7)).toBe(false);
  });

  it("places matches with only a scheduled time where their own frames show them, never filled", () => {
    // 2019MOQ8: FIRST gives whole-minute scheduled times only, 5 minutes apart; the event ran slower.
    const ms: M[] = [1, 2, 3, 4, 5].map((n) => ({ label: `Q${n}`, epoch: 1_000 + n * 300, scheduled: true }));
    // Q1, Q2 and Q4 read in order (7 to 8 minutes apart); Q3 not read; Q6 misread far back (before Q4 and Q5).
    const ms6: M[] = [...ms, { label: "Q6", epoch: 2_800, scheduled: true }];
    const seen = new Map([[0, 2000], [1, 2430], [3, 3300], [4, 3750], [5, 2100]]);
    const j = judge(ms6, seen, null, 10_000, new Set([0, 1, 3, 4, 5]));
    expect([...j.placed].map(([l, p]) => [l, p.t, p.confidence])).toEqual([["Q1", 2000, "high"], ["Q2", 2430, "high"], ["Q4", 3300, "high"], ["Q5", 3750, "high"]]);
    expect(j.missing.get("Q6")).toBe("its frame read disagrees with the matches around it");
    // Two runs as long that differ (Q4 at 3300 or Q5 at 2900, each after Q2): neither of the two stands.
    const tie = judge(ms, new Map([[0, 2000], [1, 2430], [3, 3300], [4, 2900]]), null, 10_000, new Set([0, 1, 3, 4]));
    expect([...tie.placed.keys()]).toEqual(["Q1", "Q2"]);
    expect(tie.missing.get("Q4")).toBe("its frame read disagrees with the matches around it");
    // Nothing is filled between two reads for a scheduled match, however the reads agree.
    expect(j.missing.get("Q3")).toBe(SCHEDULED_UNREAD);
    // Frames named a match but none confirmed a start: the others are still unread for want of a time, not "nothing read".
    const none = judge(ms, new Map(), null, 10_000, new Set([2]));
    expect(none.missing.get("Q1")).toBe(SCHEDULED_UNREAD);
    expect(none.missing.get("Q3")).toBe("its frames didn't confirm a start");
    expect(judge(ms, new Map(), null, 10_000, new Set()).missing.get("Q1")).toBe(NOTHING_READ);
    // A recording cut mid-match (USTXSASQ 2025's kind): two starts 151 s apart, both read off the video, both stand.
    const cut = judge(ms, new Map([[0, 2000], [1, 2151]]), null, 10_000, new Set([0, 1]));
    expect([...cut.placed.keys()]).toEqual(["Q1", "Q2"]);
  });

  it("looks again for a misread and for the matches after the last read", () => {
    // USCHSBAQ3 2023 (FIRST's start times, seconds after Q1's): the video sits 7158 s after the clock all day. Q1's one
    // read sits 300 s early, so judge drops it; F2, 16 minutes after F1 past a field timeout, was looked for before any
    // read placed the video and never again.
    const ms: M[] = ([["Q1", 0], ["Q2", 471], ["Q3", 861], ["Q4", 1375], ["F1", 20503], ["F2", 21476]] as const).map(([label, epoch]) => ({ label, epoch }));
    const seen = new Map([[0, 6858], [1, 7629], [2, 8019], [3, 8533], [4, 27661]]);
    expect(judge(ms, seen, null, 30_000).missing.get("Q1")).toBe(MISREAD);
    expect(lookAgain(ms, seen, null, 30_000)).toEqual({ misread: [0], trailing: [5] });
    // Read where the reads beside them put them (Q1 at 7158, F2 at 28634, as their frames show), both place.
    const now = new Map([...seen, [0, 7158], [5, 28634]]);
    expect(lookAgain(ms, now, null, 30_000)).toEqual({ misread: [], trailing: [] });
    expect([...judge(ms, now, null, 30_000).placed.keys()]).toEqual(["Q1", "Q2", "Q3", "Q4", "F1", "F2"]);
    // A scheduled-only match after the last read is the walk's; with nothing read there is nothing to look from.
    expect(lookAgain([...ms, { label: "F3", epoch: 22_000, scheduled: true }], now, null, 30_000).trailing).toEqual([]);
    expect(lookAgain(ms, new Map(), null, 30_000)).toEqual({ misread: [], trailing: [] });
  });

  it("keeps the clock's reads and fills only clock matches when scheduled ones sit between them", () => {
    // 2019IASQ4: qualifications scheduled only, playoffs with FIRST's actual starts.
    const ms: M[] = [
      { label: "Q1", epoch: 100, scheduled: true },
      { label: "M1", epoch: 10_000 }, { label: "M2", epoch: 10_400 }, { label: "M1-2", epoch: 10_800 },
    ];
    const j = judge(ms, new Map([[0, 50], [1, 20_000], [3, 20_800]]), null, 30_000, new Set([0, 1, 3]));
    expect(j.placed.get("Q1")).toEqual({ t: 50, confidence: "high" });
    expect(j.placed.get("M2")).toEqual({ t: 20_400, confidence: "medium" });
    expect(j.placed.get("M1-2")).toEqual({ t: 20_800, confidence: "high" });
  });

  it("tells Auto from TeleOp's end by where the timer stands 45 s on", () => {
    // 2019IASQ4 M2-1: Auto "10" at 18300, 46 s on TeleOp reads 92 (10 s of Auto, the 8 s switch, 28 s of TeleOp).
    expect(autoLeadsTo(10, 46, 92)).toBe(true);
    expect(autoLeadsTo(10, 46, 94)).toBe(true);
    expect(autoLeadsTo(10, 46, 100)).toBe(false);
    // The end of TeleOp ("0:20") leads to a finished match: no TeleOp reading 45 s on is its.
    expect(autoLeadsTo(20, 45, 30)).toBe(false);
    expect(autoLeadsTo(30, 30, 120)).toBe(false);
  });

  it("tells a timeout's countdown through a start from a match's card", () => {
    // A 3:00 timeout on an audience display's card, read at 2:00 or less under a bar naming the next match, gives a
    // start where it shows 2:38, 22 s after it began: 10 s before that start it shows 2:48, 5 s before 2:43, and 25 s
    // before it hasn't begun, standing at its full 3:00 (still more than a match, reaching the start's 2:35).
    expect(countsThrough(168, 10)).toBe(true);
    expect(countsThrough(163, 5)).toBe(true);
    expect(countsThrough(180, 25)).toBe(true);
    // A 2:40 countdown is 2 s in at the start: 5 s before, it stands at its full 2:40.
    expect(countsThrough(160, 5)).toBe(true);
    // Longer ones (a 5:00 reset) are caught further out.
    expect(countsThrough(183, 25)).toBe(true);
    expect(countsThrough(248, 90)).toBe(true);
    // Taken as a whole-match count (2:30 at the start), a few seconds' OCR either way.
    expect(countsThrough(175, 25)).toBe(true);
    expect(countsThrough(186, 25)).toBe(true);
    // A real match: its card stands at 2:30 before it (never over 2:38), or shows the last match's 0:00.
    expect(countsThrough(150, 25)).toBe(false);
    expect(countsThrough(0, 25)).toBe(false);
    // A long countdown that doesn't reach the start's 2:30–2:38 is something else (a break timer ending elsewhere).
    expect(countsThrough(300, 25)).toBe(false);
    expect(countsThrough(170, 25)).toBe(false);
    // A real match's card 5 or 10 s before its start: 2:30 standing, the last match's 0:00.
    expect(countsThrough(150, 5)).toBe(false);
    expect(countsThrough(150, 10)).toBe(false);
  });

  it("reads an audience display's card for the countdown check", () => {
    // What the digits worker read off USMAWEQ's card (Aj0stAP3EwM, 2:30 standing before Q37): cut close, "7:20"; with
    // the margin, "2:30". Cut close, a card standing still read as more than a match, far from the start: no check.
    expect(secondsOf("2:30\n")).toBe(150);
    expect(cardStill(secondsOf("2:30\n")!)).toBe(true);
    expect(countsThrough(secondsOf("7:20\n")!, 5)).toBe(false);
    // Reads of nothing it could take ("0:99" off a blank card, or no text): no clock, so no check passed on them.
    expect(secondsOf("0:99\n")).toBeNull();
    expect(secondsOf("")).toBeNull();
    expect(cardStill(0)).toBe(true);
    expect(cardStill(163)).toBe(false);
    // The margin: 40 px each side, kept inside the frame.
    expect(cardClip({ x: 340, y: 110, width: 600, height: 210 })).toEqual({ x: 300, y: 70, width: 680, height: 290 });
    expect(cardClip({ x: 10, y: 0, width: 1260, height: 700 })).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("reads a timer", () => {
    expect(secondsOf("2:25")).toBe(145);
    expect(secondsOf(" 0:07\n")).toBe(7);
    // FIRST AGE's white box: its thin colon dropped ("117" is 1:17); anything else as secondsOf, never two readings in one.
    expect(secondsLoose("117\n")).toBe(77);
    expect(secondsLoose("1:04")).toBe(64);
    expect(secondsLoose("052")).toBe(52);
    expect(secondsLoose("1578")).toBeNull();
    expect(secondsLoose("12")).toBeNull();
    expect(secondsLoose("317")).toBeNull();
    expect(secondsOf("2:75")).toBeNull();
    expect(secondsOf("")).toBeNull();
  });

  it("turns either layout's timer into seconds since the match started", () => {
    // Bottom bar counting the whole match down from 2:30: Auto above 2:00, then 8 s to switch.
    expect(elapsed({ where: "bottom", left: 150, auto: false })).toBeNull();
    expect(elapsed({ where: "bottom", left: 140, auto: false })).toBe(10);
    expect(elapsed({ where: "bottom", left: 100, auto: false })).toBe(58);
    // Bottom bar counting Auto down from 0:30 (what FTC Live's DECODE bar does): "0:20" is Auto when the read 45 s on
    // says so, 10 s in, never TeleOp's 0:20 (138 s in, where taking it for TeleOp put matches 2 minutes early).
    expect(elapsed({ where: "bottom", left: 20, auto: true })).toBe(10);
    expect(elapsed({ where: "bottom", left: 20, auto: false })).toBe(138);
    // Top bar: 0:30 Auto, then 2:00 TeleOp.
    expect(elapsed({ where: "top", left: 30, auto: true })).toBeNull();
    expect(elapsed({ where: "top", left: 20, auto: true })).toBe(10);
    expect(elapsed({ where: "top", left: 100, auto: false })).toBe(58);
    expect(elapsed({ where: "top", left: 120, auto: false })).toBeNull();
    // 8 s or less: the switch to TeleOp ("0:05" under a hand) reads the same as TeleOp's last seconds, so neither.
    expect(elapsed({ where: "bottom", left: 5, auto: false })).toBeNull();
    expect(elapsed({ where: "top", left: 8, auto: false })).toBeNull();
    expect(elapsed({ where: "bottom", left: 9, auto: false })).toBe(149);
  });

  it("drops a read that breaks the video's only-ever-losing-time order, and fills between agreeing reads", () => {
    const ms: M[] = Array.from({ length: 10 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 1000 + i * 400 }));
    // Q1 and Q4 sit 29 s early, Q5 is a misread (227 s), Q6 and Q10 sit 107 s early.
    const seen = new Map([[0, 1000 - 29], [3, 2200 - 29], [4, 2600 - 227], [5, 3000 - 107], [9, 4600 - 107]]);
    const j = judge(ms, seen, null, 10_000);
    expect(j.missing.get("Q5")).toBe("its frame read disagrees with the matches around it");
    expect([...j.placed.keys()]).toEqual(["Q1", "Q2", "Q3", "Q4", "Q6", "Q7", "Q8", "Q9", "Q10"]);
    expect(j.placed.get("Q3")).toEqual({ t: 1800 - 29, confidence: "medium" });
    expect(j.placed.get("Q8")).toEqual({ t: 3800 - 107, confidence: "medium" });
  });

  it("doesn't take reads drifting a slack at a time for agreement", () => {
    const ms: M[] = Array.from({ length: 3 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 1000 + i * 400 }));
    const j = judge(ms, new Map([[0, 1000], [1, 1400 + 6], [2, 1800 + 12]]), null, 10_000);
    // Q1 and Q2 agree; Q3, 12 s above Q1, is a rise and is set aside.
    expect([...j.placed.keys()]).toEqual(["Q1", "Q2"]);
    expect(j.missing.get("Q3")).toMatch(/disagrees/);
  });

  it("keeps the two reads that agree over a misread between them", () => {
    const ms: M[] = Array.from({ length: 3 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 1000 + i * 400 }));
    const j = judge(ms, new Map([[0, 1000], [1, 1400 - 120], [2, 1800]]), null, 10_000);
    // Q2's misread is set aside; it sits between two agreeing reads, so it's placed from them.
    expect([...j.placed]).toEqual([["Q1", { t: 1000, confidence: "high" }], ["Q2", { t: 1400, confidence: "medium" }], ["Q3", { t: 1800, confidence: "high" }]]);
  });

  it("says nothing was read only when no frame named a match", () => {
    const ms: M[] = Array.from({ length: 3 }, (_, i) => ({ label: `Q${i + 1}`, epoch: i * 400 }));
    const j = judge(ms, new Map(), null, 10_000, new Set([1]));
    expect(j.missing.get("Q2")).toMatch(/didn't confirm/);
    expect(j.missing.get("Q1")).not.toBe(NOTHING_READ);
    expect(judge(ms, new Map(), null, 10_000).missing.get("Q1")).toBe(NOTHING_READ);
  });

  it("looks for a match the clock puts before a broadcast in the next broadcast only", () => {
    // Saturday 10:00–18:00 and Sunday 09:00–17:00 (epoch seconds from an arbitrary 0).
    const w = [{ start: 36_000, end: 64_800 }, { start: 118_800, end: 147_600 }];
    expect(leadIn(35_000, 0, w)).toBe(true); // 17 min before Saturday's broadcast: Saturday's video
    expect(leadIn(35_000, 1, w)).toBe(false); // ...never Sunday's
    expect(leadIn(36_000 - LEAD_IN_S - 1, 0, w)).toBe(false); // more than 6 hours before
    expect(leadIn(40_000, 0, w)).toBe(false); // inside Saturday's broadcast: already its
    expect(leadIn(117_000, 1, w)).toBe(true); // Sunday morning before Sunday's broadcast
    expect(leadIn(70_000, 1, w)).toBe(false); // Saturday evening, after Saturday's end: more than 6 h before Sunday's
    expect(leadIn(35_000, 0, [{ start: null, end: null }])).toBe(false); // an upload has no broadcast to be before
  });

  it("tells a division's overlay from its sibling's on a shared stream", () => {
    expect(divisionOf("Romania Championship - COANDA Division")).toBe("COANDA");
    expect(divisionOf("Chesapeake Championship - Blue Crab Division")).toBe("Blue Crab");
    expect(divisionOf("Brookline Robo Rally 1")).toBeNull();
    // Read off ROCMPCND's Friday stream (pvmxbH8YW-k): VLAICU's overlay at 9761 s, COANDA's at 10000 s.
    expect(overlayDivision("Romania Championship - VLAICU Divis  Qualification 1 of 72  2:23", "COANDA", ["VLAICU"])).toBe("other");
    expect(overlayDivision("Romania Championship - COANDĂ Divisi  Qualification 2 of 72", "COANDA", ["VLAICU"])).toBe("own");
    expect(overlayDivision("a Division  Romania Championship - (  Qualification 2 of 72", "COANDA", ["VLAICU"])).toBeNull();
    expect(overlayDivision("Western Edge Premier Event - Sea Division", "Sand", ["Sea"])).toBe("other");
    expect(overlayDivision("Seattle Qualifier", "Sand", ["Sea"])).toBeNull();
  });

  it("tells a division's match by its teams where the bar's division name has scrolled off (Iowa 2019)", () => {
    // Black's Q8 (4324 6340 11142 16736) and Gold's (367 7259 9925 15523), read off f0WTAt-jFDA at 3307 s.
    const black = [4324, 6340, 11142, 16736], gold = [367, 7259, 9925, 15523];
    const frame = "11142 1 0 16736 4324 11 24 6340 Qualification 8 of 36 npionship";
    expect(teamsSay(frame, black, [gold])).toBe("own");
    expect(teamsSay(frame, gold, [black])).toBe("other");
    // Two teams read: too few to say.
    expect(teamsSay("4324 Qualification 8 of 36 16736", black, [gold])).toBeNull();
    // Both divisions' teams read (a split screen, a results card listing both): no answer.
    expect(teamsSay("4324 6340 11142 367 7259 9925", black, [gold])).toBeNull();
    // No teams known for the match (a playoff label, a missing row).
    expect(teamsSay(frame, undefined, [gold])).toBeNull();
    // A score or timer that happens to be a team's number counts once, never as three.
    expect(teamsSay("367 367 367 Qualification 8 of 36", black, [gold])).toBeNull();
  });

  it("takes 2019's divisions from the words after the name they share, and reads them off SKYSTONE's bar", () => {
    expect(eventDivisions("Romania Championship - COANDA Division", ["Romania Championship - VLAICU Division"])).toEqual({ own: "COANDA", others: ["VLAICU"] });
    expect(eventDivisions("Iowa Championship BLACK", ["Iowa Championship GOLD"])).toEqual({ own: "BLACK", others: ["GOLD"] });
    expect(eventDivisions("FIRST in Michigan FTC State Championship-Warren MARIECURIE", ["FIRST in Michigan FTC State Championship-Warren WOODIEFLOWERS"]))
      .toEqual({ own: "MARIECURIE", others: ["WOODIEFLOWERS"] });
    expect(eventDivisions("Los Angeles Championship Monrovia, CA GALILEO", ["Los Angeles Championship Monrovia, CA ODYSSEY"])).toEqual({ own: "GALILEO", others: ["ODYSSEY"] });
    // No sibling, nothing shared, the same tail twice, or a tail that is only a number: no division to tell apart.
    expect(eventDivisions("Iowa Championship BLACK", [])).toBeNull();
    expect(eventDivisions("Iowa Championship BLACK", ["Nebraska Championship GOLD"])).toBeNull();
    expect(eventDivisions("Iowa Championship BLACK", ["Iowa Championship Black"])).toBeNull();
    expect(eventDivisions("Brookline Robo Rally 1", ["Brookline Robo Rally 2"])).toBeNull();
    // Iowa 2019's streams cut between both fields (juDEJB2wENc, titled Black, shows Gold's Q9 at 3901 s; f0WTAt-jFDA,
    // titled Gold, shows Black's Q8 at 3307 s): the bar's event half says whose match it is.
    expect(overlayDivision("Qualification 9 of 36  Gold Division", "BLACK", ["GOLD"])).toBe("other");
    expect(overlayDivision("Qualification 8 of 36  npionship - Black Division", "BLACK", ["GOLD"])).toBe("own");
    expect(overlayDivision("Qualification 8 of 36  npionship - Black Division", "GOLD", ["BLACK"])).toBe("other");
    expect(overlayDivision("Qualification 8 of 36  lowa Championship - Bl", "GOLD", ["BLACK"])).toBeNull();
    // A name the data runs together, spaced on the overlay; a short one never matched inside a longer word.
    expect(overlayDivision("Marie Curie Division  Qualification 4 of 40", "MARIECURIE", ["WOODIEFLOWERS"])).toBe("own");
    expect(overlayDivision("Woodie Flowers Division", "MARIECURIE", ["WOODIEFLOWERS"])).toBe("other");
    expect(overlayDivision("Golden Bears Qualifier", "BLACK", ["GOLD"])).toBeNull();
  });

  it("reads the data file's rows", () => {
    const text = 'export interface X {}\n// --- Data (scripts/video-frames.ts writes from here on) ---\nexport const FRAME_TIMINGS = [\n  {"videoId":"a","code":"X","starts":{"Q1":5}},\n  {"videoId":"b","code":"Y","starts":{}},\n];\n';
    expect(dataRows<{ videoId: string }>(text).map((r) => r.videoId)).toEqual(["a", "b"]);
    expect(dataRows("no marker")).toEqual([]);
  });

  it("writes an early start only where both starts were read off the video, never one filled from the clock", () => {
    // Q1 and Q3 read and agree; Q2 is filled between them (medium) only 100 s after Q1: both go to review, but nothing
    // says the video showed Q2 starting while Q1 was on.
    const ms: M[] = [{ label: "Q1", epoch: 0 }, { label: "Q2", epoch: 100 }, { label: "Q3", epoch: 400 }];
    const j = judge(ms, new Map([[0, 10], [2, 410]]), null, 10_000);
    expect(j.review.has("Q2")).toBe(true);
    expect(j.earlyStart.has("Q2")).toBe(false);
  });
  it("places a lone confirmed read where the frames show it, however far from FIRST's times", () => {
    const ms: M[] = Array.from({ length: 4 }, (_, i) => ({ label: `M${i + 1}`, epoch: i * 500 }));
    // M1 and M4 disagree by 5 min (the stream lost time between them): each is in the video where its frames say.
    const j = judge(ms, new Map([[0, 10], [3, 1500 - 300]]), null, 10_000);
    expect([...j.placed]).toEqual([["M1", { t: 10, confidence: "high" }], ["M4", { t: 1200, confidence: "high" }]]);
    expect(j.missing.get("M2")).toMatch(/in a gap/);
    // A read 3 hours from where FIRST's times put it: placed where the frames show it, nothing flagged for the distance.
    const k = judge(ms, new Map([[3, 1500 + 3 * 3600]]), null, 20_000);
    expect(k.placed.get("M4")).toEqual({ t: 12300, confidence: "high" });
    expect(k.review.size).toBe(0);
    // One read, and no clock or other read beside it: still where its frames show it.
    expect(judge(ms, new Map([[1, 600]]), null, 10_000).placed.get("M2")).toEqual({ t: 600, confidence: "high" });
  });

  describe("judging a video's matches (clock first, frames must agree)", () => {
    // Ten matches 400 s apart; a video that starts 1000 s after the first.
    const ms: M[] = Array.from({ length: 10 }, (_, i) => ({ label: `Q${i + 1}`, epoch: 10_000 + i * 400 }));
    const at = (i: number, off: number) => [i, ms[i].epoch + off] as [number, number];

    it("places reads two or more agree on (high) and the matches between them (medium)", () => {
      const j = judge(ms, new Map([at(0, -9000), at(4, -9000), at(9, -9000)]), null, 8000);
      expect(j.placed.get("Q1")).toEqual({ t: 1000, confidence: "high" });
      expect(j.placed.get("Q3")).toEqual({ t: 1800, confidence: "medium" });
      expect(j.placed.size).toBe(10);
      expect(j.review.size + j.missing.size).toBe(0);
    });

    it("places a lone confirmed read after a gap where its frames show it (the stream is the truth)", () => {
      // Q1–Q5 agree at -9000; Q9 alone at -9300 (a gap: the stream stopped for 5 minutes).
      const seen = new Map([at(0, -9000), at(4, -9000), at(8, -9300)]);
      const j = judge(ms, seen, null, 8000);
      expect(j.placed.get("Q9")).toEqual({ t: ms[8].epoch - 9300, confidence: "high" });
      // Q6–Q8 sit in the gap: missing, with the reason, never silently skipped.
      expect(j.missing.get("Q7")).toMatch(/in a gap/);
      expect(j.missing.get("Q10")).toMatch(/no frame read/);
      // The same lone read where the broadcast's own clock puts it: two signals, placed.
      const k = judge(ms, seen, -9300, 8000);
      expect(k.placed.get("Q9")).toEqual({ t: ms[8].epoch - 9300, confidence: "high" });
    });

    it("drops a misread (a replay, an Auto 0:20 taken for TeleOp's) and says so", () => {
      const j = judge(ms, new Map([at(0, -9000), at(3, -9120), at(4, -9000), at(9, -9000)]), null, 8000);
      expect(j.placed.get("Q4")).toEqual({ t: ms[3].epoch - 9000, confidence: "medium" });
      expect(j.missing.size).toBe(0);
      // A misread with no agreeing reads around it to fill in for it stays missing, with why.
      const k = judge(ms, new Map([at(0, -9000), at(1, -9000), at(5, -8800)]), null, 8000);
      expect(k.missing.get("Q6")).toMatch(/disagrees/);
      expect(k.missing.get("Q4")).toMatch(/no frame read/);
    });

    it("sends starts outside the video or overlapping the next match to review", () => {
      // The video is 2300 s long: Q4 (at 2200) can't fit a whole match.
      const j = judge(ms, new Map([at(0, -9000), at(3, -9000)]), null, 2300);
      expect(j.review.get("Q4")?.why).toMatch(/outside the video/);
      // Two matches 60 s apart overlap.
      const close: M[] = [{ label: "Q1", epoch: 0 }, { label: "Q2", epoch: 60 }, { label: "Q3", epoch: 400 }];
      const k = judge(close, new Map([[0, 100], [1, 160], [2, 500]]), null, 5000);
      expect([...k.review.keys()].sort()).toEqual(["Q1", "Q2"]);
      // Q3, a match on, still stands.
      expect(k.placed.get("Q3")).toEqual({ t: 500, confidence: "high" });
      expect(k.review.size + k.placed.size + k.missing.size).toBe(3);
      // Q2's start (160) is inside Q1's play (100 + 158): written as an early start, read off the video.
      expect([...k.earlyStart]).toEqual([["Q2", { t: 160, previousEnds: 258 }]]);
    });

    it("keeps two read starts a cut brought within a match of each other, but never filled ones", () => {
      // USTXSASQ 2025 (DgrBhJC2TIk): Q14 read at 7838, Q15 at 7989; the stream cut from Q14 at 1:07 to Q13's results.
      const sasq: M[] = [{ label: "Q14", epoch: 0 }, { label: "Q15", epoch: 400 }];
      const j = judge(sasq, new Map([[0, 7838], [1, 7989]]), null, 20000);
      expect([...j.placed.keys()]).toEqual(["Q14", "Q15"]);
      expect(j.review.size + j.earlyStart.size).toBe(0);
      // A start filled between reads (medium) that overlaps the next still goes to review.
      const fill: M[] = [{ label: "Q1", epoch: 0 }, { label: "Q2", epoch: 100 }, { label: "Q3", epoch: 140 }, { label: "Q4", epoch: 1000 }];
      const k = judge(fill, new Map([[0, 1000], [2, 1140], [3, 2000]]), null, 20000);
      expect(k.review.has("Q2")).toBe(true);
    });

    it("tells a match whose frames were read but never confirmed from one never read", () => {
      const j = judge(ms, new Map([at(0, -9000), at(9, -9000)]), null, 8000, new Set([0, 9]));
      expect(j.placed.size).toBe(10);
      const k = judge(ms, new Map(), null, 8000, new Set([2]));
      expect(k.missing.get("Q3")).toMatch(/didn't confirm/);
      // A frame of the video was read (it named Q3), so the others aren't "nothing read".
      expect(k.missing.get("Q4")).toMatch(/no agreeing reads/);
    });
  });
});

describe("a recording cut mid-match", () => {
  // USIAPOMPM11 2025 (ufVIXyeHAjk) loses 19 s inside Q8: the timer reads 1:10 at 3936 s and 0:50 at 3937 s.
  it("takes a later read's earlier start as time the video lost, a later one as a first read made after a cut", () => {
    expect(startOffset(3848, 3829)).toBe("lost");
    expect(startOffset(3829, 3848)).toBe("gained");
    // USCHSCHQ2 2022 Q16: Auto read as TeleOp's end, a start 128 s early; the later read is the start to check.
    expect(startOffset(6767, 6895)).toBe("period");
    expect(startOffset(6767, 6900)).toBe("period");
    expect(startOffset(6767, 6950)).toBe("other");
    expect(startOffset(3848, 3852)).toBe("same");
    // Further off than a cut loses: another start, never explained away.
    expect(startOffset(3848, 3700)).toBe("other");
    expect(startOffset(3848, 3990)).toBe("other");
  });
});

describe("a full-screen card naming several matches", () => {
  // CAONMIQ 2025 (FHaZsGfUE68): the bracket card before M4 at 22183 s, and M6's result card at 23505 s.
  it("names the match on screen, never one a team advances to, and none where two are named", () => {
    expect(overlayLabel("Up Next  Match 4\nAlliance 2  VS  Alliance 3\nM1 A4 vs A5  M3 A1 vs A4\nWinner advances to Playoff Match 7\nLoser advances to Playoff Match 6\nM7 A1 vs M4")).toBe("M4");
    expect(overlayLabel("Match Results  Match 6\nWINNER  Alliance 3 95  Alliance 5 41\nAdvances to:\nPlayoff Match 8\nWill be Red Alliance\nScan for detailed Match 6 results")).toBe("M6");
    expect(overlayLabel("Match 4  Match 7")).toBeNull();
    // The running bar's own playoff name still reads (ROCMPVLC's "Playoff Match 11").
    expect(overlayLabel("onship - VLAICU Division  Romania C  Playoff Match 11")).toBe("M11");
    expect(overlayLabel("Mississauga Qualifier  Match 10  2:30")).toBe("M10");
  });
  // FIRST DIVE's 2024 playoff bar: the match on screen, with its winner's and loser's next matches beside it (AUCMP
  // g8Zrl3yxVHM M1 at 16874 s, M2 at 17221 s; FPECA 167irOy-YgY M3 at 14293 s), as tesseract reads them.
  it("never takes the bar's \"Winner → Match N\" or \"Loser → Match N\" for the match on screen", () => {
    expect(overlayLabel("er DIVE — | Australia Championship Playoff Match 2\n® Winner-> Match 7 -")).toBe("M2");
    expect(overlayLabel("eer DIVE Carolinas Premier Event Playoff Match 3\n® Winner-> Match 7 —")).toBe("M3");
    expect(overlayLabel("Australia Championship  Playoff Match 1\nWinner → Match 7\nLoser → Match 5")).toBe("M1");
    // The bar's own line lost to the crowd behind it: the next steps alone name no match on screen.
    expect(overlayLabel("® Winner Match 7 -\nPERL] Barker Biuebacks | J loser © Match5 JESRARLL")).toBeNull();
    expect(overlayLabel("Winner → Match 7\nLoser → Match 5")).toBeNull();
  });
});

describe("FTC Live's count of matches played", () => {
  // CABCVIQ2 2025 (_eblj5-6VnA) opens on its rankings card: "5 matches per team ... 4 / 23 matches played".
  it("reads the count and the total off the rankings card, and nothing else", () => {
    expect(playedCount("ftc.events/CABCVIQ2/rankings  5 matches per team  4 / 23 matches played")).toEqual({ played: 4, of: 23 });
    expect(playedCount("Qualification 21 of 36  2:05")).toBeNull();
    expect(playedCount("40 / 23 matches played")).toBeNull();
  });
});

describe("whose event an overlay names", () => {
  // Read as tesseract reads the saved frames (scripts/video-frames.ts), each with its event's name and qual total.
  it("tells another event's half of a split screen by its total, its name lost to OCR (USTXCAM1 2024 at 76 s)", () => {
    // Left half: FiT-Central North San Antonio League Meet 1, "Qualification 3 of 24"; this event (26 quals) on the right.
    expect(overlayEvent("—E— Qualification 3 of 24 y- ny. FT-Contrl Hil Countittpotionerit 2s [RE", "FiT-Central Hill Country League Meet 1", 26)).toEqual({ event: "other" });
  });
  it("never takes a logo misread for another event's name (KZCMP 2022's playing frames at 420 s)", () => {
    // POWERPLAY's "FIRST ENERGIZE" read "FIRST ZN=RGIZ= swe": two words, neither this event's. Its own name follows the match.
    const kz = "Kazakhstan Central Asia FTC Regional Championship";
    expect(overlayEvent("FIRST ZN=RGIZ= swe Qualification 2 of 39 { Kazakhstan Central Asia FTC POWERZ)PY Ces", kz, 39)).toEqual({ event: "own", phrase: "Q2" });
    // A playoff bar has no total to stand by: the short junk words are no name.
    expect(overlayEvent("FIRST ZN=RGIZ= swe Match 3 { Kazakhstan Central Asia FTC POWERZ)PY Ces", kz, 39)).toEqual({ event: null });
    // A name read as another's beside this event's own total: the total stands.
    expect(overlayEvent("Rolling Prairie Robotics Qualification 2 of 39", kz, 39)).toEqual({ event: "own", phrase: "Q2" });
  });
  it("tells nothing by a total whose last digit OCR lost (USNVCMP 2024 at 2700 s: its own \"of 46\" read \"of 4\")", () => {
    expect(overlayEvent("~~ DIVE — [CC qualification 7 of 4 Ro", "Nevada Championship", 46)).toEqual({ event: null });
    // Not the start of the total's digits: another event's still.
    expect(overlayEvent("—E— Qualification 7 of 5 Ro", "Nevada Championship", 46)).toEqual({ event: "other" });
    // Logo scraps and a cut name beside it: Nevada's own (2509 s, 10021 s).
    expect(overlayEvent("rer DIVE — Nevada Chan qualification 6 of 4 RB", "Nevada Championship", 46).event).not.toBe("other");
    expect(overlayEvent("esr DIVE Nevada Cham qualification 7 of 4 WORE", "Nevada Championship", 46).event).not.toBe("other");
  });
  it("reads this event's half of a split screen where both halves are read", () => {
    const text = "FiT-Central North San Antonio League Meet 1 Qualification 3 of 24 INTO THE DEEP FiT-Central Hill Country League Meet 1 Qualification 7 of 26";
    expect(overlayEvent(text, "FiT-Central Hill Country League Meet 1", 26)).toEqual({ event: "own", label: "Q7", phrase: "Q7" });
    // Without the total, the names alone tell the halves apart.
    expect(overlayEvent(text, "FiT-Central Hill Country League Meet 1")).toEqual({ event: "own", label: "Q7", phrase: "Q7" });
  });
  it("keeps a single event's frame with its name cut, scrolled or reordered", () => {
    expect(overlayEvent("ad ! | \'{ B= \ Division Michiana Premier Event - Qualification 21 of 115 \"RDF:", "Michiana Premier Event - Thomson Division", 115)).toEqual({ event: "own", phrase: "Q21" });
    expect(overlayEvent("rest DIVE Checkpoint Scrimmage Beehive Aca Qualification 1 of 11", "Beehive Academy Checkpoint Scrimmage", 11)).toEqual({ event: "own", phrase: "Q1" });
    expect(overlayEvent("24 CANOPY | Collegiate Meet @ 9 AM Qualification 2 of 15 BIOBUZZ", "Collegiate Meet @ 9 AM", 15)).toEqual({ event: "own", phrase: "Q2" });
    expect(overlayEvent("Austin Semi-Area Championship • Qualification 10 of 40", "FiT-Central Semi-Area Championship Austin", 40)).toEqual({ event: "own", phrase: "Q10" });
  });
  it("reads FREIGHT FRENZY's name after the match, its logo before it (USCANOSCQ 2021 at 4500 s)", () => {
    const own = "CA-Northern Santa Clara Qualifying Tournament";
    // The worker's line: the logo misread before a playoff match (no total to decide by), the event's name cut after it.
    expect(overlayEvent("rest ronmasn sme Semifinal 2 Match 2 a Clara Qualifying Tournament C FREIGHT SFRENZV go", own, 17, true)).toEqual({ event: "own", phrase: "M2-2" });
    // Another event's name after it is still another's.
    expect(overlayEvent("rest ronmasn sme Semifinal 2 Match 2 Western Edge Premier Event FREIGHT FRENZY", own, 17, true)).toEqual({ event: "other" });
    // Two matches on the line (a split screen): a name after the first is the second's, never read for the first.
    expect(overlayEvent("rest ronmasn sme Semifinal 2 Match 2 a Clara Qualifying Tournament Semifinal 1 Match 1 Western Edge", own, 17, true)).toEqual({ event: "own", label: "M1-1", phrase: "M1-1" });
  });
  it("tells sibling meets apart by a short token their names differ in", () => {
    expect(shortClash("FiT-North U-League AM Meet 3", "FiT-North X-League AM Meet 3")).toBe(true);
    expect(shortClash("FiT-North X-League PM Meet 3", "FiT-North X-League AM Meet 3")).toBe(true);
    expect(shortClash("Lawson Meet @ 10:30 AM", "Lawson Meet @ 8 AM")).toBe(true);
    // A short token lost to OCR, or noise beside a name with none, is no clash.
    expect(shortClash("FiT-North -League AM Meet 3", "FiT-North X-League AM Meet 3")).toBe(false);
    expect(shortClash("24 CANOPY | Collegiate Meet @ 9 AM", "Collegiate Meet @ 9 AM")).toBe(false);
    expect(shortClash("ad ! | B= Division Michiana Premier Event -", "Michiana Premier Event - Thomson Division")).toBe(false);
    // Scraps at a cut name, and junk after it, stand in for nothing (USCANOSCQ 2021: "CA-Northern" cut to "C").
    expect(shortClash("a Clara Qualifying Tournament C FREIGHT SFRENZV go", "CA-Northern Santa Clara Qualifying Tournament")).toBe(false);
  });
  it("names no match of this event with another total, and tells a playoff by its name alone", () => {
    expect(overlayEvent("CANOPY | —E— Qualification 2 of 16", "Collegiate Meet @ 9 AM", 15)).toEqual({ event: "other" });
    // Its name read beside another total: the total decides. FiT-North's league meets of 2026-01-10 each streamed their
    // own field, every name but the league letter the same (frames of k1u8I_NLMdM at 740 s, I96iSxbO_TY at 7640 s).
    expect(overlayEvent("CANOPY | Collegiate Meet @ 9 AM Qualification 2 of 16", "Collegiate Meet @ 9 AM", 15)).toEqual({ event: "other" });
    expect(overlayEvent("FiT-North U-League AM Meet 3 Qualification 5 of 23", "FiT-North X-League AM Meet 3", 19)).toEqual({ event: "other" });
    expect(overlayEvent("FiT-North A-League Meet 3 Qualification 2 of 35", "FiT-North X-League AM Meet 3", 19)).toEqual({ event: "other" });
    // The same frames for their own events.
    expect(overlayEvent("FiT-North U-League AM Meet 3 Qualification 5 of 23", "FiT-North U-League AM Meet 3", 23)).toEqual({ event: "own", phrase: "Q5" });
    // A total OCR cut short ("of 2" for 23) tells nothing: a sibling's name, its league letter another's, is no
    // match of this event's; this event's own name with it is.
    expect(overlayEvent("FiT-North U-League AM Meet 3 Qualification 5 of 2", "FiT-North X-League AM Meet 3", 23)).toEqual({ event: "other" });
    expect(overlayEvent("FiT-North X-League AM Meet 3 Qualification 5 of 1", "FiT-North X-League AM Meet 3", 19)).toEqual({ event: "own", phrase: "Q5" });
    // A full total of this event's still decides over the clash (a misread letter).
    expect(overlayEvent("FiT-North U-League AM Meet 3 Qualification 5 of 19", "FiT-North X-League AM Meet 3", 19)).toEqual({ event: "own", phrase: "Q5" });
    // Kansas City's meets of one day, told by their times (frames of d7aikgA0fcA and clFcWK19XOY, 2025).
    expect(overlayEvent("Lawson Meet @ 10:30 AM Qualification 2 of 1", "Lawson Meet @ 8 AM", 12)).toEqual({ event: "other" });
    expect(overlayEvent("Lawson Meet @ 8 AM Qualification 1 of 1", "Lawson Meet @ 8 AM", 12)).toEqual({ event: "own", phrase: "Q1" });
    expect(overlayEvent("DIVE Hawaii Championship Playoff Match 3", "Hawaii Championship", 25)).toEqual({ event: "own", phrase: "M3" });
    expect(overlayEvent("DIVE Western Edge Premier Event Playoff Match 3", "Hawaii Championship", 25)).toEqual({ event: "other" });
    // Two matches, neither another event's for sure (a split screen's unread half, or one event's bracket card): the
    // frame gives no match of its own (overlayLabel: several named name none), only the one beside this event's name.
    expect(overlayEvent("—E— Playoff Match 3 DIVE Hawaii Championship Playoff Match 5", "Hawaii Championship", 25)).toEqual({ event: "own", phrase: "M5" });
    expect(overlayEvent("DIVE Hawaii Championship Playoff Match 3 Winner Playoff Match 5", "Hawaii Championship", 25)).toEqual({ event: "own", phrase: "M3" });
    // 2019–2022's best-of-3 semifinals keep their series and number (overlayLabel's M2-1), never F1 or M1.
    expect(overlayEvent("Hawaii Championship Semifinal 2 Match 1", "Hawaii Championship", 25, true)).toEqual({ event: "own", phrase: "M2-1" });
    expect(overlayEvent("Hawaii Championship Semi-final 1 Match 2", "Hawaii Championship", 25, true)).toEqual({ event: "own", phrase: "M1-2" });
    // Its series lost to OCR ("Semifinals Match 1"): no match, as overlayLabel names none.
    expect(overlayEvent("Hawaii Championship Semifinals Match 1", "Hawaii Championship", 25, true)).toEqual({ event: "own" });
    // The finals of those years, "Finals Match 2" even with a letter misread.
    expect(overlayEvent("Hawaii Championship Finais Match 2", "Hawaii Championship", 25, true)).toEqual({ event: "own", phrase: "F2" });
    // Nothing to tell by: no total, no name.
    expect(overlayEvent("Playoff Match 3", "Hawaii Championship", 25)).toEqual({ event: null });
  });
});

describe("an event's played matches, a time or not", () => {
  // A stand-in for the zone: the venue's wall clock read as UTC.
  const f = { utcMs: (t: string) => Date.parse(`${t}Z`), actual: (t: string | null) => !!t && !t.endsWith(":00"), rank: (l: string) => ({ Q1: 1, Q2: 2, M1: 1e6 + 1000 } as Record<string, number>)[l] ?? 4e6 };
  it("reads one with no time by its frames alone, after the timed ones in its label's order", () => {
    const ms = playedMatches([
      { label: "M1", time: null, timezone: null }, { label: "Q2", time: "2025-07-19T10:07:00", timezone: "America/Chicago" },
      { label: "Q1", time: "2025-07-19T10:01:13", timezone: "America/Chicago" }, { label: "X1", time: null, timezone: null },
    ], f);
    expect(ms.map((m) => [m.label, !!m.scheduled])).toEqual([["Q1", false], ["Q2", true], ["M1", true], ["X1", true]]);
    expect(ms.map((m) => m.time)).toEqual(["2025-07-19T10:01:13", "2025-07-19T10:07:00", null, null]);
    // Only ordered: no time means no clock, so each epoch is just after the last timed one's.
    expect(ms[2].epoch).toBeGreaterThan(ms[1].epoch);
    expect(ms[3].epoch).toBeGreaterThan(ms[2].epoch);
  });
  it("Chicago Robotics Invitational's results: none has a time, all are read in label order", () => {
    const ms = playedMatches([{ label: "M1", time: null, timezone: null }, { label: "Q2", time: null, timezone: null }, { label: "Q1", time: null, timezone: null }], f);
    expect(ms.map((m) => m.label)).toEqual(["Q1", "Q2", "M1"]);
    expect(ms.every((m) => m.scheduled)).toBe(true);
  });
  it("leaves out a time the event's zone can't place", () => {
    expect(playedMatches([{ label: "Q1", time: "2025-07-19T10:01:13", timezone: null }], { ...f, utcMs: () => null })).toEqual([]);
  });
});

describe("wholeLength", () => {
  it("times a video by its player when YouTube gave no duration, never a live stream or an empty player", () => {
    expect(wholeLength(25019.6)).toBe(25020);
    expect(wholeLength(Infinity)).toBeNull();
    expect(wholeLength(NaN)).toBeNull();
    expect(wholeLength(0)).toBeNull();
  });
});

describe("an event whose scoring clock kept UTC", () => {
  // 2021 USIAJOM2 (Johnston, Iowa; America/Chicago): FIRST's actual starts Q1 16:42:01 … Q21 20:34:53, its broadcast
  // PnYwXxwdOcY 2021-11-13 16:01:52–20:45:40 UTC (10:01–14:45 at the venue). As local time every start is after the
  // video ends; as UTC every one is inside it.
  const utcMs = (time: string, timezone: string | null) => Date.parse(`${time}${timezone === "America/Chicago" ? "-06:00" : "Z"}`);
  const times = { Q1: "2021-11-13T16:42:01.562", Q2: "2021-11-13T16:56:53.803", Q3: "2021-11-13T17:13:40.704", Q4: "2021-11-13T17:26:22.219", Q21: "2021-11-13T20:34:53.435" };
  const rows = Object.entries(times).map(([label, time]) => ({ label, time, timezone: "America/Chicago" }));
  const played = playedMatches(rows, { utcMs, actual: () => true, rank: (l) => Number(l.slice(1)) });
  const broadcast = { start: Date.parse("2021-11-13T16:01:52Z") / 1000, end: Date.parse("2021-11-13T20:45:40Z") / 1000 };
  const asUtc = (t: string) => Date.parse(`${t}Z`) / 1000;

  it("USIAJOM2: none inside its broadcast as Chicago time, every one as UTC, so UTC is used", () => {
    const r = clockReading(played, [broadcast], asUtc);
    expect(r.utc).toBe(true);
    expect(r.played.map((m) => m.label)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q21"]);
    expect(r.played[0].epoch).toBe(asUtc(times.Q1));
    expect(r.played.every((m) => broadcast.start <= m.epoch && m.epoch <= broadcast.end)).toBe(true);
  });

  it("a scheduled time moves to UTC with the actual ones, so the played order and the untimed tail use one clock", () => {
    // Q3 has only its scheduled time (17:10 on the same clock) and Q22 no time at all.
    const mixed = playedMatches([...rows, { label: "Q22", time: null, timezone: "America/Chicago" }], { utcMs, actual: (t) => t !== times.Q3, rank: (l) => Number(l.slice(1)) });
    const r = clockReading(mixed, [broadcast], asUtc);
    expect(r.utc).toBe(true);
    expect(r.played.map((m) => m.label)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q21", "Q22"]);
    expect(r.played.find((m) => m.label === "Q3")!.epoch).toBe(asUtc(times.Q3));
    expect(r.played.find((m) => m.label === "Q22")!.epoch).toBe(asUtc(times.Q21) + 1);
  });

  it("local time kept when any start is inside a broadcast, when UTC places only some, or with no broadcast start", () => {
    // One start inside as local time: the clock is the venue's.
    const early = { start: broadcast.start, end: Date.parse("2021-11-13T23:00:00Z") / 1000 };
    expect(clockReading(played, [early], asUtc).utc).toBe(false);
    // As UTC only some are inside (the broadcast ends at 18:00 UTC): not a clock kept in UTC, so nothing changes.
    expect(clockReading(played, [{ start: broadcast.start, end: Date.parse("2021-11-13T18:00:00Z") / 1000 }], asUtc).utc).toBe(false);
    // An upload (no broadcast start) never decides it.
    expect(clockReading(played, [{ start: null, end: null }], asUtc)).toEqual({ played, utc: false });
    // A scheduled-only time (2019's qualifications) isn't an actual start: with none actual, nothing changes.
    const scheduled = played.map((m) => ({ ...m, scheduled: true }));
    expect(clockReading(scheduled, [broadcast], asUtc).utc).toBe(false);
  });
});

describe("the browser that plays the videos", () => {
  it("Google Chrome when installed (it plays H.264-only videos: 2021 NLCMP, USMSBILT), else Playwright's Chromium", async () => {
    const asked: (string | undefined)[] = [], said: string[] = [];
    const chrome = await launchPlayerBrowser(async (o) => { asked.push(o.channel); return `browser:${o.channel ?? "chromium"}`; }, (s) => said.push(s));
    expect(chrome).toBe("browser:chrome");
    expect(asked).toEqual(["chrome"]);
    expect(said[0]).toMatch(/Google Chrome/);
    const none: (string | undefined)[] = [];
    const fallback = await launchPlayerBrowser(async (o) => { none.push(o.channel); if (o.channel) throw new Error("Chromium distribution 'chrome' is not found"); return "browser:chromium"; }, (s) => said.push(s));
    expect(fallback).toBe("browser:chromium");
    expect(none).toEqual(["chrome", undefined]);
    expect(said[1]).toMatch(/Playwright's Chromium/);
  });
  it("any other failure to start Chrome is an error, not a quiet fall back to Chromium", async () => {
    const asked: (string | undefined)[] = [];
    const crash = launchPlayerBrowser(async (o) => { asked.push(o.channel); throw new Error("Browser closed unexpectedly"); });
    await expect(crash).rejects.toThrow("Browser closed unexpectedly");
    expect(asked).toEqual(["chrome"]);
  });
});

describe("firstOpening", () => {
  // A frame naming the match at the given seconds; every second read is recorded.
  const at = (named: number[]) => { const read: number[] = []; return { read, names: async (t: number) => (read.push(t), named.includes(t)) }; };
  it("every lead-in second before the start is tried before +2 and +4", () => {
    expect(OPEN_LEADS.slice(0, 5)).toEqual([20, 12, 5, 2, 0]);
    expect(OPEN_LEADS.slice(5)).toEqual([-2, -4]);
  });
  it("never opens after the start when any lead-in frame names the match", async () => {
    for (const lead of [20, 12, 5, 2, 0]) {
      const f = at([1000 - lead, 1002, 1004]);
      expect(await firstOpening(1000, f.names)).toBe(1000 - lead);
      expect(f.read.some((t) => t > 1000)).toBe(false);
    }
  });
  it("opens 2, then 4 s into the match only where no frame before its start names it (an upload cut from the last results)", async () => {
    expect(await firstOpening(4656, at([4658, 4660]).names)).toBe(4658);
    expect(await firstOpening(4656, at([4660]).names)).toBe(4660);
    const none = at([]);
    expect(await firstOpening(4656, none.names)).toBeNull();
    expect(none.read).toEqual([4636, 4644, 4651, 4654, 4656, 4658, 4660]);
  });
  it("skips a second before the video's start, and stops at a failed read", async () => {
    const early = at([]);
    await firstOpening(6, early.names);
    expect(early.read).toEqual([1, 4, 6, 8, 10]);
    let n = 0;
    expect(await firstOpening(1000, async () => (++n === 2 ? "stop" : false))).toBeNull();
    expect(n).toBe(2);
  });
});

describe("between", () => {
  const ms = [{ label: "Q1", epoch: 0 }, { label: "Q2", epoch: 300 }, { label: "Q3", epoch: 600 }, { label: "Q4", epoch: 900, scheduled: true }, { label: "Q5", epoch: 1200 }];
  it("is a match with reads on both sides of it", () => {
    const seen = new Map([[0, 10], [4, 1210]]);
    expect([1, 2, 3].map((i) => between(ms, seen, i))).toEqual([true, true, true]);
    expect(between(ms, seen, 0)).toBe(false);
    expect(between(ms, seen, 4)).toBe(false);
  });
  it("needs a read after it, and a scheduled match's read doesn't count", () => {
    expect(between(ms, new Map([[0, 10], [1, 310]]), 2)).toBe(false);
    expect(between(ms, new Map([[0, 10], [3, 5000]]), 2)).toBe(false);
  });
  it("gives each such match both sides' tries and a confirm", () => {
    expect(GAP_READS).toBe(2 * TRIES + 4);
  });
});

describe("eventLimitMs: an event's own read limit", () => {
  const MIN = 60_000, H = 3600;
  it("is the floor for an event of ordinary length", () => {
    expect(eventLimitMs(180 * MIN, [1 * H, 1.5 * H])).toBe(180 * MIN);
    expect(eventLimitMs(180 * MIN, [])).toBe(180 * MIN);
  });
  it("scales with its videos' summed length, so a long event's real read isn't stopped", () => {
    expect(EVENT_LIMIT_RATIO).toBe(1);
    // 2022 ROBUQ1: three videos, ~27 h, read whole in 68 min at the slowest.
    expect(eventLimitMs(180 * MIN, [9 * H, 9 * H, 9 * H])).toBe(27 * 60 * MIN);
    // 2022 ROBUQ2: three videos, 20.5 h, read in 203 min on amelia, more than twice that with 8 readers on one computer.
    // A quarter (308 min) would have cut that slow read; its own length is six times the real one.
    const robuq2 = eventLimitMs(180 * MIN, [12_205, 35_358, 26_221]);
    expect(robuq2).toBe(1230 * MIN);
    expect(robuq2).toBeGreaterThan(6 * 203 * MIN);
    expect(eventLimitMs(180 * MIN, [12_205, 35_358, 26_221], 0.25)).toBeLessThan(2.5 * 203 * MIN);
  });
  it("counts a length that isn't a real number as none, and rounds up to whole minutes", () => {
    expect(eventLimitMs(0, [NaN, -5, 100 * 60])).toBe(100 * MIN);
    expect(eventLimitMs(0, [61], 1)).toBe(2 * MIN);
    expect(eventLimitMs(10 * MIN, [100 * H], 0.5)).toBe(50 * 60 * MIN);
  });
});

describe("edgeReject", () => {
  it("rejects a bar whose qualification total isn't this event's, saying whose it may be", () => {
    // CABCVAS1 2023 (14 qualifications) opens on a setup screen naming a 5-match schedule's Q4.
    const why = edgeReject("FIRST in SHOW — BC Lower Mainland Scrimmage 1 Qualification 4 of 5 CENTERSTAGE", null, undefined, 14);
    expect(why).toMatch(/"of 5", not this event's 14 qualifications/);
    expect(edgeReject("Up Next\nQualification 4 of 5", "own", undefined, 14)).not.toBeNull();
  });
  it("takes this event's total, a bar with none, and an event whose count isn't known", () => {
    expect(edgeReject("BC Lower Mainland Scrimmage 1 Qualification 4 of 14", null, undefined, 14)).toBeNull();
    expect(edgeReject("Semifinal 1 Match 2", null, undefined, 14)).toBeNull();
    expect(edgeReject("Qualification 4 of 5", null, undefined, undefined)).toBeNull();
    // A split screen: one of the totals read is this event's.
    expect(edgeReject("Qualification 3 of 18 | Qualification 7 of 14", null, undefined, 14)).toBeNull();
  });
  it("rejects another division's or event's overlay with readAt's reason", () => {
    expect(edgeReject("Qualification 4 of 14", "other", "another event's overlay", 14)).toBe("another event's overlay");
    expect(edgeReject("Qualification 4 of 14", "other", undefined, 14)).toBe("another division's overlay");
  });
});
