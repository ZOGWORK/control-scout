// The questions with video tried for an answer (./videoSuggest.ts videoCandidates): the events with clips nearest
// the answer's own, each nearby season at most half the turns, so the season before gets tried too.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { CURRENT_SEASON } from "../../data/seasons";
import type { SearchAnswer } from "../../../src/shared/api";

const S = CURRENT_SEASON;
// Six events with clips this season, three the season before, all near the answer's own.
const THIS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((n, i) => [`USNJT${i}`, `${n} Qualifier`] as const);
const LAST = ["Golf", "Hotel", "India"].map((n, i) => [`USNJL${i}`, `${n} Qualifier`] as const);
vi.mock("../../videos/recordings", async (orig) => ({
  ...(await orig<typeof import("../../videos/recordings")>()),
  seasonVideoKinds: async (season: number) => new Map((season === S ? THIS : season === S - 1 ? LAST : []).map(([code]) => [code, "clips" as const])),
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
});
