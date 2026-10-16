// The filter bar's picks (src/lib/scoutFeed.ts): every option offered finds the entries it came from
// (folded as the shared predicate folds), authors come from the entries, and your unsynced entries are yours.
import { describe, expect, it } from "vitest";
import { asAuthored, feedOptions } from "./scoutFeed";
import { entryMatches, filtersFromSearch } from "../shared/scoutFilter";
import type { ScoutEntry } from "./scouting";

let n = 0;
const e = (over: Partial<ScoutEntry>): ScoutEntry => ({
  uuid: `feed${++n}`, workspaceId: "901", season: 2025, team: 111, eventCode: "USCAQ1", matchLabel: "Q1", kind: "match", data: {}, notes: "",
  updatedAt: n, authorAccountId: 7, authorDisplayName: "Priya", ...over,
});

describe("feedOptions", () => {
  const entries = [
    e({ matchLabel: "ß1" }), e({ matchLabel: "q10" }), e({ matchLabel: "Q2" }), e({ matchLabel: "F1", eventCode: "ustxcmp" }),
    e({ matchLabel: "Q1,Q2" }), e({ matchLabel: " Q3" }), e({ eventCode: "bad code" }), e({ kind: "pit", matchLabel: null, eventCode: null }),
  ];
  const o = feedOptions(entries, true, null);

  it("match labels as the predicate folds them (ASCII only), in playing order; unpickable ones left out", () => {
    expect(o.matches).toEqual(["Q1", "Q2", "Q10", "F1", "ß1"]);
    expect(o.events.map((x) => x.code)).toEqual(["USCAQ1", "USTXCMP"]);
  });

  it("every option, picked, finds the entries it came from", () => {
    for (const m of o.matches) {
      const { filters } = filtersFromSearch(new URLSearchParams({ match: m }));
      expect(entries.some((x) => entryMatches(x, filters)), m).toBe(true);
    }
    for (const ev of o.events) {
      const { filters } = filtersFromSearch(new URLSearchParams({ event: ev.code }));
      expect(entries.some((x) => entryMatches(x, filters)), ev.code).toBe(true);
    }
  });

  it("authors from the entries (newest name), you first; event names where known", () => {
    const list = [e({ authorAccountId: 8, authorDisplayName: "Marc", updatedAt: 1 }), e({ authorAccountId: 8, authorDisplayName: "Marcus", updatedAt: 9 }), e({ authorAccountId: 9001, authorDisplayName: "Ada" })];
    const opts = feedOptions(list, true, { accountId: 9001, displayName: "Ada" }, new Map([["USCAQ1", "California Qualifier"]]));
    expect(opts.authors).toEqual([{ id: 9001, name: "Ada (you)" }, { id: 8, name: "Marcus" }]);
    expect(opts.events).toEqual([{ code: "USCAQ1", name: "California Qualifier" }]);
    expect(feedOptions(list, false, null).authors).toBeNull();
  });

  it("an unsynced workspace entry (no author yet) is yours; personal and stamped ones are left alone", () => {
    const me = { accountId: 9001, displayName: "Ada" };
    expect(asAuthored(e({ authorAccountId: 0, authorDisplayName: "" }), me)).toMatchObject({ authorAccountId: 9001, authorDisplayName: "Ada" });
    expect(asAuthored(e({ authorAccountId: 8 }), me).authorAccountId).toBe(8);
    expect(asAuthored(e({ workspaceId: null, authorAccountId: 0 }), me).authorAccountId).toBe(0);
  });
});
