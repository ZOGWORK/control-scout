// The records filter language: URL format (stable forever), round-trips, and
// clear errors for anything malformed.
import { describe, expect, it } from "vitest";
import { encodeFilterText, filterKeys, FilterError, parseFilter, serializeFilter, validateFilter, type FilterGroup } from "./filterDsl";
import { RECORD_SCOPES, STAT_CATALOG, statsFor } from "./statCatalog";

const NESTED = "and-penaltyPointsCommittedTot.lt.2+or-totalPointsOpr.gte.55+autoPointsAvg.gte.30--";
const nestedTree: FilterGroup = {
  kind: "group", type: "and", children: [
    { kind: "cond", key: "penaltyPointsCommittedTot", op: "lt", value: 2 },
    { kind: "group", type: "or", children: [
      { kind: "cond", key: "totalPointsOpr", op: "gte", value: 55 },
      { kind: "cond", key: "autoPointsAvg", op: "gte", value: 30 },
    ] },
  ],
};

const err = (s: string, scope: Parameters<typeof parseFilter>[1] = "teamEvent") => {
  try { parseFilter(s, scope); } catch (e) { expect(e).toBeInstanceOf(FilterError); return (e as Error).message; }
  throw new Error(`parsed: ${s}`);
};

describe("filter DSL", () => {
  it("parses FTC Scout's nested example", () => {
    expect(parseFilter(NESTED, "teamEvent")).toEqual(nestedTree);
  });
  it("serialises back to exactly the URL form", () => {
    expect(serializeFilter(nestedTree)).toBe(NESTED);
  });
  it("accepts a space for + (how a decoded query string delivers it)", () => {
    expect(parseFilter(NESTED.replace(/\+/g, " "), "teamEvent")).toEqual(nestedTree);
  });
  it("round-trips deep nesting, both group types, every operator and empty groups", () => {
    const tree: FilterGroup = {
      kind: "group", type: "or", children: [
        { kind: "group", type: "and", children: [] },
        { kind: "cond", key: "rank", op: "lte", value: 4 },
        { kind: "group", type: "and", children: [
          { kind: "cond", key: "wins", op: "eq", value: 5 },
          { kind: "group", type: "or", children: [
            { kind: "cond", key: "losses", op: "ne", value: 0 },
            { kind: "group", type: "and", children: [{ kind: "cond", key: "dcPointsMax", op: "gt", value: 100.5 }] },
          ] },
        ] },
        { kind: "cond", key: "penaltyPointsCommittedOpr", op: "lt", value: -3.25 },
        { kind: "cond", key: "teamName", op: "contains", value: "x-drive. 3+ é/%" },
        { kind: "cond", key: "school", op: "ne", value: "123" },
      ],
    };
    const s = serializeFilter(tree);
    expect(s).toBe("or-and--+rank.lte.4+and-wins.eq.5+or-losses.ne.0+and-dcPointsMax.gt.100.5---+penaltyPointsCommittedOpr.lt.-3.25+teamName.contains.x%2Ddrive%2E%203%2B%20%C3%A9%2F%25+school.ne.123-");
    expect(parseFilter(s, "teamEvent")).toEqual(tree);
    expect(validateFilter(tree, "teamEvent")).toEqual(tree);
  });
  it("keeps negative numbers apart from group closers", () => {
    expect(parseFilter("and-penaltyPointsCommittedOpr.gt.-5-", "teamEvent").children[0]).toMatchObject({ value: -5 });
    expect(parseFilter("and-or-penaltyPointsCommittedOpr.gte.-0.5--", "teamEvent")).toEqual({ kind: "group", type: "and", children: [{ kind: "group", type: "or", children: [{ kind: "cond", key: "penaltyPointsCommittedOpr", op: "gte", value: -0.5 }] }] });
  });
  it("encodes every separator in text values", () => {
    expect(encodeFilterText("a-b.c+d e")).toBe("a%2Db%2Ec%2Bd%20e");
  });
  it("lists the keys a filter uses", () => {
    expect([...filterKeys(nestedTree)]).toEqual(["penaltyPointsCommittedTot", "totalPointsOpr", "autoPointsAvg"]);
  });

  it("rejects malformed filters with the position of the problem", () => {
    expect(err("autoPointsAvg.gte.30")).toMatch(/expected a group opening "and-" or "or-" \(at character 1\)/);
    expect(err("and-autoPointsAvg.gte.30")).toMatch(/never closed/);
    expect(err("and-autoPointsAvg.gte.30--")).toMatch(/unexpected text after the filter closed \(at character 26\)/);
    expect(err("and-autoPointsAvg.gte-")).toMatch(/needs an operator and a value/);
    expect(err("and-autoPointsAvg.gte.-")).toMatch(/has no value/);
    expect(err("and-autoPointsAvg.ge.30-")).toMatch(/unknown operator "ge"/);
    expect(err("and-autoPointsAvg.gte.abc-")).toMatch(/autoPointsAvg is a number — "abc" isn't/);
    expect(err("and-autoPointsAvg.gte.30x-")).toMatch(/isn't/);
    expect(err("and-autoPointsAvg.contains.3-")).toMatch(/"contains" only works on text stats/);
    expect(err("and-teamName.gt.3-")).toMatch(/teamName is text: use contains, eq or ne/);
    expect(err("and-AutoPoints.gte.3-")).toMatch(/isn't a stat key/);
    expect(err("and-autoPointsAvgg.gte.3-")).toMatch(/unknown stat "autoPointsAvgg"/);
    expect(err("and-rank.lt.3-", "teamSeason")).toMatch(/"rank" isn't available for team-season records/);
    expect(err("and-redTotalPoints.gt.3-", "teamEvent")).toMatch(/isn't available for team-event records/);
    expect(err("and-teamName.contains.%E0%A4%A-")).toMatch(/badly encoded value/);
    expect(parseFilter("and-wins.gt.1 wins.gt.2-", "teamEvent").children).toHaveLength(2);
    expect(err("and-wins.gt.1wins.gt.2-")).toMatch(/isn't/);
    expect(err("xor-wins.gt.1-")).toMatch(/expected a group opening/);
  });
  it("caps size, depth and condition count", () => {
    expect(err(`${"and-".repeat(9)}wins.gt.1${"-".repeat(9)}`)).toMatch(/nest deeper than 8/);
    expect(err(`and-${Array.from({ length: 65 }, () => "wins.gt.1").join("+")}-`)).toMatch(/more than 64 conditions/);
    expect(err(`and-teamName.contains.${"a".repeat(101)}-`)).toMatch(/longer than 100/);
    expect(err(`and-${"x".repeat(5000)}-`)).toMatch(/too long/);
  });
});

describe("stat catalog", () => {
  it("has unique camelCase keys", () => {
    const keys = STAT_CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][A-Za-z0-9]*$/);
  });
  it("offers every score stat with all six aggregates for team records", () => {
    for (const base of ["totalPoints", "totalPointsNp", "autoPoints", "dcPoints", "endgamePoints", "penaltyPointsCommitted", "penaltyPointsByOpp"])
      for (const a of ["Tot", "Avg", "Opr", "Min", "Max", "Dev"]) for (const scope of ["teamEvent", "teamSeason"] as const) expect(statsFor(scope).some((s) => s.key === `${base}${a}`), `${base}${a}`).toBe(true);
  });
  it("keeps the keys FTC Scout's URLs use", () => {
    for (const k of ["penaltyPointsCommittedTot", "totalPointsOpr", "autoPointsAvg", "totalPointsNpOpr", "dcPointsMax", "penaltyPointsByOppAvg"]) expect(statsFor("teamEvent").map((s) => s.key)).toContain(k);
  });
  it("gives every record kind a sortable default and some stats", () => {
    for (const scope of RECORD_SCOPES) expect(statsFor(scope).length).toBeGreaterThan(5);
  });
});
