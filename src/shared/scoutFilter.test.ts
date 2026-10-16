// The shared scout entry filter (Task 17): each filter alone and together, the text search, the sorts
// (natural match order), and the URL round trip. Parity with the export: server/scout/export.test.ts.
import { describe, expect, it } from "vitest";
import {
  compareMatchLabels, entryMatches, filtersFromSearch, matchStage, naturalCompare, parseEntryFilters, parseExportFilters, queryOf,
  sortEntries, sortFromSearch, type EntryFilters, type FilterableEntry,
} from "./scoutFilter";
import { workspaceExportUrl } from "./scoutExport";

type E = FilterableEntry & { uuid: string; updatedAt: number };
const e = (uuid: string, over: Partial<E> = {}): E => ({
  uuid, team: 111, eventCode: "USCAQ1", matchLabel: "Q1", kind: "match", notes: "", authorAccountId: 7, authorDisplayName: "Priya",
  editorDisplayName: "", data: {}, updatedAt: 1000, ...over,
});

const fixtures: E[] = [
  e("a", { team: 111, matchLabel: "Q2", notes: "Fast INTAKE, good driver", updatedAt: 5 }),
  e("b", { team: 222, eventCode: "uscaq1", matchLabel: "q10", notes: "slow", authorAccountId: 8, authorDisplayName: "Marcus", updatedAt: 4 }),
  e("c", { team: 111, eventCode: "USTXCMP", kind: "pit", matchLabel: null, data: { drivetrain: "Swerve", climbs: true }, updatedAt: 3 }),
  e("d", { team: 333, eventCode: null, matchLabel: "F1", notes: "Équipe ÖSTERREICH", authorAccountId: 8, authorDisplayName: "Marcus", updatedAt: 2 }),
  e("e", { team: 111, matchLabel: "M3", notes: "deleted one", deleted: true, updatedAt: 9 }),
];
const ids = (f: EntryFilters) => fixtures.filter((x) => entryMatches(x, f)).map((x) => x.uuid);
const parsed = (q: string) => { const r = parseEntryFilters(queryOf(new URLSearchParams(q))); if (!r.ok) throw new Error(r.error); return r.filters; };

describe("entryMatches", () => {
  it("no filters: every entry but the deleted", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
  });

  it("each filter alone", () => {
    expect(ids(parsed("team=111"))).toEqual(["a", "c"]);
    expect(ids(parsed("team=111,333"))).toEqual(["a", "c", "d"]);
    expect(ids(parsed("event=usCAq1"))).toEqual(["a", "b"]); // any case, either side
    expect(ids(parsed("author=8"))).toEqual(["b", "d"]);
    expect(ids(parsed("match=Q10"))).toEqual(["b"]);
    expect(ids(parsed("match=q2&match=f1"))).toEqual(["a", "d"]);
    expect(ids(parsed("kind=pit"))).toEqual(["c"]);
    expect(ids(parsed("kind=match"))).toEqual(["a", "b", "d"]);
  });

  it("filters combine: every one must hold", () => {
    expect(ids(parsed("team=111&kind=match"))).toEqual(["a"]);
    expect(ids(parsed("author=8&event=USCAQ1"))).toEqual(["b"]);
    expect(ids(parsed("team=111&q=swerve"))).toEqual(["c"]);
    expect(ids(parsed("team=222&kind=pit"))).toEqual([]);
  });

  it("text search: case-insensitive over notes (Unicode too), every word, and answers and names", () => {
    expect(ids(parsed("q=intake"))).toEqual(["a"]);
    expect(ids(parsed("q=FAST+intake"))).toEqual(["a"]);
    expect(ids(parsed("q=fast+slow"))).toEqual([]);
    expect(ids(parsed(`q=${encodeURIComponent("équipe österreich")}`))).toEqual(["d"]);
    expect(ids(parsed("q=swerve"))).toEqual(["c"]); // an answer
    expect(ids(parsed("q=true"))).toEqual(["c"]); // a toggle reads true / false
    expect(ids(parsed("q=drivetrain"))).toEqual([]); // a field id is not an answer
    expect(ids(parsed("q=marcus"))).toEqual(["b", "d"]); // the author's name
    expect(ids(parsed("q=deleted"))).toEqual([]);
  });

  it("stored answers as JSON text read the same as an object", () => {
    expect(entryMatches(e("x", { data: JSON.stringify({ drivetrain: "Swerve" }) }), parsed("q=swerve"))).toBe(true);
    expect(entryMatches(e("x", { data: "not json" }), parsed("q=swerve"))).toBe(false);
  });

  it("match labels compare as SQLite's UPPER does (ASCII letters only)", () => {
    expect(entryMatches(e("x", { matchLabel: "q1" }), parsed("match=Q1"))).toBe(true);
    expect(entryMatches(e("x", { matchLabel: "ß1" }), parsed("match=SS1"))).toBe(false);
  });
});

describe("parsing", () => {
  it("bad values are errors, never dropped filters", () => {
    for (const q of ["team=abc", "team=0", "kind=both", "event=a%20b", "author=-1", `q=${"x".repeat(201)}`, `team=${Array.from({ length: 51 }, (_, i) => i + 1).join(",")}`]) {
      expect(parseEntryFilters(queryOf(new URLSearchParams(q))).ok, q).toBe(false);
    }
    expect(parseEntryFilters({ team: { x: "1" } }).ok).toBe(false);
    expect(parseExportFilters({ team: "1" }).ok).toBe(false); // season required
    expect(parseExportFilters({ season: "2025", team: "1" })).toEqual({ ok: true, filters: { season: 2025, team: [1] } });
  });

  it("the page reads each parameter on its own and names the bad ones", () => {
    const { filters, invalid } = filtersFromSearch(new URLSearchParams("team=111&kind=both&q=fast&space=901&season=2025"));
    expect(filters).toEqual({ team: [111], q: ["fast"] });
    expect(invalid).toEqual(["kind"]);
  });
});

describe("URL round trip", () => {
  it("the filters written to a URL read back the same, and the export link carries exactly them", () => {
    const sp = new URLSearchParams("space=901&season=2025&view=activity");
    sp.set("team", "18360"); sp.set("event", "USCAQ1"); sp.set("author", "8"); sp.set("match", "Q12"); sp.set("kind", "match"); sp.set("q", "Fast intake"); sp.set("sort", "match");
    const back = new URLSearchParams(sp.toString());
    expect(filtersFromSearch(back)).toEqual({ filters: { team: [18360], event: ["USCAQ1"], author: [8], match: ["Q12"], kind: "match", q: ["fast", "intake"] }, invalid: [] });
    expect(sortFromSearch(back)).toBe("match");
    expect(back.get("space")).toBe("901");
    expect(back.get("season")).toBe("2025");
    const url = new URL(workspaceExportUrl("901", back), "http://x");
    expect([...url.searchParams.keys()].sort()).toEqual(["author", "event", "kind", "match", "q", "season", "team"]);
    expect(parseExportFilters(queryOf(url.searchParams))).toEqual({ ok: true, filters: { season: 2025, ...filtersFromSearch(back).filters } });
  });

  it("an unknown sort is newest first", () => {
    expect(sortFromSearch(new URLSearchParams("sort=weird"))).toBe("newest");
    expect(sortFromSearch(new URLSearchParams(""))).toBe("newest");
  });
});

describe("sorting", () => {
  const live = fixtures.filter((x) => !x.deleted);
  it("newest first (the default)", () => {
    expect(sortEntries(live, "newest").map((x) => x.uuid)).toEqual(["a", "b", "c", "d"]);
  });

  it("by team number, then newest", () => {
    expect(sortEntries(live, "team").map((x) => x.uuid)).toEqual(["a", "c", "b", "d"]);
  });

  it("by match: event by event, qualifications in natural order, then playoffs, finals, pit (no label), no event last", () => {
    const m = [
      e("q10", { matchLabel: "Q10" }), e("q2", { matchLabel: "Q2" }), e("f1", { matchLabel: "F1" }), e("m3", { matchLabel: "M3" }),
      e("m3-2", { matchLabel: "M3-2" }), e("sf1", { matchLabel: "SF1-1" }), e("pit", { matchLabel: null, kind: "pit" }), e("q1", { matchLabel: "q1" }),
      e("other", { eventCode: "AAAA", matchLabel: "Q9" }), e("none", { eventCode: null, matchLabel: "Q1" }),
    ];
    expect(sortEntries(m, "match").map((x) => x.uuid)).toEqual(["other", "q1", "q2", "q10", "m3", "m3-2", "sf1", "f1", "pit", "none"]);
  });

  it("natural order and stages", () => {
    expect(["Q10", "Q2", "Q1", "F1", "M2"].sort(compareMatchLabels)).toEqual(["Q1", "Q2", "Q10", "M2", "F1"]);
    expect(naturalCompare("M3-10", "M3-2")).toBeGreaterThan(0);
    expect(naturalCompare("Q02", "Q2")).toBeGreaterThan(0); // equal numbers: the shorter first, so the order is stable
    expect([matchStage("Q5"), matchStage("QF1"), matchStage("M1"), matchStage("F2"), matchStage("Practice"), matchStage(null)]).toEqual([0, 1, 1, 2, 3, 4]);
  });
});
