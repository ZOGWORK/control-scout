// An event split in divisions, as search lists it (server/api/searchEvents.ts, src/shared/search.ts firstCards): each
// division carries its event's code, the page's cut counts an event and its divisions as one card, so a championship
// held every season is listed whole, and the year a query names ("first championship in 2025") is the one held then.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { withEventParents } from "./searchEvents";
import { SEARCH_PAGE_LIMIT, familyKey } from "../../src/shared/search";

const S = CURRENT_SEASON;
const now = Date.parse("2026-11-02T12:00:00Z");
const ask = (q: string, limit = SEARCH_PAGE_LIMIT) => searchAnswer(q, { now, limit, learn: false });
const events = (a: Awaited<ReturnType<typeof ask>>) => a.hits.filter((h) => h.kind === "event");
// Ten seasons of a championship, each its finals and three divisions (40 events), and a state's with two.
const SEASONS = Array.from({ length: 10 }, (_, i) => S - 1 - i);
const DIVS = ["Alpha", "Bravo", "Charlie"];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const add = (season: number, code: string, name: string, type: string, start: string, parent: string | null) =>
    run("INSERT INTO events (season, code, name, type, division_code, venue, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Hall', 'Houston', 'TX', 'USA', ?, ?, 'test')", [season, code, name, type, parent, start, start]);
  for (const s of SEASONS) {
    const start = `${s + 1}-04-20`;
    await add(s, "WCMP", "World Championship", "FIRSTChampionship", start, null);
    for (const d of DIVS) await add(s, `WCMP${d.slice(0, 2).toUpperCase()}`, `World Championship - ${d} Division`, "FIRSTChampionship", start, "WCMP");
  }
  await add(S - 1, "USXXCMP", "Xland Championship", "Championship", `${S}-03-01`, null);
  for (const d of ["East", "West"]) await add(S - 1, `USXXCMP${d[0]}`, `Xland Championship - ${d} Division`, "Championship", `${S}-03-01`, "USXXCMP");
  await rebuildSearch();
});

describe("an event split in divisions", () => {
  it("each division names its event; the event itself names none", async () => {
    const a = await ask(`worlds ${S}`);
    const hits = events(a);
    expect(hits.find((h) => h.ref === `${S - 1}:WCMP`)?.parent).toBeUndefined();
    expect(hits.filter((h) => h.parent === "WCMP").map((h) => h.ref.split(":")[1]).sort()).toEqual(["WCMPAL", "WCMPBR", "WCMPCH"]);
  });

  it("every season of it is listed whole: 40 events on 10 cards, under the page's 25, so the heading says no cut", async () => {
    const a = await ask("first championship");
    expect(events(a)).toHaveLength(40);
    expect(new Set(events(a).map(familyKey)).size).toBe(10);
    expect(a.understood).toMatchObject({ total: 40, scope: { subject: "FIRST Championship (Worlds) events", span: ", every season" } });
    expect(a.understood?.label).not.toMatch(/listed|in all/);
  });

  it("a shorter list (the header's) is the page's first rows", async () => {
    const a = await ask("first championship", 12);
    expect(events(a)).toHaveLength(12);
  });

  it("a year named, with or without 'in', is the championship held that year: one season's event and divisions", async () => {
    for (const q of [`first championship ${S}`, `first championship in ${S}`, `worlds ${S}`, `worlds divisions ${S}`]) {
      const a = await ask(q);
      expect(a.understood, q).toMatchObject({ kind: "events", year: S, scope: { span: ` held in ${S}` } });
      expect(new Set(events(a).map((h) => h.season)), q).toEqual(new Set([S - 1]));
      expect(events(a), q).toHaveLength(4);
    }
  });

  it("hits read from names get their event's code too", async () => {
    const hits = await withEventParents([
      { kind: "event", ref: `${S - 1}:USXXCMPE`, title: "Xland Championship - East Division", subtitle: "", season: S - 1 },
      { kind: "event", ref: `${S - 1}:USXXCMP`, title: "Xland Championship", subtitle: "", season: S - 1 },
      { kind: "team", ref: "4215", title: "4215 Hypnotic Robotics", subtitle: "", season: S },
    ]);
    expect(hits.map((h) => h.parent)).toEqual(["USXXCMP", undefined, undefined]);
  });
});
