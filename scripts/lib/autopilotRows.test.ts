// The clip autopilot's row checks (scripts/lib/autopilotRows.ts): a row the frame reader wrote ships only when it keeps
// the strict rules against the row live now, and the rows that pass go out applied to main's season file, at most
// 15 KB a PR.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyRows, changedRows, chunkRows, diffBytes, fileRows, LOOPY_DIFF_MAX, prChunks, prMarker, readMarker, rowGroups, rowKey, rowLine, rowProblems, type Row } from "./autopilotRows";

const row = (o: Partial<Row> = {}): Row => ({ videoId: "VIDEOaaaaa1", code: "USXXQ", checked: "2026-11-17", starts: {}, ...o });
// Q1 and Q2 placed, each opening checked (12 s and 5 s before its start).
const READ = row({ starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588, Q2: 995 } });

describe("rowProblems", () => {
  it("passes a new row whose every start is plausible and opens on its match at a lead of 20/12/5/2/0", () => {
    expect(rowProblems(READ)).toEqual([]);
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 600 } }))).toEqual([]);
  });

  it("refuses a start without a checked opening, or one opening at another lead", () => {
    expect(rowProblems(row({ starts: { Q1: 600 } }))).toEqual(["Q1: no opening frame checked for it"]);
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 590 } }))).toEqual(["Q1: opens 10 s before its start, not 20/12/5/2/0/-2/-4"]);
    // A clip may open 2 or 4 s into its match (an upload cut straight from the last results into it), never later.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 604 } }))).toEqual([]);
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 606 } }))).toEqual(["Q1: opens -6 s before its start, not 20/12/5/2/0/-2/-4"]);
  });

  it("refuses overlapping starts and seconds that aren't in a video", () => {
    expect(rowProblems(row({ starts: { Q1: 600, Q2: 690 }, opens: { Q1: 588, Q2: 685 } }))).toEqual(["Q1: its start overlaps another match's", "Q2: its start overlaps another match's"]);
    expect(rowProblems(row({ starts: { Q1: -3 }, opens: { Q1: -5 } }))[0]).toBe("Q1: start -3 isn't a second in the video");
    expect(rowProblems(row({ starts: { Q1: 10 }, opens: { Q1: -10 } }))).toEqual(["Q1: opening -10 isn't a second in the video"]);
  });

  it("refuses starts out of the order the matches were played, by their real starts, not their numbers", () => {
    const opens = (s: Record<string, number>) => Object.fromEntries(Object.entries(s).map(([l, t]) => [l, t - 5]));
    const swapped = { Q1: 1000, Q2: 600 };
    expect(rowProblems(row({ starts: swapped, opens: opens(swapped) }), undefined, ["Q1", "Q2"])).toEqual(["Q2: starts before Q1, out of the order they were played"]);
    // Played Q2 first (FPEMITHO 2024 played some qualifications out of number order), and a replay after the next
    // match (TRISQ1 2024's M3-2 after M4): in the order played, so fine.
    expect(rowProblems(row({ starts: swapped, opens: opens(swapped) }), undefined, ["Q2", "Q1"])).toEqual([]);
    const replay = { M3: 100, M4: 500, "M3-2": 900 };
    expect(rowProblems(row({ starts: replay, opens: opens(replay) }), undefined, ["M3", "M4", "M3-2"])).toEqual([]);
    // A start for a match the event never played.
    expect(rowProblems(row({ starts: { Q9: 600 }, opens: { Q9: 588 } }), undefined, ["Q1", "Q2"])).toEqual(["Q9: not a match the event played"]);
    // Without the order, nothing to check it against.
    expect(rowProblems(row({ starts: swapped, opens: opens(swapped) }))).toEqual([]);
  });

  it("never lets a new placement be unconfirmed: only a live clip whose opening named nothing stays so", () => {
    expect(rowProblems(row({ starts: { Q1: 600 }, unconfirmed: ["Q1"] }))).toEqual(["Q1: unconfirmed, but not a live clip at that second"]);
    // A checked opening doesn't make a new placement's "unconfirmed" right.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, unconfirmed: ["Q1"] }))).toEqual(["Q1: unconfirmed, but not a live clip at that second"]);
    expect(rowProblems(row({ starts: {}, unconfirmed: ["Q4"] }))).toEqual(["Q4: unconfirmed, but not a live clip at that second"]);
    const live = row({ checked: "2026-11-15", starts: { Q1: 600 } });
    expect(rowProblems(row({ starts: { Q1: 603 }, opens: {}, unconfirmed: ["Q1"] }), live)).toEqual([]);
  });

  it("keeps every live clip unless a frame at its opening names another match", () => {
    const live = row({ checked: "2026-11-15", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588, Q2: 995 } });
    // Dropped with nothing on screen to say so: refused.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 } }), live)).toEqual(["Q2: a live clip dropped without a frame naming another match"]);
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, review: { Q2: { t: 1000, why: "a live clip this read finds outside the video" } } }), live))
      .toEqual(["Q2: a live clip dropped without a frame naming another match"]);
    // A paused frame there names Q3: pulled, rightly.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, review: { Q2: { t: 1000, why: "its clip's first frame shows Q3, not Q2" } } }), live)).toEqual([]);
    // A pull with no second read at all pulls nothing.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, review: { Q2: { why: "its clip's first frame shows Q3, not Q2" } as any } }), live)).toEqual(["Q2: a live clip dropped without a frame naming another match"]);
    // A naming frame read somewhere else (where a re-read placed it) doesn't pull the clip at its live second.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, review: { Q2: { t: 5000, why: "its clip's first frame shows Q3, not Q2" } } }), live)).toEqual(["Q2: a live clip dropped without a frame naming another match"]);
    // Only a frame naming a different match pulls it.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, review: { Q2: { t: 1000, why: "its clip's first frame shows Q2, not Q2" } } }), live)).toEqual(["Q2: a live clip dropped without a frame naming another match"]);
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 588 }, review: { Q2: { t: 1000, why: "its clip's first frame shows Q3, not Q4" } } }), live)).toEqual(["Q2: a live clip dropped without a frame naming another match"]);
    // Moved further than a read's slack is a drop too.
    expect(rowProblems(row({ starts: { Q1: 600, Q2: 1200 }, opens: { Q1: 588, Q2: 1195 } }), live)).toEqual(["Q2: a live clip moved without a frame naming another match"]);
  });

  it("leaves an older live row's starts as they were (no openings yet), but a re-read must be dated after it", () => {
    const live = row({ checked: "2026-11-14", starts: { Q1: 600, Q2: 1000 } });
    expect(rowProblems(row({ checked: "2026-11-17", starts: { Q1: 600, Q2: 1000 }, opensOn: { at: 3, label: "Q1" } }), live)).toEqual([]);
    expect(rowProblems(row({ checked: "2026-11-14", starts: { Q1: 600, Q2: 1000 }, opensOn: { at: 3, label: "Q1" } }), live)).toEqual(["changed without a newer checked date than the live row's (2026-11-14)"]);
    expect(rowProblems(live, live)).toEqual([]);
    // An opening a re-read adds to an older row's start is checked like a new one's.
    expect(rowProblems(row({ checked: "2026-11-18", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 590, Q2: 995 } }), live)).toEqual(["Q1: opens 10 s before its start, not 20/12/5/2/0/-2/-4"]);
    expect(rowProblems(row({ checked: "2026-11-18", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588, Q2: 995 } }), live)).toEqual([]);
    // Openings the live row had can't be dropped.
    const checkedLive = row({ checked: "2026-11-14", starts: { Q1: 600 }, opens: { Q1: 588 } });
    expect(rowProblems(row({ checked: "2026-11-18", starts: { Q1: 600 } }), checkedLive)).toEqual(["openings the live row checked are gone"]);
    // Once a row checks openings, a live start it keeps needs one, or is unconfirmed.
    expect(rowProblems(row({ starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588 } }), live)).toEqual(["Q2: a live clip left with no opening and not unconfirmed"]);
  });

  it("refuses an early start that doesn't overlap the match before", () => {
    expect(rowProblems(row({ earlyStart: { Q2: { t: 900, previousEnds: 880 } } }))).toEqual(["Q2: early start 900 isn't before the previous match's end 880"]);
    expect(rowProblems(row({ checked: "Nov 17" }))).toEqual(['checked "Nov 17" isn\'t a date']);
    expect(rowProblems(row({ checked: "2026-99-99" }))).toEqual(['checked "2026-99-99" isn\'t a date']);
    expect(rowProblems(row({ checked: "2026-02-30" }))).toEqual(['checked "2026-02-30" isn\'t a date']);
  });
});

const FILE = (rows: Row[]) => `// header\nimport type { FrameTiming } from "../frameTimings.js";\n\n// --- Data (scripts/video-frames.ts writes from here on) ---\nexport const ROWS: FrameTiming[] = [\n${rows.map(rowLine).join("\n")}\n];\n`;

describe("season files", () => {
  const A = row({ code: "AAQ", videoId: "v1" }), B = row({ code: "BBQ", videoId: "v2" }), C = row({ code: "CCQ", videoId: "v3" });

  it("applies rows (replacing their own, adding new ones in order) and leaves every other line as it was", () => {
    const before = FILE([A, C]);
    const after = applyRows(before, [B, { ...C, checked: "2026-11-18" }]);
    expect(after).toBe(FILE([A, B, { ...C, checked: "2026-11-18" }]));
    expect(changedRows(before, after).map((r) => r.code)).toEqual(["BBQ", "CCQ"]);
    expect(fileRows(after)).toHaveLength(3);
    // The empty season file of a season not read yet.
    expect(applyRows("// --- Data\nexport const ROWS: FrameTiming[] = [\n];\n", [A])).toBe(`// --- Data\nexport const ROWS: FrameTiming[] = [\n${rowLine(A)}\n];\n`);
    expect(() => applyRows("no mark", [A])).toThrow('no "// --- Data" mark');
  });

  it("puts a new row before the first row whose code sorts after it, never re-sorting or appending what's there", () => {
    const D = row({ code: "DDQ", videoId: "v4" }), C2 = row({ code: "CCQ", videoId: "v0" });
    // A file other sources left out of order: its lines stay where they are; only the PR's own lines change.
    const before = FILE([C, A, D]);
    expect(applyRows(before, [B])).toBe(FILE([B, C, A, D]));
    // Same code as rows already there: after them, before the next code (DDQ), not re-sorted by video.
    expect(applyRows(before, [C2])).toBe(FILE([C, A, C2, D]));
    // Nothing sorts after it: the only case it goes last.
    expect(applyRows(FILE([A, B]), [D])).toBe(FILE([A, B, D]));
    // A replaced row keeps its own line's place.
    expect(applyRows(before, [{ ...A, checked: "2026-11-18" }])).toBe(FILE([C, { ...A, checked: "2026-11-18" }, D]));
    expect(applyRows(before, [])).toBe(before);
  });

  it("measures a diff as git shows it: lines added and removed, three lines of context either side, its headers", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${String(i).padStart(2, "0")}`);
    const before = lines.join("\n"), after = [...lines.slice(0, 10), "added", ...lines.slice(10)].join("\n");
    // The file's header (160) and one hunk's (32), 6 context lines and the added one, each with its "+"/" " and newline.
    expect(diffBytes(before, after)).toBe(160 + 32 + 6 * 9 + 7);
    expect(diffBytes(before, before.replace("line 05", "line X5"))).toBe(160 + 32 + 6 * 9 + 9 + 9); // context, the new line, the old one
    // Two changes far apart: two hunks.
    expect(diffBytes(before, before.replace("line 01", "line X1").replace("line 18", "line X8"))).toBe(160 + 2 * 32 + (4 + 4) * 9 + 2 * (9 + 9));
    expect(diffBytes(before, before)).toBe(0);
  });

  it("ships rows as PRs whose diffs on main's file each stay under the cap, every row shipped or left for later", () => {
    // Rows of about 1 KB each, 10 events of 3 videos, against a file holding a row of every other event.
    const big = (code: string, v: string) => row({ code, videoId: v, starts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Q${i + 1}`, 1000 + i * 400])) });
    const main = FILE(Array.from({ length: 10 }, (_, e) => big(`E${e}Q`, "live" + e)));
    const rows = Array.from({ length: 10 }, (_, e) => [0, 1, 2].map((v) => big(`E${e}Q`, `v${e}${v}`))).flat();
    const { ship, later } = prChunks(main, rows, 6_000);
    expect([...ship.flat(), ...later].map(rowKey).sort()).toEqual(rows.map(rowKey).sort());
    expect(later).toEqual([]);
    for (const c of ship) expect(diffBytes(main, applyRows(main, c))).toBeLessThanOrEqual(6_000);
    // A row bigger than the cap alone: shipped alone, never dropped or split.
    expect(prChunks(main, [big("E1Q", "solo")], 500)).toEqual({ ship: [[big("E1Q", "solo")]], later: [], tooBig: [] });
  });

  it("never splits rows whose changes touch (one gap, neighbouring lines) across PRs: git would conflict", () => {
    const big = (code: string, v: string) => row({ code, videoId: v, starts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Q${i + 1}`, 1000 + i * 400])) });
    const live = ["AQ", "CQ", "EQ", "GQ", "IQ"].map((c) => big(c, "live"));
    const main = FILE(live);
    // Two new BQ rows share the gap before CQ's line, which the changed CQ row replaces, and a new CQ row goes right
    // after it (before EQ): all four touch, so one PR.
    const b1 = big("BQ", "b1"), b2 = big("BQ", "b2"), c2 = big("CQ", "c2"), cMoved = { ...live[1], checked: "2026-11-18" };
    // Far apart: a new HQ row (before IQ). A cap that fits them all: the touching four in one PR.
    expect(rowGroups(main, [b1, c2, b2, cMoved, big("HQ", "h1")]).map((g) => g.map(rowKey))).toEqual([[rowKey(b1), rowKey(b2), rowKey(cMoved), rowKey(c2)], [rowKey(big("HQ", "h1"))]]);
    // A cap that fits one row a PR: the touching group ships its first row now and the rest wait (never a second PR
    // into the same lines); the HQ group, apart, ships too.
    expect(prChunks(main, [b1, c2, b2, cMoved, big("HQ", "h1")], 1_000)).toEqual({ ship: [[b1], [big("HQ", "h1")]], later: [b2, cMoved, c2], tooBig: [] });
    // One unchanged line between two changes keeps them apart: a new BQ row (before CQ) and a new DQ row (before EQ).
    expect(rowGroups(main, [b1, big("DQ", "d1"), big("HQ", "h1"), b2]).map((g) => g.map(rowKey))).toEqual([[rowKey(b1), rowKey(b2)], [rowKey(big("DQ", "d1"))], [rowKey(big("HQ", "h1"))]]);
  });

  it("in a sparse file (new events sharing one gap) ships what fits under the cap and leaves the rest for later", () => {
    // 2026.ts has a handful of rows: 8 new events of 3 videos each all go before the one row that sorts after them.
    const big = (code: string, v: string) => row({ code, videoId: v, starts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Q${i + 1}`, 1000 + i * 400])) });
    const main = FILE([big("AAQ", "live"), big("ZZQ", "live")]);
    const rows = ["USCA", "USFL", "USGA", "USIL", "USMI", "USNJ", "USNY", "USTX"].flatMap((e) => [1, 2, 3].map((v) => big(`${e}Q`, `${e}v${v}`)));
    expect(rowGroups(main, rows)).toHaveLength(1);
    const { ship, later } = prChunks(main, rows, 12_000);
    expect(ship).toHaveLength(1);
    expect(diffBytes(main, applyRows(main, ship[0]))).toBeLessThanOrEqual(12_000);
    expect(ship[0].length).toBeGreaterThan(1);
    expect([...ship[0], ...later].map(rowKey).sort()).toEqual(rows.map(rowKey).sort());
    // The first rows in file order ship: the next run reads the rest on the main this PR leaves.
    expect(ship[0].map(rowKey)).toEqual(rows.slice(0, ship[0].length).map(rowKey));
  });

  it("leaves for later any rows touching an open PR's rows: a second PR into the same lines would conflict", () => {
    const big = (code: string, v: string) => row({ code, videoId: v, starts: { Q1: 100 } });
    const main = FILE([big("AQ", "live"), big("CQ", "live"), big("EQ", "live"), big("GQ", "live")]);
    const open = [big("BQ", "inpr")];
    // BQ's gap is the open PR's; DQ's (before EQ) is one unchanged line away: free.
    expect(prChunks(main, [big("BQ", "new"), big("DQ", "new")], 12_000, open)).toEqual({ ship: [[big("DQ", "new")]], later: [big("BQ", "new")], tooBig: [] });
    // A row the open PR changes too waits, even given as new: never two PRs into the same line.
    expect(prChunks(main, [big("BQ", "inpr"), big("DQ", "new")], 12_000, open)).toEqual({ ship: [[big("DQ", "new")]], later: [big("BQ", "inpr")], tooBig: [] });
  });

  it("splits an over-cap group at whole events, stopping at the first that doesn't fit", () => {
    const r = (code: string, v: string, n: number) => row({ code, videoId: v, starts: Object.fromEntries(Array.from({ length: n }, (_, i) => [`Q${i + 1}`, 1000 + i * 400])) });
    const main = FILE([r("AAQ", "live", 1), r("ZZQ", "live", 1)]);
    // One gap: events BQ (2 rows), CQ (2 rows). A cap fitting three rows ships BQ whole, not BQ and half of CQ.
    const bq = [r("BQ", "b1", 40), r("BQ", "b2", 40)], cq = [r("CQ", "c1", 40), r("CQ", "c2", 40)];
    const three = diffBytes(main, applyRows(main, [...bq, cq[0]]));
    expect(prChunks(main, [...bq, ...cq], three)).toEqual({ ship: [bq], later: cq, tooBig: [] });
    // Events DQ (small), EQ (large), FQ (small): DQ ships, and EQ stops it there: FQ waits too, never skipped past EQ.
    const dq = r("DQ", "d", 5), eq = r("EQ", "e", 400), fq = r("FQ", "f", 5);
    expect(prChunks(main, [dq, eq, fq], diffBytes(main, applyRows(main, [dq, fq])))).toEqual({ ship: [[dq]], later: [eq, fq], tooBig: [] });
  });

  it("never ships a row Loopy can't review at all: over the hard limit it's refused, for the owner", () => {
    const huge = row({ code: "MQ", videoId: "huge", missing: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`Q${i}`, "no frame read of it, and no agreeing reads on both sides"])) });
    const main = FILE([A, C]);
    expect(diffBytes(main, applyRows(main, [huge]))).toBeGreaterThan(LOOPY_DIFF_MAX);
    expect(prChunks(main, [huge, B], 12_000)).toEqual({ ship: [[B]], later: [], tooBig: [huge] });
  });

  it("adds the first rows to a season not read yet without a blank line above them", () => {
    expect(applyRows("// --- Data\nexport const ROWS: FrameTiming[] = [\n\n];\n", [A])).toBe(`// --- Data\nexport const ROWS: FrameTiming[] = [\n${rowLine(A)}\n];\n`);
  });

  it("leaves every real data file byte for byte as it is when all its rows are applied again", () => {
    const files = [...readdirSync("server/data/frameTimings").filter((f) => /^\d{4}\.ts$/.test(f)).map((f) => `server/data/frameTimings/${f}`), "server/data/clipChecks.ts"];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(applyRows(text, fileRows(text)), f).toBe(text);
    }
  });

  it("one row a key: given twice, the last counts; a file holding a key twice is refused", () => {
    expect(applyRows(FILE([A]), [B, { ...B, checked: "2026-11-18" }])).toBe(FILE([A, { ...B, checked: "2026-11-18" }]));
    expect(() => applyRows(FILE([A, A]), [B])).toThrow("v1|AAQ is in the file twice");
  });

  it("puts a comma on a hand-written last row that lacks one before rows after it", () => {
    const text = FILE([A]).replace(`${rowLine(A)}`, rowLine(A).replace(/,$/, ""));
    expect(applyRows(text, [C])).toBe(FILE([A, C]));
  });

  it("splits rows into PRs of at most 15 KB, an event's rows together", () => {
    const big = (code: string, videoId: string, n: number) => row({ code, videoId, missing: Object.fromEntries(Array.from({ length: n }, (_, i) => [`Q${i}`, "no frame read of it, and no agreeing reads on both sides"])) });
    const rows = [big("E1", "a", 60), big("E1", "b", 60), big("E2", "c", 100), big("E3", "d", 20), big("E4", "e", 400)];
    const chunks = chunkRows(rows, 15_000);
    const size = (rs: Row[]) => rs.reduce((s, r) => s + rowLine(r).length + 1, 0);
    // E4's one row is over the limit alone: its own PR. Every other PR is at most 15 KB, and E1's two rows stay together.
    expect(chunks[0].map((r) => r.code)).toEqual(["E4"]);
    for (const c of chunks.slice(1)) expect(size(c)).toBeLessThanOrEqual(15_000);
    expect(chunks.filter((c) => c.some((r) => r.code === "E1")).map((c) => c.filter((r) => r.code === "E1").length)).toEqual([2]);
    expect(chunks.flat().map((r) => r.videoId).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(chunks).toHaveLength(3);
  });

  it("marks a PR with its season and rows, read back by the next run", () => {
    const m = prMarker(2025, [A, B]);
    expect(readMarker(`Some text\n\n${m}\n`)).toEqual({ season: 2025, rows: ["v1|AAQ", "v2|BBQ"] });
    expect(readMarker(prMarker(0, [A], "server/data/clipChecks.ts"))).toEqual({ season: 0, rows: ["v1|AAQ"], file: "server/data/clipChecks.ts" });
    expect(readMarker("no mark")).toBeNull();
    expect(readMarker("<!-- clip-autopilot {not json} -->")).toBeNull();
  });
});
