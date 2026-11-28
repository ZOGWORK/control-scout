// Per-match uploads, matched one at a time (./uploadMatch.ts). The titles are real ones from the watched channels'
// uploads (the 2026-11 dry run): the adds were checked in their videos' own score bars, and the FRC ones it turned up
// ("Detroit City Championship", New England's district championship, Indiana's invitational) are each a case here.
import { describe, expect, it } from "vitest";
import { claimOnce, findMatch, kindClash, matchUpload, nearEvents, titleMatches, titleSeasons, titleTeams, type PlannedUpload, type UploadMatchRow, type UploadVideo } from "./uploadMatch";
import type { ChannelRule, WatchEvent } from "./officialMatch";

const ev = (season: number, code: string, name: string, start: string, end: string | null = null, o: Partial<WatchEvent> = {}): WatchEvent => ({
  season, code, name, type: "Qualifier", city: null, venue: null, state: "ON", country: "Canada", start, end, timezone: "America/Toronto", divisionCode: null, parent: false, ...o,
});
const vid = (title: string, published: string, o: Partial<UploadVideo> = {}): UploadVideo => ({
  videoId: "aaaaaaaaaaa", channelId: "UCxxxxxxxxxxxxxxxxxxxxxx", title, published: `${published}T20:00:00Z`, start: null, durationS: 190, privacy: "public", embeddable: true, blockedIn: 0, ...o,
});
const ONT: ChannelRule = { region: "country=Canada;state=ON", words: "ontario canada" };
const quals = (n: number, teams: (q: number) => number[] = (q) => [10000 + q, 20000 + q, 30000 + q, 40000 + q]): UploadMatchRow[] =>
  Array.from({ length: n }, (_, i) => ({ level: "qual", series: 0, number: i + 1, label: `Q${i + 1}`, description: `Qualification ${i + 1}`, played: true, teams: teams(i + 1) }));
const bracket = (label: string, s: number, m: number): UploadMatchRow => ({ level: "playoff", series: s, number: m, label, description: `Semifinal ${s} Match ${m}`, played: true, teams: [1, 2, 3, 4] });
const elim = (n: number): UploadMatchRow => ({ level: "playoff", series: n, number: 1, label: `M${n}`, description: `Upper Bracket  Round 1 Match ${n}`, played: true, teams: [5, 6, 7, 8] });

describe("titleMatches", () => {
  it("reads each way a title names one match", () => {
    const one = (t: string) => { const m = titleMatches(t); expect(m).toHaveLength(1); return m[0]; };
    expect(one("Qualification 8 - 2025 FTC North Scarborough Qualifier")).toMatchObject({ kind: "qual", n: 8 });
    expect(one("Qualification Match 44 - 2024 GA FTC State Championship")).toMatchObject({ kind: "qual", n: 44 });
    expect(one("Arizona FIRST Tech Challenge 2023-2024 High Country Qualifier - Q9")).toMatchObject({ kind: "qual", n: 9 });
    expect(one("2014 Indiana Robotics Invitational Qualifying Match 094")).toMatchObject({ kind: "qual", n: 94 });
    expect(one("QM12   2022 Chicago Robotics Invitational")).toMatchObject({ kind: "qual", n: 12, frc: true });
    expect(one("FTC Arkansas battle at Benton qual 15")).toMatchObject({ kind: "qual", n: 15 });
    expect(one("Lakeshore Qualifier - Playoff Match 9 - FTC 2024-2025")).toMatchObject({ kind: "playoff", n: 9 });
    expect(one("Lower Bracket  Round 5 Match 9 - 2025 FTC Ottawa Qualifier")).toMatchObject({ kind: "playoff", n: 9 });
    expect(one("FTC Skystone Kent Qualifier Semifinal 1 Match 2")).toMatchObject({ kind: "semi", s: 1, m: 2 });
    expect(one("SF6M1   2023 New England FIRST District Championship")).toMatchObject({ kind: "semi", s: 6, m: 1, frc: true });
    expect(one("2020 GA FTC State Championship - Kilrain Division - Final Match 2")).toMatchObject({ kind: "final", n: 2 });
    expect(one("Wisconsin State FTC Championship - Match 03")).toMatchObject({ kind: "bare", n: 3 });
  });
  it("names none in a number that runs on, a meet's own number, or a year", () => {
    expect(titleMatches("Qualification 2.11 Zwijsen College - League Meet 05 - 2019/2020")).toEqual([]);
    expect(titleMatches("2026 MI FTC Kentwood Qualifier - Practice Day")).toEqual([]);
  });
  it("names two in a title of two", () => {
    expect(titleMatches("Q12 and Q13 - Bolton Qualifier")).toHaveLength(2);
  });
});

describe("title facts", () => {
  it("teams: 3 to 5 digits alone, never a year or a score", () => {
    expect(titleTeams("Q12 - 2025 FTC Bolton - 16488 vs 27831")).toEqual([16488, 27831]);
    expect(titleTeams("458 pts Maryland Tech Invitational 2021")).toEqual([]);
  });
  it("seasons: a year is a season's end or start; a range is one season", () => {
    expect([...titleSeasons("2025 FTC Ottawa Qualifier")!]).toEqual([2025, 2024]);
    expect([...titleSeasons("Frozen Frenzy II Qualifier - FTC 2024-2025")!]).toEqual([2024]);
    expect([...titleSeasons("2024-25 Ontario FTC Provincial Championship")!]).toEqual([2024]);
    expect(titleSeasons("WA Tesla League Tournament - Decode")).toBeNull();
  });
  it("kind: a championship's title isn't a qualifier's, nor the other way", () => {
    expect(kindClash("2025 Detroit City Championship", "Qualifier")).toBe(true);
    expect(kindClash("Lakeshore Qualifier", "Championship")).toBe(true);
    expect(kindClash("Qualification 3 - Ontario Provincial Championship", "Championship")).toBe(false);
    expect(kindClash("Maryland Tech Invitational 2021", "OffSeason")).toBe(false);
  });
});

describe("findMatch", () => {
  it("finds the qualification, final, semifinal or numbered playoff match it names", () => {
    expect(findMatch({ kind: "qual", n: 3, text: "Q3" }, quals(10))).toMatchObject({ match: { label: "Q3" } });
    expect(findMatch({ kind: "semi", s: 1, m: 2, text: "Semifinal 1 Match 2" }, [bracket("M1", 1, 1), bracket("M1-2", 1, 2)])).toMatchObject({ match: { label: "M1-2" } });
    expect(findMatch({ kind: "playoff", n: 4, text: "Playoff Match 4" }, [elim(3), elim(4)])).toMatchObject({ match: { label: "M4" } });
  });
  it("sets aside what can't be told: a number for a bracket, a semifinal for double elimination, a bare match, one it hasn't", () => {
    expect(findMatch({ kind: "playoff", n: 4, text: "Playoff Match 4" }, [bracket("M1", 1, 1)])).toHaveProperty("why");
    expect(findMatch({ kind: "semi", s: 4, m: 1, text: "SF4M1", frc: true }, [elim(4)])).toHaveProperty("why");
    expect(findMatch({ kind: "bare", n: 3, text: "Match 3" }, quals(10))).toHaveProperty("why");
    expect(findMatch({ kind: "qual", n: 99, text: "Q99" }, quals(10))).toEqual({ why: "it has no Q99" });
  });
});

describe("matchUpload", () => {
  const SCQ = ev(2024, "CAONSCQ2", "North Scarborough Qualifier", "2025-01-25", null, { city: "Scarborough" });
  const MAT = new Map<string, UploadMatchRow[]>([["2024|CAONSCQ2", quals(30)]]);
  const of = (e: WatchEvent) => MAT.get(`${e.season}|${e.code}`) ?? [];

  it("adds a title naming one match of one event, from the start", () => {
    const v = matchUpload(vid("Qualification Match 3 - 2024 ONT North Scarborough Qualifier", "2025-02-04"), ONT, [SCQ], of);
    expect(v).toMatchObject({ kind: "add", event: { code: "CAONSCQ2" }, match: { label: "Q3" }, t: 0 });
  });
  it("checks the teams a title names against the match's", () => {
    const ok = matchUpload(vid("Q3 - North Scarborough Qualifier - 10003 vs 20003", "2025-02-04"), ONT, [SCQ], of);
    expect(ok.kind).toBe("add");
    const off = matchUpload(vid("Q3 - North Scarborough Qualifier - 10004 vs 20003", "2025-02-04"), ONT, [SCQ], of);
    expect(off).toMatchObject({ kind: "review", why: expect.stringContaining("10004") });
  });
  it("ignores what isn't one match's upload: too long, not public, two matches, no match, a broadcast", () => {
    expect(matchUpload(vid("Qualification Match 3 - North Scarborough Qualifier", "2025-02-04", { durationS: 3 * 3600 }), ONT, [SCQ], of).kind).toBe("ignore");
    expect(matchUpload(vid("Qualification Match 3 - North Scarborough Qualifier", "2025-02-04", { privacy: "unlisted" }), ONT, [SCQ], of).kind).toBe("ignore");
    expect(matchUpload(vid("Q3 and Q4 - North Scarborough Qualifier", "2025-02-04"), ONT, [SCQ], of).kind).toBe("ignore");
    expect(matchUpload(vid("North Scarborough Qualifier highlights", "2025-02-04"), ONT, [SCQ], of).kind).toBe("ignore");
    expect(matchUpload(vid("Qualification Match 3 - North Scarborough Qualifier", "2025-02-04", { start: "2025-01-25T14:00:00Z" }), ONT, [SCQ], of).kind).toBe("ignore");
  });
  it("names an event both ways: every word of its name, and no word of another's", () => {
    // MTI is an FTC off-season event; Indiana's invitational, posted by the same channel, is FRC's.
    const US: ChannelRule = { region: "country=USA;type=Premier,OffSeason" };
    const MTI = ev(2020, "USCHSLHOS", "Maryland Tech Invitational", "2021-07-31", null, { type: "OffSeason", state: "MD", country: "USA" });
    const ms = () => quals(80, (q) => (q === 71 ? [11780, 11970, 15167, 19876] : [1, 2, 3, 4]));
    expect(matchUpload(vid("Maryland Tech Invitational 2021 Q35", "2021-08-03"), US, [MTI], ms)).toMatchObject({ kind: "add", match: { label: "Q35" } });
    expect(matchUpload(vid("Behind the Glass 195 CyberKnights 2021 Indiana Robotics Invitational Q71", "2021-08-03"), US, [MTI], ms).kind).toBe("ignore");
  });
  it("ignores FRC's: a district championship, a match named the FRC way with no FTC said", () => {
    const NE: ChannelRule = { region: "state=MA,NH,ME,VT,RI,CT", words: "england" };
    const NH = ev(2022, "USNHCMP", "New Hampshire State Championship", "2023-02-18", null, { type: "Championship", state: "NH", country: "USA" });
    expect(matchUpload(vid("QM89 2023 New England FIRST District Championship MEIR Division", "2023-03-01"), NE, [NH], () => quals(90)).kind).toBe("ignore");
    const WO = ev(2026, "USCTWOQ", "Wolcott MS Qualifier", "2026-08-15", null, { state: "CT", country: "USA" });
    expect(matchUpload(vid("QM16   2026 Where is Wolcott Invitational", "2026-08-31"), NE, [WO], () => quals(30))).toMatchObject({ kind: "ignore", why: expect.stringContaining("FRC") });
  });
  it("never stretches the dates by a title's year: Detroit's FRC championship isn't its FTC qualifier", () => {
    const MI: ChannelRule = { region: "state=MI" };
    const DQ = ev(2024, "USMIDEQ", "Detroit FTC Qualifier", "2024-11-22", "2024-11-23", { state: "MI", country: "USA" });
    // A year after, and a championship's title.
    expect(matchUpload(vid("2025 Detroit City Championship   Qualification Match 27", "2025-10-20"), MI, [DQ], () => quals(40)).kind).toBe("ignore");
    // Within the lag, but still a championship's title.
    expect(matchUpload(vid("2025 Detroit City Championship   Qualification Match 27", "2024-12-01"), MI, [DQ], () => quals(40)).kind).toBe("ignore");
  });
  it("a place-only name matches only its own event: the kind it says, and no other place", () => {
    const kq = ev(2024, "CAONKIQ", "Kingston Qualifier", "2025-01-11", null, { city: "Kingston" });
    const kc = ev(2024, "CAONKICMP", "Kingston Championship", "2025-01-18", null, { city: "Kingston", type: "Championship" });
    const wq = ev(2024, "CAONWAQ", "Waterloo Qualifier", "2025-01-12", null, { city: "Waterloo" });
    const all = [kq, kc, wq], ms = () => quals(30);
    const at = (title: string) => matchUpload(vid(title, "2025-01-25"), ONT, all, ms);
    expect(at("Qualification 5 - 2024 FTC Kingston Qualifier")).toMatchObject({ kind: "add", event: { code: "CAONKIQ" } });
    expect(at("Qualification 5 - 2024 FTC Kingston Championship")).toMatchObject({ kind: "add", event: { code: "CAONKICMP" } });
    expect(at("Qualification 5 - 2024 FTC Waterloo Qualifier")).toMatchObject({ kind: "add", event: { code: "CAONWAQ" } });
    // Two places said: neither event's own.
    expect(at("Qualification 5 - 2024 FTC Kingston Qualifier at Waterloo").kind).toBe("ignore");
  });
  it("tells a year's seasons apart by when it went up", () => {
    const a = ev(2024, "CAONMIQ", "FIRST Tech Challenge Mississauga Qualifier", "2024-11-30");
    const b = ev(2025, "CAONMIQ", "Mississauga Qualifier", "2025-11-29");
    const ms = () => quals(30);
    expect(matchUpload(vid("Qualification 15 - 2025 FTC Mississauga Qualifier", "2025-12-01"), ONT, [a, b], ms)).toMatchObject({ kind: "add", event: { season: 2025 } });
    expect(matchUpload(vid("Qualification 15 - 2025 FTC Mississauga Qualifier", "2024-12-02"), ONT, [a, b], ms)).toMatchObject({ kind: "add", event: { season: 2024 } });
  });
  it("takes the longer of two names the title says in full, and sets aside the shorter when it alone is said", () => {
    const WI: ChannelRule = { region: "state=WI" };
    const f1 = ev(2024, "USWISFQ1", "Frozen Frenzy", "2024-12-14", null, { state: "WI", country: "USA" });
    const f2 = ev(2024, "USWISFQ2", "Frozen Frenzy II", "2024-12-15", null, { state: "WI", country: "USA" });
    const ms = () => [...quals(30), elim(6)];
    expect(matchUpload(vid("Frozen Frenzy II Qualifier - Playoff Match 6 - FTC 2024-2025", "2024-12-28"), WI, [f1, f2], ms)).toMatchObject({ kind: "add", event: { code: "USWISFQ2" }, match: { label: "M6" } });
    expect(matchUpload(vid("Frozen Frenzy Qualifier - Qualification Match 17 - FTC 2024-2025", "2024-12-28"), WI, [f1, f2], ms)).toMatchObject({ kind: "review", why: expect.stringContaining("USWISFQ1 and 2024 USWISFQ2") });
  });
  it("sets aside a cut-off title, a bare match, a match the event hasn't, one not played", () => {
    expect(matchUpload(vid("Qualification 1 - 2024 FTC North Scarborough Qualifier ...", "2025-02-04"), ONT, [SCQ], of)).toMatchObject({ kind: "review", why: expect.stringContaining("cut off") });
    expect(matchUpload(vid("North Scarborough Qualifier - Match 3", "2025-02-04"), ONT, [SCQ], of).kind).toBe("review");
    expect(matchUpload(vid("Qualification 99 - North Scarborough Qualifier", "2025-02-04"), ONT, [SCQ], of)).toMatchObject({ kind: "review", why: expect.stringContaining("no Q99") });
    const unplayed = () => quals(3).map((m) => ({ ...m, played: false }));
    expect(matchUpload(vid("Qualification 2 - North Scarborough Qualifier", "2025-02-04"), ONT, [SCQ], unplayed)).toMatchObject({ kind: "review", why: expect.stringContaining("wasn't played") });
  });
  it("ignores an event outside the channel's region, or before it", () => {
    expect(matchUpload(vid("Qualification 3 - North Scarborough Qualifier", "2025-02-04"), { region: "state=WA" }, [SCQ], of).kind).toBe("ignore");
    expect(matchUpload(vid("Qualification 3 - North Scarborough Qualifier", "2025-01-10"), ONT, [SCQ], of).kind).toBe("ignore");
  });
});

describe("nearEvents", () => {
  it("gives a channel's region's events under way or ended within the lag of the day it went up", () => {
    const near = nearEvents([ev(2024, "A", "A", "2024-11-01"), ev(2024, "B", "B", "2025-01-25"), ev(2024, "C", "C", "2025-03-01"), ev(2024, "W", "W", "2025-01-25", null, { state: "WA", country: "USA" })]);
    expect(near(ONT, "2025-02-04T00:00:00Z").map((e) => e.code)).toEqual(["B"]);
    expect(near(ONT, null)).toEqual([]);
    // The lag's edge: ended 60 days before it went up is near, 62 days (or a year) isn't.
    const edge = nearEvents([ev(2024, "D60", "D", "2024-12-06"), ev(2024, "D62", "D", "2024-12-04"), ev(2023, "Y", "Y", "2024-02-04")]);
    expect(edge(ONT, "2025-02-04T00:00:00Z").map((e) => e.code)).toEqual(["D60"]);
  });
});

describe("claimOnce", () => {
  it("sets aside two uploads naming one match, and one for a match already taken", () => {
    const e = ev(2024, "X", "X", "2025-01-01");
    const add = (id: string, label: string): PlannedUpload => ({ video: vid("t", "2025-01-02", { videoId: id }), channel: "c", verdict: { kind: "add", event: e, match: { ...quals(5)[0], label }, t: 0, why: "" } });
    const out = claimOnce([add("a", "Q1"), add("b", "Q1"), add("c", "Q2"), add("d", "Q3")], ["2024|X|Q3"]);
    expect(out.map((p) => p.verdict.kind)).toEqual(["review", "review", "add", "review"]);
  });
});
