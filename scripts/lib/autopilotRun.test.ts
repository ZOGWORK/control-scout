// The clip autopilot's choices (scripts/lib/autopilotRun.ts): which queued events a run reads, when one that gave
// nothing new is tried again, and what its data PR's CHANGELOG entry says.
import { describe, expect, it } from "vitest";
import { nextRelease, parseChangelog } from "../../src/lib/changelog";
import { ASK_EVERY_MS, GIVE_UP, RETRY_MS, TIMEOUTS_TO_TRY, WAIT_MS, askDue, changelogEntry, forgetSettled, needsRebuild, nextVersion, LANE_KICK_MS, laneStep, overLimit, parseLanes, parseShard, pickEvents, prShard, readOutcome, remember, rememberTimeout, rememberWait, rowsDelta, shardOf, waitBackoff, type Memory, type Queued } from "./autopilotRun";
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

describe("events the reader stops at its per-event limit", () => {
  it("reads which events were stopped, and on which video, from the reader's stderr", () => {
    const err = [
      "09:12:03 USMIAVLT CraHqQLvMrw: 68 matches",
      "USMIAVLT: over its 180 min limit with video CraHqQLvMrw unfinished: stopped part way, the videos it finished kept, the rest read on the next run",
      "ROBUQ2: over its 180 min limit: stopped part way, the videos it finished kept, the rest read on the next run",
      "USTXQ: the database read failed (not read)",
      "1 events stopped at their 180 min limit (their finished videos written)",
    ].join("\n");
    expect([...overLimit(err)]).toEqual([["USMIAVLT", "CraHqQLvMrw"], ["ROBUQ2", undefined]]);
    expect(overLimit("").size).toBe(0);
  });

  it("a stop with no new row is a timeout; one that wrote rows is progress, as any read that shipped or waited", () => {
    const o = (x: Partial<Parameters<typeof readOutcome>[0]>) => readOutcome({ rows: 0, opened: 0, waiting: 0, tooBig: 0, readFailed: true, ...x });
    expect(o({ timedOut: true, changed: 0 })).toBe("timed out");
    expect(o({ timedOut: true, changed: 3, rows: 3, opened: 3 })).toBe("shipped");
    expect(o({ timedOut: true, changed: 2, rows: 2, waiting: 2 })).toBe("waits");
    // Rows written but all refused: progress all the same (not a timeout), and not counted as a try (the read failed).
    expect(o({ timedOut: true, changed: 2 })).toBe("read failed");
  });

  it("one that never gets past the limit isn't read every run forever: the second stop in a row with nothing new counts a try", () => {
    const m: Memory = {};
    // First stop: read again after WAIT_MS, its tries untouched.
    expect(rememberTimeout(m, "2024/USX", "vid1", NOW)).toBe("again");
    expect(m["2024/USX"]).toEqual({ tries: 0, last: new Date(NOW).toISOString(), result: "stopped at the per-event limit on video vid1", timeouts: 1, video: "vid1" });
    expect(pickEvents([q("USX", 1)].map((x) => ({ ...x, season: 2024 })), new Set(), m, 5, NOW + WAIT_MS - 1).skipped[0].why).toMatch(/^stopped at the reader's per-event limit with nothing new/);
    expect(pickEvents([q("USX", 1)].map((x) => ({ ...x, season: 2024 })), new Set(), m, 5, NOW + WAIT_MS).picked).toHaveLength(1);
    // Second in a row: a try, and the usual RETRY_MS from there.
    expect(TIMEOUTS_TO_TRY).toBe(2);
    expect(rememberTimeout(m, "2024/USX", "vid1", NOW + WAIT_MS)).toBe("counted");
    expect(m["2024/USX"]).toEqual({ tries: 1, last: new Date(NOW + WAIT_MS).toISOString(), result: "stopped at the per-event limit on video vid1, 2 runs in a row with nothing new" });
    expect(pickEvents([q("USX", 1)].map((x) => ({ ...x, season: 2024 })), new Set(), m, 5, NOW + WAIT_MS + RETRY_MS - 1).picked).toEqual([]);
    // Every two stops count one try: after GIVE_UP tries it's left for the owner, never read every run.
    for (let i = 0; i < 2 * (GIVE_UP - 1); i++) rememberTimeout(m, "2024/USX", "vid1", NOW);
    expect(m["2024/USX"].tries).toBe(GIVE_UP);
    expect(pickEvents([q("USX", 1)].map((x) => ({ ...x, season: 2024 })), new Set(), m, 5, NOW + 10 * RETRY_MS).skipped[0].why).toMatch(/^read 3 times with nothing new/);
  });

  it("progress between stops starts the streak again", () => {
    const m: Memory = {};
    rememberTimeout(m, "2024/USX", "vid1", NOW);
    remember(m, "2024/USX", 4, "shipped", NOW);
    expect(m["2024/USX"]).toBeUndefined();
    expect(rememberTimeout(m, "2024/USX", "vid2", NOW)).toBe("again");
    rememberWait(m, "2024/USX", "rows wait", NOW);
    expect(m["2024/USX"].timeouts).toBeUndefined();
    expect(rememberTimeout(m, "2024/USX", undefined, NOW)).toBe("again");
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

describe("shards: several computers, each its own part of the queue", () => {
  const keys = Array.from({ length: 600 }, (_, i) => `${2019 + (i % 7)}/US${i}X`);
  it("puts every event in exactly one shard, the same on every run, and spreads them", () => {
    const counts = [0, 0, 0];
    for (const k of keys) { const s = shardOf(k, 3); expect(s).toBe(shardOf(k, 3)); counts[s]++; }
    expect(counts.reduce((a, b) => a + b)).toBe(600);
    for (const c of counts) expect(c).toBeGreaterThan(150);
    // The same code in two seasons is two events: each has its own shard, by its own key.
    expect(shardOf("2022/ROBUQ1", 3)).toBe(shardOf("2022/ROBUQ1", 3));
    expect(keys.every((k) => shardOf(k, 1) === 0)).toBe(true);
  });
  it("reads --shard K/N, every event without it, and refuses anything else", () => {
    expect(parseShard(undefined)).toEqual({ k: 0, n: 1 });
    expect(parseShard("2/3")).toEqual({ k: 2, n: 3 });
    for (const bad of ["3/3", "1/0", "-1/3", "a/3", "1", "1/3/5", ""]) expect(parseShard(bad)).toBeNull();
  });
  it("a PR is kept by the shard that opened it (its first event's), a sweep PR by shard 0", () => {
    const pr = { season: 2024, rows: ["vidB|USTXB", "vidA|USMIA"] };
    expect(prShard(pr, 3)).toBe(shardOf("2024/USMIA", 3));
    expect(prShard({ ...pr, file: "server/data/clipChecks.ts" }, 3)).toBe(0);
    expect(prShard({ season: 2024, rows: [] }, 3)).toBe(0);
    // A PR one shard opened holds only its events, so whichever row is first, it's that shard's.
    const codes = Array.from({ length: 60 }, (_, i) => `US${i}Y`).filter((c) => shardOf(`2024/${c}`, 3) === 1).slice(0, 3);
    expect(codes).toHaveLength(3);
    for (const order of [codes, [...codes].reverse()]) expect(prShard({ season: 2024, rows: order.map((c) => `v${c}|${c}`) }, 3)).toBe(1);
  });
});

describe("lanes: computers with no credentials, each reading a shard for the one that has them", () => {
  it("reads --lanes K=user@host,… and refuses a shard that's this computer's, out of range, or given twice", () => {
    const shard = { k: 0, n: 3 };
    expect(parseLanes(undefined, shard)).toEqual([]);
    expect(parseLanes("1=lexie@100.77.36.51, 2=derek@100.64.169.42", shard)).toEqual([{ k: 1, host: "lexie@100.77.36.51" }, { k: 2, host: "derek@100.64.169.42" }]);
    for (const bad of ["0=a@b", "3=a@b", "1=a@b,1=c@d", "1=lexie", "x=a@b", "1=a@b;rm -rf ~"]) expect(typeof parseLanes(bad, shard)).toBe("string");
  });
  it("collects a finished or failed job, waits on one running, starts again one queued too long, sends one to an idle lane", () => {
    const at = new Date(NOW).toISOString();
    expect(laneStep("").do).toBe("dispatch");
    expect(laneStep('{"state":"idle"}').do).toBe("dispatch");
    expect(laneStep(JSON.stringify({ state: "done", id: "J1", at }))).toEqual({ do: "collect", state: { state: "done", id: "J1", at } });
    expect(laneStep(JSON.stringify({ state: "failed", id: "J1", at, why: "exit 3" })).do).toBe("collect");
    expect(laneStep(JSON.stringify({ state: "running", id: "J1", at }), NOW + 30 * 3600_000).do).toBe("wait");
    expect(laneStep(JSON.stringify({ state: "queued", id: "J1", at }), NOW + LANE_KICK_MS).do).toBe("wait");
    expect(laneStep(JSON.stringify({ state: "queued", id: "J1", at }), NOW + LANE_KICK_MS + 1).do).toBe("kick");
    // A state file that can't be read is waited on (logged), never taken for idle: its job may still be reading.
    expect(laneStep("{oops").do).toBe("wait");
    // Done with no job named: nothing to collect, so idle.
    expect(laneStep('{"state":"done"}').do).toBe("dispatch");
  });
});

