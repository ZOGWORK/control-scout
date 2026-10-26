import { describe, expect, it } from "vitest";
import { canonicalPredict, modeOf, predictHref, readPredict, switchMode } from "./predictUrl";

const sp = (q: string) => new URLSearchParams(q);
const canon = (q: string) => canonicalPredict(sp(q))?.toString() ?? null;

describe("Predict's mode from the URL", () => {
  it("opens Advancement by default", () => {
    expect(modeOf(sp(""))).toBe("advancement");
    expect(modeOf(sp("view=lab"))).toBe("advancement");
  });
  it("an explicit mode wins", () => {
    expect(modeOf(sp("mode=scheduled&red=1,2"))).toBe("scheduled");
    expect(modeOf(sp("mode=match&for=team:4215"))).toBe("match");
  });
  it("older links still open the right mode", () => {
    expect(modeOf(sp("view=events&mode=match&red=1,2"))).toBe("scheduled"); // the old view switch wins over the Lab's remembered tab
    expect(modeOf(sp("view=lab&mode=match"))).toBe("match");
    expect(modeOf(sp("view=events"))).toBe("scheduled");
    expect(modeOf(sp("for=team:4215"))).toBe("scheduled");
    expect(modeOf(sp("red=1,2"))).toBe("match");
    expect(modeOf(sp("code=USNJQ1"))).toBe("advancement");
    expect(modeOf(sp("view=lab&for=team:4215"))).toBe("advancement");
  });
});

describe("reading Predict's picks", () => {
  it("keeps a lab link's team when it came as for= (the FTCCMP1EDIS link)", () => {
    const s = readPredict(sp("view=lab&mode=advancement&code=FTCCMP1EDIS&for=team:4215"));
    expect(s).toMatchObject({ mode: "advancement", code: "FTCCMP1EDIS", team: 4215, season: null });
  });
  it("an event pick opens in Advancement with its season", () => {
    expect(readPredict(sp("view=lab&for=event:2025:USNJQ1"))).toMatchObject({ mode: "advancement", code: "USNJQ1", season: 2025 });
  });
  it("Scheduled takes a team param when there's no for=", () => {
    expect(readPredict(sp("mode=scheduled&team=4215")).pick).toEqual({ kind: "team", team: 4215 });
  });
  it("drops junk team numbers", () => {
    const s = readPredict(sp("mode=match&red=4215,,abc&blue=0,7"));
    expect(s.red).toEqual([4215]);
    expect(s.blue).toEqual([7]);
    expect(readPredict(sp("for=team:0")).pick).toBeNull();
  });
});

describe("canonical Predict links", () => {
  it("leaves canonical links alone", () => {
    expect(canon("mode=advancement&season=2025&code=USNJQ1&team=4215")).toBeNull();
    expect(canon("mode=scheduled&for=team%3A4215")).toBeNull();
  });
  it("rewrites old links and drops params of other modes", () => {
    expect(canon("view=lab&mode=advancement&code=FTCCMP1EDIS&for=team:4215")).toBe("mode=advancement&code=FTCCMP1EDIS&team=4215");
    expect(canon("view=events&for=team:4215&mode=match&red=1,2&blue=3,4")).toBe("mode=scheduled&for=team%3A4215");
    expect(canon("view=lab&mode=match&red=1,2&blue=3,4&for=team:9")).toBe("mode=match&red=1%2C2&blue=3%2C4");
    expect(canon("for=event:2025:USNJQ1&season=2026")).toBe("mode=scheduled&for=event%3A2025%3AUSNJQ1");
  });
  it("keeps params the page doesn't own", () => {
    expect(canon("view=events&utm_source=discord")).toBe("mode=scheduled&utm_source=discord");
  });
  it("builds readable hrefs", () => {
    expect(predictHref({ mode: "match", season: 2025, red: [4215, 16091], blue: [] })).toBe("/predict?mode=match&season=2025&red=4215,16091");
    expect(predictHref({ mode: "scheduled", pick: { kind: "event", season: 2025, code: "USNJQ1" }, season: 2026 })).toBe("/predict?mode=scheduled&for=event:2025:USNJQ1");
  });
});

describe("switching modes", () => {
  const s = (q: string) => readPredict(sp(q));
  it("carries a team between Advancement and Scheduled", () => {
    expect(switchMode(s("mode=advancement&season=2025&team=4215&code=X"), "scheduled")).toEqual({ mode: "scheduled", pick: { kind: "team", team: 4215 }, season: 2025 });
    expect(switchMode(s("mode=scheduled&for=team:4215"), "advancement")).toEqual({ mode: "advancement", season: null, team: 4215 });
  });
  it("a scheduled event opens in Advancement already picked", () => {
    expect(switchMode(s("mode=scheduled&for=event:2025:USNJQ1"), "advancement")).toEqual({ mode: "advancement", season: 2025, code: "USNJQ1" });
  });
  it("a team starts a fresh matchup as red's first robot; a matchup keeps its own teams", () => {
    expect(switchMode(s("mode=advancement&team=4215"), "match")).toMatchObject({ red: [4215], blue: [] });
    expect(switchMode(s("mode=match&red=1,2&blue=3,4"), "match")).toMatchObject({ red: [1, 2], blue: [3, 4] });
  });
  it("Advancement's event without a team becomes Scheduled's event", () => {
    expect(switchMode(s("mode=advancement&season=2025&code=USNJQ1"), "scheduled")).toMatchObject({ pick: { kind: "event", season: 2025, code: "USNJQ1" } });
  });
});
