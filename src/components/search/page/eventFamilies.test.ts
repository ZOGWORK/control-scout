// Events grouped before any card is drawn (./eventFamilies.ts): an event split in divisions is one family a season,
// by the parent code the server sends, whatever the event is called; the page's cut never splits one
// (src/shared/search.ts firstCards); a filtered set's heading says what's left (./results.ts filteredTitle).
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../../../shared/api";
import { firstCards, familyKey } from "../../../shared/search";
import { eventGroups, familyHref, familyMembers } from "./eventFamilies";
import { filteredTitle, type AnswerExtra } from "./results";

const ev = (season: number, code: string, title: string, parent?: string): SearchHit =>
  ({ kind: "event", ref: `${season}:${code}`, title, subtitle: `${code} · ${season + 1}-04-20 · Houston, TX, USA`, season, ...(parent ? { parent } : {}) });
const worlds = (season: number, divs: string[]) => [
  ev(season, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge"),
  ...divs.map((d) => ev(season, `FTCCMP1${d.slice(0, 4).toUpperCase()}`, `FIRST Championship - FIRST Tech Challenge - ${d} Division`, "FTCCMP1")),
];

describe("eventGroups", () => {
  it("one family a season, divisions then finals, newest first as listed, any number of divisions", () => {
    const hits = [...worlds(2025, ["Edison", "Franklin", "Goodall", "Jackson", "Lovelace", "Ross"]), ...worlds(2024, ["Jemison", "Ochoa"])];
    const g = eventGroups(hits);
    expect(g.map((x) => x.kind)).toEqual(["family", "family"]);
    const [a, b] = g.map((x) => (x.kind === "family" ? x.family : null)!);
    expect(a).toMatchObject({ season: 2025, code: "FTCCMP1", name: "FIRST Championship - FIRST Tech Challenge" });
    expect(familyMembers(a).map((m) => m.label)).toEqual(["Edison Division", "Franklin Division", "Goodall Division", "Jackson Division", "Lovelace Division", "Ross Division", "Finals"]);
    expect(familyMembers(b).map((m) => m.label)).toEqual(["Jemison Division", "Ochoa Division", "Finals"]);
    expect(familyHref(a)).toBe("/events?season=2025&q=FTCCMP1");
  });

  it("any event's divisions, by their parent code: a state's, and one with its finals not listed (named from them)", () => {
    const nj = [ev(2025, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "USNJCMP"), ev(2025, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "USNJCMP")];
    const [g] = eventGroups(nj);
    expect(g.kind === "family" && g.family).toMatchObject({ name: "New Jersey Championship", finals: null, divisions: nj });
  });

  it("an event alone stays one card; a finals with no division listed is alone too; every hit is in one group", () => {
    const hits = [ev(2026, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge"), ...worlds(2025, ["Edison", "Ross"]), ev(2025, "USTXCMP", "Texas Championship")];
    const g = eventGroups(hits);
    expect(g.map((x) => x.kind)).toEqual(["event", "family", "event"]);
    expect(g.flatMap((x) => (x.kind === "family" ? [...x.family.divisions, x.family.finals!] : x.hits))).toHaveLength(hits.length);
  });

  it("a division with no parent is no division: alone, and grouped across seasons by its name as before", () => {
    const g = eventGroups([ev(2023, "A", "2024 FIRST Championship - Edison Division"), ev(2024, "B", "FIRST Championship - FIRST Tech Challenge - Edison Division")]);
    expect(g).toHaveLength(1);
    expect(g[0].kind === "event" && g[0].hits.map((h) => h.season)).toEqual([2023, 2024]);
  });
});

describe("firstCards", () => {
  it("counts an event and its divisions as one card, so a cut never splits one", () => {
    const hits = [...worlds(2025, ["Edison", "Franklin", "Goodall"]), ...worlds(2024, ["Jemison", "Ochoa"]), ev(2023, "X", "X Championship")];
    expect(firstCards(hits, 2)).toHaveLength(7);
    expect(new Set(firstCards(hits, 2).map(familyKey)).size).toBe(2);
    expect(firstCards(hits, 25)).toEqual(hits);
  });
});

describe("filteredTitle", () => {
  const a = { q: "first championship", hits: [], pages: [], step: "deterministic", weak: false,
    understood: { kind: "events", label: "FIRST Championship (Worlds) events, every season, none on record for 2020–21", scope: { subject: "FIRST Championship (Worlds) events", span: ", every season" } } } as AnswerExtra;
  it("the server's heading stands until a filter narrows the set", () => {
    expect(filteredTitle(a, { when: "all", season: null, type: null })).toBeNull();
  });
  it("then says what's left: the season picked, the time tab", () => {
    expect(filteredTitle(a, { when: "all", season: 2024, type: null })).toBe("FIRST Championship (Worlds) events, 2024–25");
    expect(filteredTitle(a, { when: "upcoming", season: 2026, type: null })).toBe("Upcoming FIRST Championship (Worlds) events, 2026–27");
    expect(filteredTitle(a, { when: "past", season: null, type: null })).toBe("Past FIRST Championship (Worlds) events, every season");
    const nj = { ...a, understood: { ...a.understood!, scope: { subject: "Championships in New Jersey", span: " held in 2025" } } } as AnswerExtra;
    expect(filteredTitle(nj, { when: "past", season: null, type: null })).toBe("Past championships in New Jersey held in 2025");
  });
});
