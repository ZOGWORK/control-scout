// "When is <event>" (./whenEvent.ts): an event's editions with the date of the one the question means leading; a set
// of different events stays a list, and a question without "when" is as before.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { resetSearchSeason } from "./season";
import { searchAnswer } from "../searchAnswer";
import { editionFor } from "./whenEvent";
import type { SearchHit } from "../../../src/shared/api";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const ask = (q: string, now = NOW) => searchAnswer(q, { limit: 25, full: true, now });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // One championship a season in Delaware: two held, one still to come; and two qualifiers in one season.
  for (const [season, code, name, type, day] of [
    [2024, "USDECMP", "Delaware Championship", "Championship", "2025-03-01"],
    [2025, "USDECMP", "Delaware Championship", "Championship", "2026-03-07"],
    [2026, "USDECMP", "Delaware Championship", "Championship", "2027-03-06"],
    [2025, "USDEQ1", "Delaware Qualifier One", "Qualifier", "2026-01-10"],
    [2025, "USDEQ2", "Delaware Qualifier Two", "Qualifier", "2026-02-07"],
    [2025, "USMDCMP", "Chesapeake Championship", "Championship", "2026-02-28"],
  ] as const) await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, 'Dover', ?, 'USA', ?, ?, 't')", [season, code, name, type, code.startsWith('USMD') ? 'MD' : 'DE', day, day]);
  await rebuildSearch();
  resetSearchSeason();
  clearAllCaches();
});

describe("when is an event", () => {
  it("leads with the edition still to come, the others below, newest first", async () => {
    const a = await ask("when is the delaware championship");
    expect([a.card?.title, a.card?.lines.map((l) => l.text), a.card?.lines[0].tag]).toEqual(["When: Delaware Championship", ["Mar 6, 2027", "Mar 7, 2026", "Mar 1, 2025"], "Upcoming"]);
    expect(a.understood?.label).toMatch(/^When: Delaware Championship, Mar 6, 2027 \(upcoming\); 2 other seasons below/);
    // Its events listed as before, under the card.
    expect(a.hits.filter((h) => h.kind === "event").length).toBe(3);
  });
  it("a state's championship by another name says the state; held already this season: the most recent", async () => {
    const a = await ask("when is the maryland championship");
    expect([a.card?.title, a.card?.lines[0].tag]).toEqual(["When: Chesapeake Championship (Maryland)", "The most recent"]);
  });
  it("none to come: the most recent; one on now: that one", () => {
    const ed = (season: number, start: string, end = start) => ({ kind: "event", ref: `${season}:X`, title: "X", subtitle: "", season, event: { start, end } }) as SearchHit & { event: { start: string; end: string } };
    const eds = [ed(2023, "2024-03-02"), ed(2024, "2025-03-01"), ed(2025, "2026-03-06", "2026-03-08")];
    expect(editionFor(eds, "2026-04-01").ref).toBe("2025:X");
    expect(editionFor(eds, "2026-03-07").ref).toBe("2025:X");
    expect(editionFor(eds, "2025-02-01").ref).toBe("2024:X");
  });
  it("a set of different events stays a list; asked without \"when\", as before", async () => {
    const set = await ask("when are the qualifiers in delaware this season");
    expect([set.card, set.hits.filter((h) => h.kind === "event").length]).toEqual([undefined, 2]);
    expect((await ask("delaware championship")).card).toBeUndefined();
  });
});
