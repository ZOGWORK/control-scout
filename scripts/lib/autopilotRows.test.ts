// The clip autopilot's row checks (scripts/lib/autopilotRows.ts): a row the frame reader wrote ships only when it keeps
// the strict rules against the row live now, and the rows that pass go out applied to main's season file, at most
// 15 KB a PR.
import { describe, expect, it } from "vitest";
import { applyRows, changedRows, chunkRows, fileRows, prMarker, readMarker, rowLine, rowProblems, type Row } from "./autopilotRows";

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
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 590 } }))).toEqual(["Q1: opens 10 s before its start, not 20/12/5/2/0"]);
  });

  it("refuses overlapping starts and seconds that aren't in a video", () => {
    expect(rowProblems(row({ starts: { Q1: 600, Q2: 690 }, opens: { Q1: 588, Q2: 685 } }))).toEqual(["Q1: its start overlaps another match's", "Q2: its start overlaps another match's"]);
    expect(rowProblems(row({ starts: { Q1: -3 }, opens: { Q1: -5 } }))[0]).toBe("Q1: start -3 isn't a second in the video");
  });

  it("never lets a new placement be unconfirmed: only a live clip whose opening named nothing stays so", () => {
    expect(rowProblems(row({ starts: { Q1: 600 }, unconfirmed: ["Q1"] }))).toEqual(["Q1: unconfirmed, but not a live clip at that second"]);
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
    // Moved further than a read's slack is a drop too.
    expect(rowProblems(row({ starts: { Q1: 600, Q2: 1200 }, opens: { Q1: 588, Q2: 1195 } }), live)).toEqual(["Q2: a live clip moved without a frame naming another match"]);
  });

  it("leaves an older live row's starts as they were (no openings yet), but a re-read must be dated after it", () => {
    const live = row({ checked: "2026-11-14", starts: { Q1: 600, Q2: 1000 } });
    expect(rowProblems(row({ checked: "2026-11-17", starts: { Q1: 600, Q2: 1000 }, opensOn: { at: 3, label: "Q1" } }), live)).toEqual([]);
    expect(rowProblems(row({ checked: "2026-11-14", starts: { Q1: 600, Q2: 1000 }, opensOn: { at: 3, label: "Q1" } }), live)).toEqual(["changed without a newer checked date than the live row's (2026-11-14)"]);
    expect(rowProblems(live, live)).toEqual([]);
    // Once a row checks openings, a live start it keeps needs one, or is unconfirmed.
    expect(rowProblems(row({ starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588 } }), live)).toEqual(["Q2: a live clip left with no opening and not unconfirmed"]);
  });

  it("refuses an early start that doesn't overlap the match before", () => {
    expect(rowProblems(row({ earlyStart: { Q2: { t: 900, previousEnds: 880 } } }))).toEqual(["Q2: early start 900 isn't before the previous match's end 880"]);
    expect(rowProblems(row({ checked: "Nov 17" }))).toEqual(['checked "Nov 17" isn\'t a date']);
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
    expect(readMarker("no mark")).toBeNull();
    expect(readMarker("<!-- clip-autopilot {not json} -->")).toBeNull();
  });
});
