// The Compare brief: fixed-rule sentences from the Compare data. Ties, missing and thin data, 2 to 4 teams,
// rounding, no winner language, and every number traced back to the data it came from.
import { describe, expect, it } from "vitest";
import type { CompareTeam, CompareView, MatchView } from "../shared/api";
import { BRIEF, WINNER_WORDS, briefText, compareBrief, list, shortDate, type BriefSentence } from "./compareBrief";
import { num } from "./format";

type Ev = CompareTeam["events"][number];
const ev = (code: string, start: string, opr: number, parts: Partial<Pick<Ev, "auto" | "teleop" | "endgame">> = {}): Ev =>
  ({ code, name: `${code} Qualifier`, start, opr, auto: parts.auto ?? null, teleop: parts.teleop ?? null, endgame: parts.endgame ?? null, rank: 3 });

/** A team whose season OPR parts are the best of its events, as the stats job computes them. */
function team(number: number, matches: number, events: Ev[]): CompareTeam {
  const best = (k: "opr" | "auto" | "teleop" | "endgame") => {
    const vs = events.map((e) => e[k]).filter((v): v is number => v != null);
    return vs.length ? Math.max(...vs) : null;
  };
  const stat = (value: number | null) => ({ value, rank: 1, of: 100 });
  return {
    team: { number, name: `Team ${number}` } as CompareTeam["team"],
    stats: matches === 0 ? null : {
      opr: { np: stat(best("opr")), auto: stat(best("auto")), teleop: stat(best("teleop")), endgame: stat(best("endgame")), pen: 0 },
      rating: null, record: { wins: 1, losses: 1, ties: 0, matches, events: events.length }, avg: { np: 1, score: 1, pen: 1 },
    },
    events,
  };
}
const view = (teams: CompareTeam[], meetings: CompareView["meetings"] = []): CompareView => ({ season: 2025, teams, meetings });
const topic = (s: BriefSentence[], t: BriefSentence["topic"]) => s.filter((x) => x.topic === t);
const one = (s: BriefSentence[], t: BriefSentence["topic"]) => { const x = topic(s, t); expect(x).toHaveLength(1); return x[0]; };

const A = team(18360, 24, [ev("USCAQ1", "2025-11-08", 95.04, { auto: 30, teleop: 50, endgame: 15 }), ev("USCAQ2", "2026-01-10", 130.16, { auto: 40.14, teleop: 70, endgame: 20 })]);
const B = team(24089, 9, [ev("USTXQ1", "2025-12-06", 84, { auto: 27.66, teleop: 45, endgame: 11.2 })]);

describe("compareBrief: two teams", () => {
  const s = compareBrief(view([A, B]));
  it("states each team's sample", () => {
    expect(one(s, "Sample size").text).toBe("In 2025–26, 18360 played 24 matches at 2 events and 24089 played 9 matches at 1 event.");
  });
  it("gives the gap from the rounded values shown, with both values and samples", () => {
    expect(one(s, "Auto").text).toBe("18360 adds an estimated 12.4 more auto points per match than 24089 (best-event OPR 40.1 vs 27.7; 24 vs 9 matches).");
    expect(one(s, "Overall").text).toBe("18360 adds an estimated 46.2 more points per match than 24089 (best-event OPR 130.2 vs 84; 24 vs 9 matches).");
  });
  it("links every phase number to the event it came from", () => {
    expect(one(s, "Auto").sources).toEqual([{ label: "18360 at USCAQ2 Qualifier", href: "/events/2025/USCAQ2" }, { label: "24089 at USTXQ1 Qualifier", href: "/events/2025/USTXQ1" }]);
  });
  it("judges consistency only with two events and says who has too few", () => {
    expect(one(s, "Consistency").text).toBe("Event OPR ranged 18360 95 to 130.2 over 2 events. 24089 has fewer than 2 events with an OPR, too few to judge.");
  });
  it("links a season value to the team's season when no listed event shows it", () => {
    const hidden = { ...B, stats: { ...B.stats!, opr: { ...B.stats!.opr, auto: { value: 33.3, rank: 1, of: 100 } } } };
    expect(one(compareBrief(view([A, hidden])), "Auto").sources[1]).toEqual({ label: "24089's season", href: "/teams/24089?season=2025" });
  });
  it("links the first event too when the recency sentence quotes a change since it", () => {
    expect(one(s, "Recency").sources).toEqual([
      { label: "18360 at USCAQ1 Qualifier", href: "/events/2025/USCAQ1" }, { label: "18360 at USCAQ2 Qualifier", href: "/events/2025/USCAQ2" },
      { label: "24089 at USTXQ1 Qualifier", href: "/events/2025/USTXQ1" }]);
  });
  it("gives the latest results and the trend", () => {
    expect(one(s, "Recency").text).toBe("Latest results: 18360 at USCAQ2 Qualifier on Jan 10, 2026 (event OPR 130.2, up 35.2 on its first event) and 24089 at USTXQ1 Qualifier on Dec 6, 2025 (event OPR 84).");
  });
  it("says plainly when they haven't met", () => {
    expect(one(s, "Head to head")).toMatchObject({ kind: "missing", text: "18360 hasn't played with or against 24089 in 2025–26." });
  });
});

describe("compareBrief: ties", () => {
  it("calls gaps under the level threshold level, not a lead", () => {
    const x = team(1, 10, [ev("E1", "2026-01-01", 50.2, { auto: 20 })]), y = team(2, 10, [ev("E2", "2026-01-01", 49.3, { auto: 20.94 })]);
    const s = compareBrief(view([x, y]));
    expect(one(s, "Overall").text).toBe("1 and 2 are level, within 1 point (best-event OPR 50.2 vs 49.3; 10 vs 10 matches).");
    expect(one(s, "Auto").text).toMatch(/^2 and 1 are level/);
  });
  it("a gap of exactly the threshold is a lead", () => {
    const s = compareBrief(view([team(1, 10, [ev("E1", "2026-01-01", 51)]), team(2, 10, [ev("E2", "2026-01-01", 50)])]));
    expect(one(s, "Overall").text).toMatch(/^1 adds an estimated 1 more points/);
  });
  it("names every team level at the top of three, and all level", () => {
    const s = compareBrief(view([team(1, 10, [ev("E", "2026-01-01", 60)]), team(2, 10, [ev("E", "2026-01-01", 59.5)]), team(3, 10, [ev("E", "2026-01-01", 40)])]));
    expect(one(s, "Overall").text).toBe("1 and 2 are level at the top, 19.5 or more points per match ahead of 3: best-event OPR 1 60 (10 matches), 2 59.5 (10 matches) and 3 40 (10 matches).");
    const all = compareBrief(view([team(1, 10, [ev("E", "2026-01-01", 60)]), team(2, 10, [ev("E", "2026-01-01", 59.5)]), team(3, 10, [ev("E", "2026-01-01", 59.2)])]));
    expect(one(all, "Overall").text).toMatch(/^All 3 are level, within 1 point: /);
  });
});

describe("compareBrief: missing and thin data", () => {
  it("leaves out a thin team, says why, and makes no claim without two teams", () => {
    const thin = team(24089, 2, [ev("USTXQ1", "2025-12-06", 84, { auto: 27.7 })]);
    const s = compareBrief(view([A, thin]));
    expect(topic(s, "Sample size")[1]).toMatchObject({ kind: "thin", text: "Only 2 matches for 24089 in 2025–26, fewer than the 5 needed, so its OPR isn't compared." });
    // One sentence for all four phases, and no thin number quoted anywhere.
    expect(one(s, "Overall")).toMatchObject({ kind: "missing", sources: [], text: "Not enough data to compare OPR, auto, TeleOp or endgame: it needs two teams with 5 or more matches and an OPR." });
    for (const p of ["Auto", "TeleOp", "Endgame"] as const) expect(topic(s, p)).toHaveLength(0);
    for (const x of s) expect(x.text).not.toMatch(/\b84\b|27\.7/);
    expect(one(s, "Recency").text).toContain("24089 at USTXQ1 Qualifier on Dec 6, 2025 (2 matches, too few to quote its OPR)");
  });
  it("a thin team drops out of a three-team comparison but the other two are compared", () => {
    const s = compareBrief(view([A, B, team(7, BRIEF.minMatches - 1, [ev("X", "2026-01-01", 200)])]));
    expect(one(s, "Overall").text).not.toContain("200");
    expect(one(s, "Overall").text).toMatch(/^18360 adds/);
  });
  it("a team with no results gets a missing sentence and is left out", () => {
    const s = compareBrief(view([A, B, team(99, 0, [])]));
    expect(topic(s, "Sample size")).toHaveLength(2);
    expect(topic(s, "Sample size")[1]).toMatchObject({ kind: "missing", text: "No results for 99 in 2025–26, so it's left out of every comparison." });
    expect(one(s, "Overall").text).not.toContain("99");
  });
  it("no data at all: only missing sentences", () => {
    const s = compareBrief(view([team(1, 0, []), team(2, 0, [])]));
    expect(s.every((x) => x.kind === "missing")).toBe(true);
    expect(one(s, "Recency").text).toBe("None of these teams has an event with results in 2025–26 yet.");
    expect(one(s, "Consistency").text).toMatch(/^Can't be judged yet/);
  });
  it("a missing phase value is not compared", () => {
    const s = compareBrief(view([A, B]));
    expect(one(s, "Endgame").kind).toBe("fact");
    const noEnd = { ...B, stats: { ...B.stats!, opr: { ...B.stats!.opr, endgame: { value: null, rank: null, of: null } } } };
    expect(one(compareBrief(view([A, noEnd])), "Endgame").kind).toBe("missing");
  });
  it("one team: no head to head, no comparisons", () => {
    const s = compareBrief(view([A]));
    expect(topic(s, "Head to head")).toHaveLength(0);
    expect(one(s, "Overall").kind).toBe("missing");
    expect(topic(s, "Auto")).toHaveLength(0);
  });
});

describe("compareBrief: three and four teams", () => {
  const C = team(1234, 12, [ev("USNYQ1", "2025-11-01", 100, { auto: 30 }), ev("USNYQ2", "2026-02-01", 104, { auto: 31 }), ev("USNYQ3", "2026-03-01", 102, { auto: 29 })]);
  const D = team(5555, 6, [ev("USFLQ1", "2026-02-14", 70, { auto: 10 })]);
  it("orders by value and lists every team with its sample", () => {
    const s = compareBrief(view([B, A, C, D]));
    expect(one(s, "Overall").text).toBe("18360 is highest, an estimated 26.2 more points per match than 1234: best-event OPR 18360 130.2 (24 matches), 1234 104 (12 matches), 24089 84 (9 matches) and 5555 70 (6 matches).");
    expect(one(s, "Overall").sources.map((x) => x.href)).toEqual(["/events/2025/USCAQ2", "/events/2025/USNYQ2", "/events/2025/USTXQ1", "/events/2025/USFLQ1"]);
  });
  it("names the steadiest team only among those with two events", () => {
    const s = compareBrief(view([A, B, C]));
    expect(one(s, "Consistency").text).toBe("Event OPR ranged 18360 95 to 130.2 over 2 events and 1234 100 to 104 over 3 events. 1234 was the steadiest, with the narrowest range (4 points). 24089 has fewer than 2 events with an OPR, too few to judge.");
  });
  it("counts head-to-head meetings and the first team's record against", () => {
    const alliance = (teams: number[], total: number | null) => ({ teams: teams.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: total == null ? null : { total, np: total, auto: 0, teleop: 0, endgame: 0, pen: 0 } });
    const match = (key: string, red: number[], blue: number[], r: number | null, b: number | null, relation: "opponents" | "partners"): CompareView["meetings"][number] =>
      ({ season: 2025, code: "USCAQ2", key, level: "qual", series: 0, number: 1, label: `Q${key.split(":")[2]}`, time: null, startsAt: null, played: true, red: alliance(red, r), blue: alliance(blue, b), video: null, prediction: null, relation } as MatchView & { relation: typeof relation });
    const s = compareBrief(view([A, B, C], [
      match("qual:0:1", [18360, 1], [24089, 2], 100, 90, "opponents"),
      match("qual:0:2", [24089, 3], [18360, 4], 120, 80, "opponents"),
      match("qual:0:3", [18360, 1234], [5, 6], 70, 70, "partners"),
      match("qual:0:4", [1234, 7], [18360, 8], null, null, "opponents"),
    ]));
    const h = one(s, "Head to head");
    expect(h.text).toBe("18360 met 24089 and 1234 in 4 played matches (opponents in 3, partners in 1); in the 2 scored matches against, 18360's alliance went 1-1-0.");
    expect(h.sources[0]).toEqual({ label: "USCAQ2 Q1", href: "/events/2025/USCAQ2/match/qual%3A0%3A1" });
    // One match with a compared partner and a compared opponent counts toward both, whatever the server labelled it.
    const mixed = compareBrief(view([A, B, C], [match("qual:0:5", [18360, 24089], [1234, 9], 90, 80, "opponents")]));
    expect(one(mixed, "Head to head").text).toBe("18360 met 24089 and 1234 in 1 played match (opponents in 1, partners in 1; a match can be both); in the 1 scored match against, 18360's alliance went 1-0-0.");
    // A listed no-show is no meeting: neither a compared team off the field nor the first team off the field counts.
    const noShow = match("qual:0:6", [18360, 1], [24089, 2], 100, 50, "opponents");
    noShow.blue.teams[0].onField = false;
    const firstOff = match("qual:0:7", [18360, 1], [1234, 2], 100, 50, "opponents");
    firstOff.red.teams[0].onField = false;
    expect(one(compareBrief(view([A, B, C], [noShow, firstOff])), "Head to head")).toMatchObject({ kind: "missing" });
  });
});

describe("compareBrief: rules that hold for every brief", () => {
  const C = team(1234, 12, [ev("USNYQ1", "2025-11-01", 100.05, { auto: 30.25, teleop: 55.55, endgame: 14.45 }), ev("USNYQ2", "2026-02-01", 104.35, { auto: 31, teleop: 60.04, endgame: 13 })]);
  const thin = team(42, 3, [ev("USWAQ1", "2025-12-01", 66.6)]);
  const briefs = [view([A, B]), view([A, B, C]), view([A, B, C, thin]), view([thin, team(43, 0, [])]), view([A])];

  it("never uses winner language", () => {
    for (const d of briefs) for (const s of compareBrief(d)) expect(s.text).not.toMatch(WINNER_WORDS);
    expect("18360 will win").toMatch(WINNER_WORDS);
  });

  it("every number in a sentence is a shown Compare value, a gap between two of them, a count or a date part", () => {
    for (const d of briefs) {
      const shown = new Set<string>();
      const values: number[] = [];
      const add = (v: number | null | undefined) => { if (v != null) { shown.add(num(v)); values.push(Number(num(v))); } };
      for (const x of d.teams) {
        shown.add(String(x.team.number));
        for (const k of ["np", "auto", "teleop", "endgame"] as const) add(x.stats?.opr[k].value);
        for (const e of x.events) add(e.opr);
        if (x.stats) { shown.add(String(x.stats.record.matches)); shown.add(String(x.stats.record.events)); shown.add(String(x.events.filter((e) => e.opr != null).length)); }
      }
      for (const a of values) for (const b of values) shown.add(num(Math.abs(Math.round((a - b) * 10) / 10)));
      for (const k of [BRIEF.minMatches, BRIEF.minEvents, BRIEF.levelPoints]) shown.add(String(k));
      for (const s of compareBrief(d)) {
        // Dates ("Jan 10, 2026") and the season label ("2025–26") are checked by their own tests.
        const text = s.text.replace(/[A-Z][a-z]{2} \d{1,2}, \d{4}/g, "").replace(/\d{4}–\d{2}/g, "");
        for (const n of text.match(/\d+(\.\d+)?/g) ?? []) expect(shown, `${n} in "${s.text}"`).toContain(n);
      }
    }
  });

  it("every source is an in-app link to an event, a match or a team season", () => {
    for (const d of briefs) for (const s of compareBrief(d)) for (const x of s.sources) expect(x.href).toMatch(/^\/(events\/2025\/[^/]+(\/match\/[^/]+)?|teams\/\d+\?season=2025)$/);
  });

  it("caps match links but counts every meeting", () => {
    const m = (i: number) => ({ season: 2025, code: "E", key: `qual:0:${i}`, level: "qual", series: 0, number: i, label: `Q${i}`, time: null, startsAt: null, played: true,
      red: { teams: [{ number: 18360, surrogate: false, dq: false, onField: true }], score: null }, blue: { teams: [{ number: 24089, surrogate: false, dq: false, onField: true }], score: null },
      video: null, prediction: null, relation: "opponents" as const }) as CompareView["meetings"][number];
    const h = one(compareBrief(view([A, B], Array.from({ length: BRIEF.maxMatchLinks + 3 }, (_, i) => m(i + 1)))), "Head to head");
    expect(h.sources).toHaveLength(BRIEF.maxMatchLinks);
    expect(h.text).toBe(`18360 met 24089 in ${BRIEF.maxMatchLinks + 3} played matches (opponents in ${BRIEF.maxMatchLinks + 3}, partners in 0).`);
  });
});

describe("helpers", () => {
  it("lists and dates", () => {
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b"])).toBe("a and b");
    expect(list(["a", "b", "c"])).toBe("a, b and c");
    expect(shortDate("2026-03-14")).toBe("Mar 14, 2026");
  });
  it("plain text: a heading, each sentence with full source links, and the page link", () => {
    const d = view([A, B]);
    const text = briefText(d, compareBrief(d), "https://controlscout.org");
    expect(text.startsWith("Comparison brief: 18360 and 24089, 2025–26\n\nSample size: In 2025–26")).toBe(true);
    expect(text).toContain("Auto: 18360 adds an estimated 12.4 more auto points per match than 24089");
    expect(text).toContain("  - 18360 at USCAQ2 Qualifier: https://controlscout.org/events/2025/USCAQ2");
    expect(text.endsWith("From https://controlscout.org/compare?teams=18360,24089&season=2025")).toBe(true);
  });
});
