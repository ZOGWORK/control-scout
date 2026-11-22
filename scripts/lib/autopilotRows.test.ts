// The clip autopilot's row checks (scripts/lib/autopilotRows.ts): a row the frame reader wrote ships only when it keeps
// the strict rules against the row live now, and the rows that pass go out applied to main's season file, at most
// 15 KB a PR.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRows, changedRows, fileRows, rowKey, rowLine, rowProblems, type Row } from "./autopilotRows";

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
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 590 } }))).toEqual(["Q1: opens 10 s before its start, not 20, 12, 5, 2 or 0 s before its start, or 2 or 4 s after it"]);
    // A clip may open 2 or 4 s into its match (an upload cut straight from the last results into it), never later.
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 604 } }))).toEqual([]);
    expect(rowProblems(row({ starts: { Q1: 600 }, opens: { Q1: 606 } }))).toEqual(["Q1: opens 6 s after its start, not 20, 12, 5, 2 or 0 s before its start, or 2 or 4 s after it"]);
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
    expect(rowProblems(row({ checked: "2026-11-18", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 590, Q2: 995 } }), live)).toEqual(["Q1: opens 10 s before its start, not 20, 12, 5, 2 or 0 s before its start, or 2 or 4 s after it"]);
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

  it("adds the first rows to a season not read yet without a blank line above them", () => {
    expect(applyRows("// --- Data\nexport const ROWS: FrameTiming[] = [\n\n];\n", [A])).toBe(`// --- Data\nexport const ROWS: FrameTiming[] = [\n${rowLine(A)}\n];\n`);
  });

  it("leaves every real data file byte for byte as it is when all its rows are applied again", () => {
    // From this file's own place, so the test reads the same files whatever directory vitest is started in.
    const data = join(dirname(fileURLToPath(import.meta.url)), "../../server/data");
    const files = [...readdirSync(join(data, "frameTimings")).filter((f) => /^\d{4}\.ts$/.test(f)).map((f) => join(data, "frameTimings", f)), join(data, "clipChecks.ts")];
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
});
