// Search's answer chain on a small fixture database (docs/search.md): the fixed rules, the learning model's
// guarantees, the intents and their aggregate counts, and what search never reads. The same chain on the real data
// is scripts/search-experiment/acceptance.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "../db";
import { invalidateFlags, setFlag } from "../flags";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { cleanQuery, searchAnswer } from "./searchAnswer";
import { LAST_SEASON_WEIGHT, MIN_CLICKS, recordClick, rerank } from "./searchLearn";
import { recordIntent, topIntents } from "./searchIntents";
import { BRUNO_TIMEOUT_MS, refine, resetBrunoCache } from "./searchBruno";
import { hitHref } from "../../src/shared/search";
import type { SearchHit } from "../../src/shared/api";

const S = CURRENT_SEASON;
const team = (ref: string, title: string): SearchHit => ({ kind: "team", ref, title: `${ref} ${title}`, subtitle: "", season: S });
const order = (hs: SearchHit[]) => hs.map((h) => h.ref);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string][] = [[4215, "Hypnotic Robotics"], [6980, "Bad Wolf"], [10820, "Cyber Dragons"], [111, "Gear Grinders"], [222, "Gear Heads"], [333, "Gear Force"], [30001, "Nova Gears"]];
  for (const [n, name] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Oradell', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  await run("INSERT INTO events (season, code, name, city, state, country, start, source) VALUES (?, 'USNJQ1', 'Bergen Qualifier', 'Oradell', 'NJ', 'USA', '2026-11-01', 'test')", [S]);
  // Played: a near match to a team that never played is a closest match, not a result. 30001 is new: no matches yet.
  for (const n of [4215, 6980, 10820, 111, 222, 333]) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'USNJQ1', ?, 50, 5)", [S, n]);
  // Private data search must never read: a Scout space's name.
  await run("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES ('ws-z', 'Zebrasecret Scouts', ?, ?)", [new Date().toISOString(), new Date().toISOString()]);
  await rebuildSearch();
});
beforeEach(async () => {
  await run("DELETE FROM search_clicks");
  await run("DELETE FROM search_intents");
  await run("DELETE FROM feature_flags");
  invalidateFlags();
});

describe("the fixed rules", () => {
  it("a team number is that team alone; one with no team is the recovery state", async () => {
    for (const q of ["4215", "team 4215", "team-4215", "#4215", "4215!"]) {
      const a = await searchAnswer(q);
      expect(a.step, q).toBe("deterministic");
      expect(order(a.hits), q).toEqual(["4215"]);
    }
    const none = await searchAnswer("98765");
    expect(none).toMatchObject({ step: "recovery", hits: [] });
    expect(none.recovery!.browse.map((b) => b.href)).toEqual(["/teams", "/events"]);
  });
  it("versus opens Compare in number order, up to four, and never a half-empty one", async () => {
    expect(hitHref((await searchAnswer("bad wolf vs hypnotic")).hits[0])).toBe("/compare?teams=4215,6980");
    expect(hitHref((await searchAnswer("hypnotic versus bad wolf versus cyber dragons")).hits[0])).toBe("/compare?teams=4215,6980,10820");
    const half = await searchAnswer("hypnotic vs qqqzzz");
    expect(half.step).toBe("recovery");
    expect(order(half.recovery!.closest)).toEqual(["4215"]);
  });
  it("pages only for whole words, below the results", async () => {
    expect((await searchAnswer("records")).pages.map((p) => p.href)).toEqual(["/teams", "/matches"]);
    expect((await searchAnswer("rec")).pages).toEqual([]);
  });
  it("nothing typed, punctuation, and over-long queries", async () => {
    expect((await searchAnswer("   ")).step).toBe("recovery");
    expect(cleanQuery("  HYPnotic,  ")).toBe("HYPnotic");
    expect(cleanQuery("x".repeat(200))).toHaveLength(80);
    expect(order((await searchAnswer("4215 OR 1=1")).hits)).toContain("4215");
  });
});

describe("learning (T30–T35, T65, T67–T69)", () => {
  const hits = [team("111", "Gear Grinders"), team("222", "Gear Heads"), team("333", "Gear Force")];
  it("cold start and switched off: exactly the deterministic order", async () => {
    expect(order(await rerank("gear", hits))).toEqual(["111", "222", "333"]);
    for (let i = 0; i < 10; i++) await recordClick("gear", hits[2]);
    await setFlag("searchLearning", false, "test");
    invalidateFlags();
    expect(order(await rerank("gear", hits))).toEqual(["111", "222", "333"]);
  });
  it("seeded clicks move a result up; one misclick doesn't", async () => {
    await recordClick("gear", hits[2]);
    expect(order(await rerank("gear", hits))).toEqual(["111", "222", "333"]);
    for (let i = 1; i < MIN_CLICKS; i++) await recordClick("gear", hits[2]);
    expect(order(await rerank("gear", hits))[0]).toBe("333");
  });
  it("last season counts a quarter, older seasons not at all: a new season's choices dominate", async () => {
    for (let i = 0; i < 12; i++) await recordClick("gear", hits[1], S - 1);
    for (let i = 0; i < 40; i++) await recordClick("gear", hits[2], S - 2);
    for (let i = 0; i < 4; i++) await recordClick("gear", hits[0], S);
    // 111: 4 now; 222: 12 × 0.25 = 3 now; 333: two seasons back, nothing.
    expect(LAST_SEASON_WEIGHT).toBe(0.25);
    expect(order(await rerank("gear", hits))).toEqual(["111", "222", "333"]);
    for (let i = 0; i < 10; i++) await recordClick("gear", hits[2], S);
    expect(order(await rerank("gear", hits))[0]).toBe("333");
  });
  it("an exact match keeps the top: a new team is still found by its name", async () => {
    const a = await searchAnswer("nova gears");
    expect(a.hits[0].ref).toBe("30001");
    for (let i = 0; i < 50; i++) await recordClick("nova gears", team("111", "Gear Grinders"));
    expect((await searchAnswer("nova gears")).hits[0].ref).toBe("30001");
  });
  it("only re-orders: it never adds a result", async () => {
    for (let i = 0; i < 20; i++) await recordClick("gear", team("4215", "Hypnotic Robotics"));
    expect(order(await rerank("gear", hits)).sort()).toEqual(["111", "222", "333"]);
  });
  it("aggregate only: counts by term and result, nothing about who; no network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await recordClick("gear", hits[0]);
    await searchAnswer("gear");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const cols = (await all<{ name: string }>("PRAGMA table_info(search_clicks)")).map((c) => c.name);
    expect(cols).toEqual(["season", "term", "kind", "ref", "clicks"]);
  });
});

describe("intents and their counts (T71–T75)", () => {
  it("a missing view: the closest real result and a plain note; nothing understood: the recovery state", async () => {
    const r = await searchAnswer("hypnotic versus bad wolf reputation");
    expect(r).toMatchObject({ step: "closest", intent: { kind: "compare-reputation", pattern: "[team] vs [team] reputation", met: false } });
    expect(hitHref(r.hits[0])).toBe("/compare?teams=4215,6980");
    expect(JSON.stringify(r.hits)).not.toMatch(/reputation/i);
    const specs = await searchAnswer("cyber dragons robot specs");
    expect(specs).toMatchObject({ step: "closest", intent: { gap: "Robot specs (drivetrain, weight, design) aren't tracked yet." } });
    expect(specs.hits[0]).toMatchObject({ ref: "10820" });
    expect(specs.hits[0].facts).toBeUndefined();
    expect((await searchAnswer("qqzzxx wwvvb")).intent).toBeUndefined();
  });
  it("season and region words are read, a game name only as a season", async () => {
    const a = await searchAnswer("hypnotic in new jersey");
    expect(a.intent).toMatchObject({ kind: "region", met: true });
    expect(a.hits[0].ref).toBe("4215");
    expect((await searchAnswer("hypnotic rankings last season in new jersey")).intent?.kind).toBe("season-region-ranking");
  });
  it("counts repeat; no query text, no one", async () => {
    const a = await searchAnswer("hypnotic robot specs");
    await recordIntent(a.intent);
    await recordIntent(a.intent);
    await recordIntent((await searchAnswer("bad wolf robot specs")).intent);
    expect(await topIntents()).toEqual([{ kind: "robot-specs", pattern: "[team] robot specs", met: false, count: 3, lastSeen: new Date().toISOString().slice(0, 10) }]);
    expect((await all<{ name: string }>("PRAGMA table_info(search_intents)")).map((c) => c.name)).toEqual(["kind", "pattern", "met", "count", "last_seen"]);
    expect(await get("SELECT 1 FROM search_intents WHERE pattern LIKE '%hypnotic%' OR pattern LIKE '%wolf%'")).toBeFalsy();
  });
});

describe("review fixes", () => {
  it("a season named in words opens Compare on it", async () => {
    expect(hitHref((await searchAnswer("hypnotic versus bad wolf reputation last season")).hits[0])).toBe(`/compare?teams=4215,6980&season=${S - 1}`);
    expect(hitHref((await searchAnswer(`hypnotic vs bad wolf ${S - 1}-${String(S % 100).padStart(2, "0")}`)).hits[0])).toBe(`/compare?teams=4215,6980&season=${S - 1}`);
  });
  it("a team numbered like a year stays a team in versus", async () => {
    await run("INSERT OR IGNORE INTO teams (number, name) VALUES (2024, 'Year Bots')");
    await rebuildSearch();
    expect(hitHref((await searchAnswer("2024 vs 4215")).hits[0])).toBe("/compare?teams=2024,4215");
  });
  it("a team with a season named in words opens on that season", async () => {
    const a = await searchAnswer("hypnotic last season");
    expect(a.hits[0]).toMatchObject({ ref: "4215", linkSeason: S - 1 });
    expect(a.hits[0].subtitle.match(/–/g)).toHaveLength(1); // the season named once
  });
  it("picks are learned under the key the ranking reads", async () => {
    const { learnQuery } = await import("./searchAnswer");
    expect(learnQuery("champs")).toBe(learnQuery("championship"));
    expect(learnQuery("gear last season")).toBe(learnQuery("gear"));
  });
  it("schedule difficulty switched off: no link to a section that shows nothing", async () => {
    expect(hitHref((await searchAnswer("hypnotic difficulty")).hits[0])).toContain("#schedule-difficulty");
    await setFlag("scheduleDifficulty", false, "test");
    invalidateFlags();
    expect(hitHref((await searchAnswer("hypnotic difficulty")).hits[0])).not.toContain("#schedule-difficulty");
  });
});

describe("what search never reads (T63, T64)", () => {
  it("a Scout space's name is never a result", async () => {
    const a = await searchAnswer("zebrasecret");
    expect(a.step).toBe("recovery");
    expect(JSON.stringify(a)).not.toMatch(/Zebrasecret Scouts/);
  });
});

describe("Bruno's step (T26–T29, T66)", () => {
  let fake: Server;
  let mode: "ok" | "slow" | "error" = "ok";
  let calls = 0;
  beforeAll(async () => {
    fake = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls++;
        const q = String(JSON.parse(body).query).toLowerCase();
        const send = () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ query: q === "robots that hypnotise" ? "hypnotic robotics" : q === "made up stuff opr" ? "zzqq opr" : null }));
        if (mode === "error") res.writeHead(500).end("{}");
        else if (mode === "slow") setTimeout(send, BRUNO_TIMEOUT_MS + 1000);
        else send();
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
    process.env.CONTROL_POINT_INTERNAL_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    process.env.CONTROL_POINT_INTERNAL_KEY = "test";
  });
  afterAll(() => { fake.close(); delete process.env.CONTROL_POINT_INTERNAL_URL; delete process.env.CONTROL_POINT_INTERNAL_KEY; });
  beforeEach(() => { mode = "ok"; calls = 0; resetBrunoCache(); });

  it("off by default: never asked", async () => {
    expect(await refine("robots that hypnotise")).toBeNull();
    expect(calls).toBe(0);
  });
  it("on: his reading re-runs search, and every number is search's own", async () => {
    await setFlag("brunoSearch", true, "test");
    invalidateFlags();
    const r = await refine("robots that hypnotise");
    expect(r).toMatchObject({ step: "ai", refined: "hypnotic robotics" });
    expect(r!.hits[0]).toEqual((await searchAnswer("hypnotic robotics")).hits[0]);
    // His words finding nothing: the recovery state, his reading named, nothing made up.
    const none = await refine("made up stuff opr");
    expect(none).toMatchObject({ step: "recovery", hits: [], recovery: { ai: { refined: "zzqq opr" } } });
    // Search never waits on him: the answer itself never calls.
    calls = 0;
    await searchAnswer("robots that hypnotise");
    expect(calls).toBe(0);
  });
  it("slow or failing: nothing added, within the timeout", async () => {
    await setFlag("brunoSearch", true, "test");
    invalidateFlags();
    for (const m of ["slow", "error"] as const) {
      mode = m; resetBrunoCache();
      const t0 = Date.now();
      expect(await refine("robots that hypnotise")).toBeNull();
      expect(Date.now() - t0).toBeLessThan(BRUNO_TIMEOUT_MS + 1500);
    }
  }, 15_000);
});
