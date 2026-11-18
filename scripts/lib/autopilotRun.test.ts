// The clip autopilot's choices (scripts/lib/autopilotRun.ts): which queued events a run reads, when one that gave
// nothing new is tried again, and what its data PR's CHANGELOG entry says.
import { describe, expect, it } from "vitest";
import { nextRelease, parseChangelog } from "../../src/lib/changelog";
import { ASK_EVERY_MS, GIVE_UP, RETRY_MS, WAIT_MS, askDue, changelogEntry, forgetSettled, needsRebuild, nextVersion, pickEvents, readOutcome, remember, rememberWait, rowsDelta, waitBackoff, type Memory, type Queued } from "./autopilotRun";
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

describe("events whose rows wait", () => {
  it("waits WAIT_MS, doubling each wait in a row, never past RETRY_MS", () => {
    expect([1, 2, 3, 4, 5, 9].map(waitBackoff)).toEqual([WAIT_MS, 2 * WAIT_MS, 4 * WAIT_MS, 8 * WAIT_MS, RETRY_MS, RETRY_MS]);
  });

  it("isn't read again every run, and its waits never count toward GIVE_UP", () => {
    const m: Memory = { "2025/A": { tries: GIVE_UP - 1, last: new Date(NOW - RETRY_MS - 1).toISOString(), result: "no new rows" } };
    for (let i = 0; i < 6; i++) rememberWait(m, "2025/A", "rows wait for an open PR's lines", NOW);
    expect(m["2025/A"]).toEqual({ tries: GIVE_UP - 1, last: new Date(NOW).toISOString(), result: "rows wait for an open PR's lines", waits: 6 });
    // Inside its backoff: skipped, saying when it's read again. Past it: read, though it has waited many times.
    expect(pickEvents([q("A", 1)], new Set(), m, 5, NOW + RETRY_MS - 1).skipped[0].why).toMatch(/^its rows waited 6 times .*: read again after 2026-11-20T12:00Z$/);
    expect(pickEvents([q("A", 1)], new Set(), m, 5, NOW + RETRY_MS).picked.map((x) => x.code)).toEqual(["A"]);
    rememberWait(m, "2025/B", "rows wait", NOW);
    expect(pickEvents([q("B", 1)], new Set(), m, 5, NOW + WAIT_MS - 1).picked).toEqual([]);
    expect(pickEvents([q("B", 1)], new Set(), m, 5, NOW + WAIT_MS).picked.map((x) => x.code)).toEqual(["B"]);
  });

  it("a read with nothing new after waits counts a try and ends the waits", () => {
    const m: Memory = {};
    rememberWait(m, "2025/A", "rows wait", NOW);
    remember(m, "2025/A", 0, "no new rows", NOW);
    expect(m["2025/A"]).toEqual({ tries: 1, last: new Date(NOW).toISOString(), result: "no new rows" });
  });
});

describe("readOutcome", () => {
  const o = (x: Partial<Parameters<typeof readOutcome>[0]>) => readOutcome({ rows: 0, opened: 0, waiting: 0, tooBig: 0, readFailed: false, ...x });
  it("ships, waits, or counts a try only where the read really gave nothing", () => {
    expect(o({ rows: 3, opened: 1, waiting: 2 })).toBe("shipped");
    expect(o({ rows: 3, waiting: 2, tooBig: 1 })).toBe("waits");
    expect(o({ rows: 2, tooBig: 2 })).toBe("too big");
    expect(o({ rows: 2 })).toBe("open failed");
    expect(o({ readFailed: true })).toBe("read failed");
    expect(o({})).toBe("nothing new");
  });
});

describe("needsRebuild", () => {
  const r = (videoId: string, t: number) => ({ code: "E", videoId, starts: { Q1: t } });
  const base = { mergeable: "MERGEABLE", want: new Set(["v1|E"]), baseRows: [r("v1", 10), r("v2", 20)], mainRows: [r("v1", 10), r("v2", 25)], changedFiles: ["server/data/frameTimings/2025.ts"], releaseFiles: ["CHANGELOG.md", "package.json", "package-lock.json"] };
  it("leaves a PR alone when main changed none of its rows, it merges cleanly and carries no release: never to renumber", () => {
    expect(needsRebuild(base)).toEqual([]);
  });
  it("rebuilds on a conflict, on its row changed or removed on main, and on a release it still carries", () => {
    expect(needsRebuild({ ...base, mergeable: "CONFLICTING" })).toEqual(["conflict"]);
    expect(needsRebuild({ ...base, mainRows: [r("v1", 11)] })).toEqual(["main changed its rows"]);
    expect(needsRebuild({ ...base, mainRows: [r("v2", 20)] })).toEqual(["main changed its rows"]);
    expect(needsRebuild({ ...base, changedFiles: [...base.changedFiles, "CHANGELOG.md", "package.json"] })).toEqual(["release dropped"]);
  });
  it("a file the merge base didn't have: a row main has since gained is main's change", () => {
    expect(needsRebuild({ ...base, baseRows: [], mainRows: [] })).toEqual([]);
    expect(needsRebuild({ ...base, baseRows: [], mainRows: [r("v1", 10)] })).toEqual(["main changed its rows"]);
  });
});

describe("askDue", () => {
  const head = "abcdef1234567890";
  it("asks once a head, again only after a day, never once Loopy's summary names the head", () => {
    expect(askDue(undefined, head, null, NOW)).toBe(true);
    expect(askDue({ head, at: new Date(NOW - ASK_EVERY_MS + 1).toISOString() }, head, null, NOW)).toBe(false);
    expect(askDue({ head, at: new Date(NOW - ASK_EVERY_MS).toISOString() }, head, null, NOW)).toBe(true);
    expect(askDue({ head: "0000000", at: new Date(NOW).toISOString() }, head, "0000000", NOW)).toBe(true);
    expect(askDue(undefined, head, "abcdef1", NOW)).toBe(false);
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
