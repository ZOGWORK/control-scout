// The clip autopilot's choices (scripts/lib/autopilotRun.ts): which queued events a run reads, when one that gave
// nothing new is tried again, and what its data PR's CHANGELOG entry says.
import { describe, expect, it } from "vitest";
import { nextRelease, parseChangelog } from "../../src/lib/changelog";
import { GIVE_UP, RETRY_MS, changelogEntry, forgetSettled, nextVersion, pickEvents, remember, rowsDelta, type Memory, type Queued } from "./autopilotRun";
import type { Row } from "./autopilotRows";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const q = (code: string, rank: number, state = "queued"): Queued => ({ season: 2025, code, name: code, frames: { state, due: 10, rank } });

describe("pickEvents", () => {
  it("reads queued events in the queue's order, at most max, the rest next run", () => {
    const r = pickEvents([q("B", 2), q("A", 1), q("W", 0, "waiting"), q("C", 3)], new Set(), {}, 2, NOW);
    expect(r.picked.map((x) => x.code)).toEqual(["A", "B"]);
    expect(r.skipped).toEqual([{ event: "2025/C", why: "next run" }]);
  });

  it("skips an event in an open autopilot PR, and one waiting out a retry or given up", () => {
    const memory: Memory = {
      "2025/B": { tries: 1, last: new Date(NOW - RETRY_MS / 2).toISOString(), result: "no new rows" },
      "2025/C": { tries: GIVE_UP, last: new Date(NOW - 2 * RETRY_MS).toISOString(), result: "no new rows" },
      "2025/D": { tries: 1, last: new Date(NOW - RETRY_MS - 1).toISOString(), result: "no new rows" },
    };
    const r = pickEvents([q("A", 1), q("B", 2), q("C", 3), q("D", 4)], new Set(["2025/A"]), memory, 5, NOW);
    expect(r.picked.map((x) => x.code)).toEqual(["D"]);
    expect(r.skipped.map((s) => s.event)).toEqual(["2025/A", "2025/B", "2025/C"]);
    expect(r.skipped[1].why).toBe("read 2026-11-16 with nothing new (no new rows): tried again after 2026-11-19");
    expect(r.skipped[2].why).toMatch(/^read 3 times with nothing new/);
  });

  it("remembers a read that gave nothing new, forgets one that shipped or whose event is no longer queued", () => {
    const m: Memory = {};
    remember(m, "2025/A", 0, "no new rows", NOW);
    remember(m, "2025/A", 0, "no new rows", NOW);
    remember(m, "2025/B", 0, "rows refused", NOW);
    expect(m["2025/A"]).toEqual({ tries: 2, last: new Date(NOW).toISOString(), result: "no new rows" });
    remember(m, "2025/A", 3, "shipped", NOW);
    expect(m["2025/A"]).toBeUndefined();
    forgetSettled(m, new Set());
    expect(m).toEqual({});
  });
});

describe("the data PR", () => {
  const live = new Map<string, Row>([["v1|AAQ", { videoId: "v1", code: "AAQ", checked: "2026-11-15", starts: { Q1: 600 } }]]);
  const rows: Row[] = [
    { videoId: "v1", code: "AAQ", checked: "2026-11-17", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588, Q2: 995 }, missing: { Q3: "its frames didn't confirm a start" } },
    { videoId: "v2", code: "BBQ", checked: "2026-11-17", starts: {}, missing: { Q1: "no frame read of it, and no agreeing reads on both sides" } },
  ];

  it("counts the clips it adds and the matches it gives a reason", () => {
    expect(rowsDelta(rows, live)).toEqual({ clips: 1, recordings: 2, events: ["AAQ", "BBQ"], reasons: 2 });
  });

  it("writes a CHANGELOG entry the What's new dialog reads: 3 short tagged highlights", () => {
    for (const d of [rowsDelta(rows, live), rowsDelta([rows[1]], live)]) {
      const text = changelogEntry(2025, d, "2026-11-17").replace("VERSION", "9.9.9").replace("#PR", "#1");
      const [e] = parseChangelog(text);
      expect(e.version).toBe("9.9.9");
      expect(e.highlights).toHaveLength(3);
      for (const h of e.highlights) { expect(h.tag).toBe("fixes"); expect(h.text.length).toBeLessThanOrEqual(72); }
    }
    expect(changelogEntry(2025, rowsDelta(rows, live), "2026-11-17")).toContain("Videos › 1 more match get clips");
    expect(changelogEntry(2025, rowsDelta([rows[1]], live), "2026-11-17")).toContain("no new clip");
  });

  it("numbers releases as the app does", () => {
    for (const v of ["7.2.8", "7.2.9", "7.9.9", "1.0.0"]) expect(nextVersion(v)).toBe(nextRelease(v));
  });
});
