// The clip autopilot's choices (scripts/lib/autopilotRun.ts): which queued events a run reads, when one that gave
// nothing new is tried again, and what a delivery's rows change.
import { describe, expect, it } from "vitest";
import { GIVE_UP, RETRY_MS, TIMEOUTS_TO_TRY, WAIT_MS, forgetSettled, LANE_KICK_MS, READ_CALL_MS, laneJobMs, readCallMs, laneResults, laneStep, overLimit, nothingRead, parseLanes, parseShard, parseSkip, pickEvents, readOutcome, remember, rememberTimeout, rememberWait, rowsDelta, shardOf, waitBackoff, type Memory, type Queued, frameFileSeason, heldElsewhere, holdCodes } from "./autopilotRun";
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

describe("what a delivery changes", () => {
  const live = new Map<string, Row>([["v1|AAQ", { videoId: "v1", code: "AAQ", checked: "2026-11-15", starts: { Q1: 600 } }]]);
  const rows: Row[] = [
    { videoId: "v1", code: "AAQ", checked: "2026-11-17", starts: { Q1: 600, Q2: 1000 }, opens: { Q1: 588, Q2: 995 }, missing: { Q3: "its frames didn't confirm a start" } },
    { videoId: "v2", code: "BBQ", checked: "2026-11-17", starts: {}, missing: { Q1: "no frame read of it, and no agreeing reads on both sides" } },
  ];

  it("counts the clips it adds and the matches it gives a reason", () => {
    expect(rowsDelta(rows, live)).toEqual({ clips: 1, recordings: 2, events: ["AAQ", "BBQ"], reasons: 2 });
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
});

describe("lanes: computers with no credentials, each reading a shard for the one that has them", () => {
  it("reads --lanes K=user@host,… and refuses a shard that's this computer's, out of range, or given twice", () => {
    const shard = { k: 0, n: 3 };
    expect(parseLanes(undefined, shard)).toEqual([]);
    expect(parseLanes("1=lexie@100.77.36.51, 2=derek@100.64.169.42", shard)).toEqual([{ k: 1, host: "lexie@100.77.36.51" }, { k: 2, host: "derek@100.64.169.42" }]);
    for (const bad of ["0=a@b", "3=a@b", "1=a@b,1=c@d", "1=lexie", "x=a@b", "1=a@b;rm -rf ~"]) expect(typeof parseLanes(bad, shard)).toBe("string");
  });
  const job = { id: "2026-11-18T10-00-00", seasons: [{ season: 2024, codes: ["USMIAVLT", "USTXWYQ"] }] };
  const st = (o: object) => JSON.stringify(o);
  it("collects the job it sent when done or failed, waits on one running, starts again one queued too long, sends to an idle lane", () => {
    const at = new Date(NOW).toISOString(), id = job.id;
    expect(laneStep("", null).do).toBe("dispatch");
    expect(laneStep(st({ state: "idle" }), job).do).toBe("dispatch");
    expect(laneStep(st({ state: "done", id, at }), job)).toEqual({ do: "collect", state: { state: "done", id, at } });
    expect(laneStep(st({ state: "failed", id, at, why: "exit 3" }), job).do).toBe("collect");
    expect(laneStep(st({ state: "running", id, at }), job, NOW + 10 * 3600_000).do).toBe("wait");
    expect(laneStep(st({ state: "queued", id, at }), job, NOW + LANE_KICK_MS).do).toBe("wait");
    expect(laneStep(st({ state: "queued", id, at }), job, NOW + LANE_KICK_MS + 1).do).toBe("kick");
  });
  it("trusts nothing the lane writes: a state naming no job it was sent is reset, a strange id or file waited on", () => {
    const at = new Date(NOW).toISOString();
    // Done or queued for another job (one collected already, or never sent): set idle, its results never read.
    for (const state of ["done", "failed", "queued"]) {
      expect(laneStep(st({ state, id: "2026-11-17T01-00-00", at }), job).do).toBe("reset");
      expect(laneStep(st({ state, id: job.id, at }), null).do).toBe("reset");
    }
    // An id that could reach a path or a command: never used.
    for (const id of ["../../.ssh", "x; rm -rf ~", "a b", "", 5]) expect(laneStep(st({ state: "done", id, at }), { ...job, id: String(id) }).do).toBe("wait");
    expect(laneStep("{oops", job).do).toBe("wait");
    expect(laneStep("[1]", job).do).toBe("wait");
  });
  it("a lane still running past every read's limits was killed: what it finished is collected", () => {
    const at = new Date(NOW).toISOString();
    // One season of 2 events, lengths unknown: two day-long reads, 6 h of checks, an hour.
    expect(laneJobMs(job)).toBe(55 * 3600_000);
    // Long events (27 h each): each read call covers both and an hour, so a long read is never called killed.
    expect(laneJobMs(job, () => 27 * 3600_000)).toBe((2 * 55 + 6 + 1) * 3600_000);
    expect(laneStep(st({ state: "running", id: job.id, at }), job, NOW + laneJobMs(job)).do).toBe("wait");
    const late = laneStep(st({ state: "running", id: job.id, at }), job, NOW + laneJobMs(job) + 1);
    expect(late.do).toBe("collect");
    expect(late.state.state).toBe("failed");
    // Running some other job (not this computer's): waited on, never collected.
    expect(laneStep(st({ state: "running", id: "2026-11-17T01-00-00", at }), job, NOW + 100 * 3600_000).do).toBe("wait");
  });
  it("keeps a lane's results to the job: its seasons, its codes, rows of them; a missing or broken file is a failed read", () => {
    const row = (code: string, videoId = "v1") => ({ videoId, code, starts: {} });
    const files = [
      { name: "2024.json", text: JSON.stringify({ season: 2024, codes: ["USMIAVLT", "USEVIL"], changed: [row("USMIAVLT"), row("USEVIL"), { code: "USTXWYQ" }, null], readFailed: false, stopped: [["USTXWYQ", "vid9"], ["USEVIL", "x"], ["USMIAVLT", 7]] }) },
      { name: "2019.json", text: JSON.stringify({ season: 2019, codes: ["X"], changed: [row("X")], readFailed: false, stopped: [] }) },
    ];
    const [r] = laneResults(job, files);
    expect(laneResults(job, files)).toHaveLength(1);
    expect(r.season).toBe(2024);
    expect(r.codes).toEqual(["USMIAVLT", "USTXWYQ"]);
    expect(r.changed).toEqual([row("USMIAVLT")]);
    expect(r.readFailed).toBe(false);
    expect([...r.stopped]).toEqual([["USTXWYQ", "vid9"]]);
    for (const text of ["", "{", JSON.stringify({ season: "2024" }), JSON.stringify({ season: 2023 })]) {
      const [x] = laneResults(job, [{ name: "2024.json", text }]);
      expect(x).toEqual({ season: 2024, codes: job.seasons[0].codes, changed: [], readFailed: true, stopped: new Map() });
    }
    expect(laneResults(job, [])[0].readFailed).toBe(true);
    // readFailed only false when the lane says so plainly.
    expect(laneResults(job, [{ name: "2024.json", text: JSON.stringify({ season: 2024, changed: [] }) }])[0].readFailed).toBe(true);
  });
});

describe("readCallMs: a read call's backstop never cuts before its events' own limits", () => {
  const H = 3600_000;
  it("is a day for calls whose events fit in one", () => {
    expect(READ_CALL_MS).toBe(24 * H);
    expect(readCallMs([])).toBe(24 * H);
    expect(readCallMs([3 * H, 5 * H])).toBe(24 * H);
  });
  it("covers the sum of its events' limits and an hour more: an event with 27 h of video gets 28 h", () => {
    expect(readCallMs([27 * H])).toBe(28 * H);
    expect(readCallMs([27 * H, 20.5 * H, 3 * H])).toBe(51.5 * H);
    expect(readCallMs([NaN, -1, 30 * H])).toBe(31 * H);
  });
});

describe("heldElsewhere: events other open PRs carry frame-read rows for", () => {
  // #1829's patch to 2021.ts (the 2019–2022 session's PR), as GitHub's pulls/N/files gives it: rows cut short here.
  const patch1829 = [
    '@@ -6,4 +6,14 @@ import type { FrameTiming } from "../frameTimings.js";',
    " // --- Data (scripts/video-frames.ts writes from here on) ---",
    " export const ROWS: FrameTiming[] = [",
    " ",
    '+  {"videoId":"bSt7xUNsbUQ","code":"USCHSCMPCARR","checked":"2026-11-17","starts":{"Q1":834,"Q2":1265}},',
    '+  {"videoId":"8tJSxyVZmwg","code":"USCHSCMPSUBS","checked":"2026-11-17","starts":{"Q8":76,"Q9":406}},',
  ].join("\n");
  it("holds each code a PR adds rows for, in the season its file names", () => {
    const { held, unread } = heldElsewhere([{ number: 1829, files: [{ filename: "server/data/frameTimings/2021.ts", patch: patch1829 }] }]);
    expect([...held]).toEqual([["2021/USCHSCMPCARR", 1829], ["2021/USCHSCMPSUBS", 1829]]);
    expect(unread).toEqual([]);
  });
  it("takes a re-read's replacement row, never a removed or unchanged line, and keeps the first PR an event is in", () => {
    const reread = ['-  {"videoId":"a","code":"USOLD","checked":"2026-11-15"},', '+  {"videoId":"a","code":"USNEW","checked":"2026-11-18"},', '   {"videoId":"b","code":"USKEPT"},'].join("\n");
    const { held } = heldElsewhere([
      { number: 7, files: [{ filename: "server/data/frameTimings/2024.ts", patch: reread }] },
      { number: 8, files: [{ filename: "server/data/frameTimings/2024.ts", patch: '+  {"videoId":"c","code":"USNEW"},' }] },
    ]);
    expect([...held]).toEqual([["2024/USNEW", 7]]);
  });
  it("holds nothing from other files or a clip-check sweep", () => {
    const { held, unread } = heldElsewhere([{ number: 9, files: [
      { filename: "server/data/clipChecks.ts", patch: '+  { season: 2025, code: "USOKTUS", videoId: "x" },' },
      { filename: "CHANGELOG.md", patch: '+ "code":"USX"' },
    ] }]);
    expect(held.size).toBe(0);
    expect(unread).toEqual([]);
    expect(frameFileSeason("server/data/frameTimings/2019.ts")).toBe(2019);
    expect(frameFileSeason("server/data/frameTimings.ts")).toBeNull();
  });
  it("names a season's file whose patch GitHub left out, for the caller to read; holdCodes keeps the first PR", () => {
    // A 1,500-row bundle's patch is past what GitHub shows: its file comes with no patch.
    const { held, unread } = heldElsewhere([{ number: 11, files: [{ filename: "server/data/frameTimings/2025.ts" }] }]);
    expect(held.size).toBe(0);
    expect(unread).toEqual([{ number: 11, filename: "server/data/frameTimings/2025.ts" }]);
    const h = new Map([["2025/USA", 3]]);
    holdCodes(h, 2025, ["USA", "USB"], 11);
    expect([...h]).toEqual([["2025/USA", 3], ["2025/USB", 11]]);
  });
});

describe("parseSkip", () => {
  it("reads one season/code a line, with comments, blank lines and junk left out", () => {
    const text = "# 2025 A-M session, reading 2026\r\n2026/USIACFN\n  2026/uspaksn   # N-Z session\n\nUSIACONEM1\n2026/US IA\nnot a line\n";
    expect([...parseSkip(text)]).toEqual(["2026/USIACFN", "2026/USPAKSN"]);
    expect(parseSkip("").size).toBe(0);
  });
});

describe("nothingRead", () => {
  const N = "no frame of the video could be read";
  it("is a video the player showed nothing of: no start, every match missing for that reason", () => {
    // 2026-11-21 #2052: USCALACAS2 KPBst56_Nxs, all 17 "no frame of the video could be read", while the video plays.
    expect(nothingRead({ starts: {}, missing: { Q1: N, Q2: N, Q17: N } })).toBe(true);
  });
  it("isn't one with a start, another reason, or nothing missing", () => {
    expect(nothingRead({ starts: { Q3: 900 }, missing: { Q1: N, Q2: N } })).toBe(false);
    expect(nothingRead({ starts: {}, missing: { Q1: N, Q2: "its frames didn't confirm a start" } })).toBe(false);
    expect(nothingRead({ starts: {}, missing: {} })).toBe(false);
    expect(nothingRead({ starts: {} })).toBe(false);
  });
  it("is also a video that couldn't be played at all (closed #1962, FRCMP: every match \"the video couldn't be played: ...\")", () => {
    const P = "the video couldn't be played: its player showed an error";
    expect(nothingRead({ starts: {}, missing: { Q1: P, Q2: P } })).toBe(true);
    expect(nothingRead({ starts: {}, missing: { Q1: P, Q2: N } })).toBe(true);
    expect(nothingRead({ starts: {}, missing: { Q1: P, Q2: "its frames didn't confirm a start" } })).toBe(false);
  });
  it("makes its event a failed read: not shipped, not counted as tried", () => {
    expect(readOutcome({ rows: 0, opened: 0, waiting: 0, tooBig: 0, readFailed: true, changed: 1 })).toBe("read failed");
  });
});
