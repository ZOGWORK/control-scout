// The clip autopilot's checks on the first-frame sweep's rows (scripts/lib/autopilotClips.ts): a clip is pulled only
// where its first frame names another match, and what the live row settled stays settled.
import { describe, expect, it } from "vitest";
import { parseChangelog } from "../../src/lib/changelog";
import { clipCheckProblems, clipsDelta, clipsEntry } from "./autopilotClips";
import type { ClipCheck } from "../../server/data/clipChecks";

const row = (o: Partial<ClipCheck> = {}): ClipCheck => ({ videoId: "W9fnbtAc6Z8", code: "USCOLIQ", season: 2025, checked: "2026-11-17", ...o });

describe("clipCheckProblems", () => {
  it("passes a sweep row: ok by its own frame, pulled by another match's, unconfirmed by none", () => {
    expect(clipCheckProblems(row({ ok: ["Q13"], pulled: { Q14: { t: 12659, showed: "Q17" } }, unconfirmed: { Q15: { t: 12900, why: "its first frame names no match" } } }))).toEqual([]);
    expect(clipCheckProblems(row({ noOverlay: true }))).toEqual([]);
  });

  it("refuses a pull whose frame names the match itself (a replay by its match), or nothing", () => {
    expect(clipCheckProblems(row({ pulled: { Q14: { t: 12659, showed: "Q14" } } }))).toEqual(["Q14: pulled, but its frame names Q14"]);
    expect(clipCheckProblems(row({ pulled: { "M6-2": { t: 100, showed: "M6" } } }))).toEqual(["M6-2: pulled, but its frame names M6"]);
    expect(clipCheckProblems(row({ pulled: { Q14: { t: 12659, showed: "" } } }))).toEqual(["Q14: pulled, but its frame names nothing"]);
    expect(clipCheckProblems(row({ pulled: { Q14: { t: -1, showed: "Q17" } } }))).toEqual(["Q14: pulled at -1, not a second in the video"]);
  });

  it("refuses a clip in two states, and an overlay both unreadable and read", () => {
    expect(clipCheckProblems(row({ ok: ["Q1"], pulled: { Q1: { t: 5, showed: "Q3" } } }))).toEqual(["Q1: both ok and pulled"]);
    expect(clipCheckProblems(row({ ok: ["Q1"], unconfirmed: { Q1: { t: 5, why: "x" } } }))).toEqual(["Q1: both ok and unconfirmed"]);
    expect(clipCheckProblems(row({ noOverlay: true, ok: ["Q1"] }))).toEqual(["no readable overlay, yet a frame was read"]);
    expect(clipCheckProblems(row({ season: 2025.5 }))).toEqual(["season 2025.5 isn't a season"]);
  });

  it("keeps what the live row settled: a pull lifts only on a frame naming the match, an ok goes only on another's", () => {
    const live = row({ checked: "2026-11-16", ok: ["Q1"], pulled: { Q14: { t: 12659, showed: "Q17" } } });
    expect(clipCheckProblems(row({ ok: ["Q1"] }), live)).toEqual(["Q14: a pulled clip back without a frame naming it"]);
    expect(clipCheckProblems(row({ ok: ["Q1", "Q14"] }), live)).toEqual([]);
    expect(clipCheckProblems(row({ pulled: { Q14: { t: 12659, showed: "Q17" } } }), live)).toEqual(["Q1: an ok clip dropped without a frame naming another match"]);
    expect(clipCheckProblems(row({ pulled: { Q14: { t: 12659, showed: "Q17" }, Q1: { t: 5021, showed: "Q2" } } }), live)).toEqual([]);
    expect(clipCheckProblems(row({ checked: "2026-11-15", ok: ["Q1"], pulled: { Q14: { t: 12659, showed: "Q17" } }, unconfirmed: { Q2: { t: 1, why: "x" } } }), live))
      .toEqual(["changed with an older checked date than the live row's (2026-11-16)"]);
  });
});

describe("the sweep's data PR", () => {
  const rows = [
    row({ ok: ["Q13"], pulled: { Q14: { t: 12659, showed: "Q17" } }, unconfirmed: { Q15: { t: 12900, why: "its first frame names no match" } } }),
    row({ videoId: "_VqYWOU1aCM", code: "USWISHQ", season: 2024, pulled: { Q28: { t: 2456, showed: "Q27" } } }),
  ];

  it("counts what's new against the live rows, and names each pull", () => {
    const d = clipsDelta(rows, new Map([["_VqYWOU1aCM|USWISHQ", row({ videoId: "_VqYWOU1aCM", code: "USWISHQ", season: 2024, checked: "2026-11-16", pulled: { Q28: { t: 2456, showed: "Q27" } } })]]));
    expect(d).toEqual({ checked: 3, ok: 1, pulled: 1, unconfirmed: 1, noOverlay: 0, events: ["2024 USWISHQ", "2025 USCOLIQ"], pulledList: ["2025 USCOLIQ Q14 (W9fnbtAc6Z8 at 12659 s shows Q17)"] });
  });

  it("writes a CHANGELOG entry What's new reads: 3 short tagged highlights", () => {
    for (const d of [clipsDelta(rows, new Map()), clipsDelta([row({ ok: ["Q1"] })], new Map())]) {
      const [e] = parseChangelog(clipsEntry(d, "2026-11-17").replace("VERSION", "9.9.9").replace("#PR", "#1"));
      expect(e.highlights).toHaveLength(3);
      for (const h of e.highlights) { expect(h.tag).toBe("fixes"); expect(h.text.length).toBeLessThanOrEqual(72); }
    }
    expect(clipsEntry(clipsDelta(rows, new Map()), "2026-11-17")).toContain("2 clips that opened on the wrong match no longer play");
  });
});
