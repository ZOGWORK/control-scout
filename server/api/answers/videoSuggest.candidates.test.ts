// The questions with video tried for an answer (./videoSuggest.ts videoCandidates): the events with clips nearest
// the answer's own, each nearby season at most half the turns, so the season before gets tried too.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../../db";
import { CURRENT_SEASON } from "../../data/seasons";
import type { SearchAnswer } from "../../../src/shared/api";

const S = CURRENT_SEASON;
// Six events with clips this season, three the season before, all near the answer's own.
const THIS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((n, i) => [`USNJT${i}`, `${n} Qualifier`] as const);
const LAST = ["Golf", "Hotel", "India"].map((n, i) => [`USNJL${i}`, `${n} Qualifier`] as const);
// Events with clips added later (the typo test below), this season's.
const LATER: string[] = [];
vi.mock("../../videos/recordings", async (orig) => ({
  ...(await orig<typeof import("../../videos/recordings")>()),
  seasonVideoKinds: async (season: number) => new Map([...(season === S ? [...THIS.map(([c]) => c), ...LATER] : season === S - 1 ? LAST.map(([c]) => c) : [])].map((code) => [code, "clips" as const])),
}));

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const add = (season: number, code: string, name: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (?, ?, ?, 'Qualifier', 'Edison', 'NJ', 'USA', ?, 'test')", [season, code, name, start]);
  await add(S, "USNJHOME", "Home Qualifier", `${S}-12-01`);
  for (const [code, name] of THIS) await add(S, code, name, `${S}-12-02`);
  for (const [code, name] of LAST) await add(S - 1, code, name, `${S}-01-02`);
});

describe("videoCandidates", () => {
  it("each nearby season gets at most half the turns: last season's events are tried too", async () => {
    const { videoCandidates } = await import("./videoSuggest");
    const a: SearchAnswer = { q: "x", hits: [], pages: [], step: "deterministic", weak: false,
      stat: { family: "event", intent: "results", title: "x", scope: [], headline: { value: "1", label: "Q1", href: `/events/${S}/USNJHOME?match=qual:0:1` }, blocks: [], definition: "", source: "" } };
    const cs = await videoCandidates(a, Date.now(), async () => new Set());
    const season = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    expect(cs.filter((c) => c.endsWith(season(S)))).toHaveLength(4);
    expect(cs.filter((c) => c.endsWith(season(S - 1)))).toEqual(LAST.map(([, n]) => `${n} highlights ${season(S - 1)}`));
  });

  it("the background set reads the typos built for the data as it is, never the last version's", async () => {
    const { forgetVideoQuestions, warmVideoQuestions, withVideoAlternatives } = await import("./videoSuggest");
    const { nameTypos } = await import("./nameTypos");
    await kvSet("search:version", "v1");
    await nameTypos();
    // The data moves: an event whose stored name has a typo (beside four that spell it in full), the latest with clips.
    for (const [i, place] of ["Arlington", "Waverly", "Denver", "Mall"].entries()) {
      await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (?, ?, ?, 'Qualifier', 'Waterloo', 'IA', 'USA', ?, 'test')", [S, `USIAW${i}`, `Winterberry ${place}`, `${S}-11-01`]);
    }
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (?, 'USIAWX', 'Wnterberry Waterloo', 'Qualifier', 'Waterloo', 'IA', 'USA', ?, 'test')", [S, `${S + 1}-03-01`]);
    LATER.push("USIAWX");
    await kvSet("search:version", "v2");
    forgetVideoQuestions(true);
    const plays = { main: { videoId: "v", t: 0, kind: "match" as const, match: "Q1" } };
    const said = (q: string): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, stat: { family: "event", intent: "results", title: q, scope: [], blocks: [], definition: "", source: "" } });
    await warmVideoQuestions({ ask: async (q) => said(q), video: async () => plays });
    const out = await withVideoAlternatives("6980 at east bergen with video", { ...said("x"), stat: { ...said("x").stat!, none: "None" } }, undefined, async (q) => said(q), async () => undefined, 1000, async () => [], "", 0);
    const offered = out.stat?.blocks.find((b) => b.kind === "related");
    const qs = offered && offered.kind === "related" ? offered.queries : [];
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.some((q) => /wnterberry/i.test(q))).toBe(false);
    forgetVideoQuestions(true);
  });

  it("typos built for another version: nothing chosen with them is published, the questions in use stay", async () => {
    const { forgetVideoQuestions, warmVideoQuestions, withVideoAlternatives } = await import("./videoSuggest");
    forgetVideoQuestions(true);
    const said = (q: string): SearchAnswer => ({ q, hits: [], pages: [], step: "deterministic", weak: false, stat: { family: "event", intent: "results", title: q, scope: [], blocks: [], definition: "", source: "" } });
    const plays = { main: { videoId: "v", t: 0, kind: "match" as const, match: "Q1" } };
    // In use: the one general question that plays.
    await warmVideoQuestions({ ask: async (q) => said(q), video: async (b) => (b.q === "highest score with video" ? plays : undefined) });
    // The search version read is one the typos are never built for: every question would play, none is published.
    await warmVideoQuestions({ ask: async (q) => said(q), video: async () => plays, version: async () => "v-other" });
    const none = { ...said("x"), stat: { ...said("x").stat!, none: "None" } };
    const out = await withVideoAlternatives("6980 at east bergen with video", none, undefined, async (q) => said(q), async () => undefined, 1000, async () => [], "", 0);
    const offered = out.stat?.blocks.find((b) => b.kind === "related");
    expect(offered && offered.kind === "related" ? offered.queries : []).toEqual(["highest score with video"]);
    forgetVideoQuestions(true);
  });
});
