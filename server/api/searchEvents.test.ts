// Event sets on a small fixture (server/api/searchEvents.ts): the FTC One Search brief's place, venue, time and year
// tests, the chronological order, the labelled fallback, and one reading for every limit.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { showingLine } from "../../src/shared/search";
import { answerSections } from "../../src/shared/searchSections";

const S = CURRENT_SEASON;
// Monday 2026-11-02, noon UTC: "today" in every test here.
const now = Date.parse("2026-11-02T12:00:00Z");
const ask = (q: string, limit = 25) => searchAnswer(q, { now, limit, learn: false });
const refs = (hits: { kind: string; ref: string }[]) => hits.filter((h) => h.kind === "event").map((h) => h.ref.split(":")[1]);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev: [number, string, string, string, string | null, string, string, string][] = [
    // season, code, name, type, venue, city, state, start
    [S, "USNJSOM1", "P1-1 Southern League Meet", "LeagueMeet", "Holmdel High School", "Holmdel", "NJ", "2026-10-24"],
    [S, "USNJNOM1", "P1-4 Northern League Meet", "LeagueMeet", "Westfield High School", "Westfield", "NJ", "2026-11-01"],
    [S, "USNJNEM2", "P1-5 AM Northeast League Meet", "LeagueMeet", "Don Bosco Prep High School", "Ramsey", "NJ", "2026-11-07"],
    [S, "USNJNEM4", "P2-1 Northeast League Meet", "LeagueMeet", "Dumont High School", "Dumont", "NJ", "2026-11-14"],
    [S, "USNJNEM6", "P2-8 Northeast League Meet", "LeagueMeet", "River Dell High School", "Oradell", "NJ", "2026-12-13"],
    [S, "USNJCMP", "New Jersey Championship", "Championship", "Kean University", "Union", "NJ", "2027-03-14"],
    [S, "USNJHPN", "Practice Day-Central", "Scrimmage", "Highland Park High School", "Highland Park", "NJ", "2026-10-18"],
    [S, "USMOSLM", "SLU Meet", "LeagueMeet", "SLU", "St Louis", "MO", "2026-11-08"],
    [S - 1, "USNJNEM9", "Last Season Northeast League Meet", "LeagueMeet", "River Dell High School", "Oradell", "NJ", "2025-12-13"],
    [S - 3, "FTCCMP1EDIS", "2024 FIRST Championship - Edison Division", "FIRSTChampionship", "George R. Brown", "Houston", "TX", "2024-04-15"],
    [S - 1, "FTCCMP1EDIS", "FIRST Championship - Edison Division", "FIRSTChampionship", "George R. Brown", "Houston", "TX", "2026-04-29"],
  ];
  for (const [season, code, name, type, venue, city, state, start] of ev) {
    await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'USA', ?, ?, 'test')", [season, code, name, type, venue, city, state, start, start]);
  }
  for (const [n, name, city] of [[4215, "Hypnotic Robotics", "Oradell"], [6980, "Bad Wolf", "Oradell"], [37525, "Oncoming Storm - Red", "Penfield"]] as const) {
    await run("INSERT INTO teams (number, name, school, city, state, country) VALUES (?, ?, ?, ?, ?, 'USA')", [n, name, n === 37525 ? null : "River Dell Regional High Sch", city, n === 37525 ? "NY" : "NJ"]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'USNJNEM2', ?, 50, 5)", [S, n]);
  }
  // A Los Angeles meet on Nov 2 (its own calendar), a two-day meet under way, and a league tournament in NJ.
  await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, timezone, source) VALUES (?, 'USCALAM', 'LA League Meet', 'LeagueMeet', 'LA High', 'Los Angeles', 'CA', 'USA', '2026-11-02', '2026-11-02', 'America/Los_Angeles', 'test')", [S]);
  await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (?, 'USTXTWO', 'Two Day League Meet', 'LeagueMeet', 'Austin High', 'Austin', 'TX', 'USA', '2026-11-01', '2026-11-03', 'test')", [S]);
  await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (?, 'USTXOLD', 'Done League Meet', 'LeagueMeet', 'Dallas High', 'Dallas', 'TX', 'USA', '2026-10-10', '2026-10-10', 'test')", [S]);
  await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (?, 'USNJLT', 'NJ League Tournament', 'LeagueTournament', 'Kean', 'Union', 'NJ', 'USA', '2027-02-07', '2027-02-07', 'test')", [S]);
  await rebuildSearch();
});

describe("event sets (brief Section 3)", () => {
  it("1–2: meets in New Jersey, labelled as asked, the same for every plural and preposition", async () => {
    const a = await ask("Meets in New Jersey");
    expect(a.step).toBe("deterministic");
    expect(a.didYouMean).toBeUndefined();
    expect(a.understood).toMatchObject({ kind: "events", label: "League meets in New Jersey", place: { key: "USA:NJ" }, season: S });
    expect(showingLine(a)).toBe("League meets in New Jersey");
    expect(refs(a.hits)).not.toContain("USMOSLM"); // never St Louis
    expect(refs(a.hits)).not.toContain("USNJHPN"); // a scrimmage isn't a meet
    for (const q of ["Meet in New Jersey", "Meet at new Jersey", "Meets at New Jersey"]) expect((await ask(q)).hits, q).toEqual(a.hits);
  });
  it("11: upcoming soonest first, then past most recent first, never interleaved", async () => {
    expect(refs((await ask("meets in New Jersey")).hits)).toEqual(["USNJNEM2", "USNJNEM4", "USNJNEM6", "USNJNOM1", "USNJSOM1"]);
    const a = await ask("meets in New Jersey");
    expect(a.hits.filter((h) => h.kind === "event").map((h) => h.event?.status)).toEqual(["upcoming", "upcoming", "upcoming", "finished", "finished"]);
  });
  it("3 and 7: upcoming and past", async () => {
    const up = await ask("upcoming meets in New Jersey");
    expect(refs(up.hits)).toEqual(["USNJNEM2", "USNJNEM4", "USNJNEM6"]);
    expect(up.understood).toMatchObject({ label: "Upcoming league meets in New Jersey", time: "upcoming", window: { from: "2026-11-02", to: null } });
    expect(up.hits.some((h) => h.ref === "37525")).toBe(false); // never Oncoming Storm
    const past = await ask("past meets in New Jersey");
    expect(refs(past.hits)).toEqual(["USNJNOM1", "USNJSOM1"]);
    expect(past.understood?.label).toBe("Past league meets in New Jersey");
  });
  it("4: a venue composes with the place; a venue with no events falls back, labelled", async () => {
    const a = await ask("meets in New Jersey at River dell high school");
    expect(refs(a.hits)).toEqual(["USNJNEM6"]);
    expect(a.understood).toMatchObject({ label: "League meets in New Jersey at River Dell High School" });
    expect(a.understood?.fallback).toBeUndefined();
    const none = await ask("meets at Nonexistent High School in New Jersey");
    expect(none.step).toBe("deterministic");
    expect(none.understood?.fallback).toBe("No league meets in New Jersey at Nonexistent High School — showing league meets in New Jersey instead");
    expect(refs(none.hits)).toEqual(refs((await ask("meets in New Jersey")).hits));
    expect(answerSections(none).notes.understood).toContain(none.understood!.fallback);
  });
  it("5: 'New Jersey' and 'NJ' list the place first, then its events, then its teams", async () => {
    for (const q of ["New Jersey", "NJ"]) {
      const a = await ask(q);
      expect(a.hits[0], q).toMatchObject({ kind: "place", ref: "USA:NJ", title: "All events in New Jersey" });
      expect(refs(a.hits).length, q).toBeGreaterThan(0);
      const kinds = a.hits.map((h) => h.kind);
      expect(kinds.lastIndexOf("event"), q).toBeLessThan(kinds.indexOf("team") === -1 ? Infinity : kinds.indexOf("team"));
    }
  });
  it("6: this weekend is the coming Saturday and Sunday", async () => {
    const a = await ask("meets this weekend");
    expect(a.understood).toMatchObject({ label: "This weekend's league meets", window: { from: "2026-11-07", to: "2026-11-08" } });
    expect(refs(a.hits)).toEqual(["USNJNEM2", "USMOSLM"]);
  });
  it("21: a year scopes to events held that year, never another year's", async () => {
    const a = await ask("2024 Houston Championship Edison Division");
    expect(a.hits.map((h) => h.ref)).toEqual([`${S - 3}:FTCCMP1EDIS`]);
    const none = await ask("2019 Houston Championship Edison Division");
    expect(none.step).toBe("recovery");
    expect(none.hits).toEqual([]);
    expect(none.recovery?.understood).toContain("No events held in 2019 match");
    expect(none.understood?.label).toMatch(/: no events held in 2019 match$/); // the one line surfaces show says it
    expect(none.recovery?.closest.map((h) => h.ref)).toContain(`${S - 3}:FTCCMP1EDIS`); // other years, labelled as closest
    expect(refs((await ask("NJ State Championship")).hits)).toEqual(["USNJCMP"]);
  });
});

describe("one reading for every surface (Requirement 2)", () => {
  it("a smaller limit is the top of the same list, with the same step and label", async () => {
    for (const q of ["meets in New Jersey", "hypnotic", "River Dell", "New Jersey", "4215 vs 6980", "hipnotic robotics"]) {
      const page = await ask(q, 25), box = await ask(q, 3);
      expect(box.step, q).toBe(page.step);
      expect(box.understood, q).toEqual(page.understood);
      expect(box.hits, q).toEqual(page.hits.slice(0, 3));
    }
  });
});

describe("corrections and fuzzy matches (Requirements 4, 14.3)", () => {
  it("names a correction only for a near miss to a name", async () => {
    const typo = await ask("hipnotic robotics");
    expect(typo).toMatchObject({ step: "did-you-mean", didYouMean: "Hypnotic Robotics" });
    // Words found only in a school or venue aren't a "correction": results, marked fuzzy.
    const venue = await ask("River Dell");
    expect(venue.step).toBe("deterministic");
    expect(venue.didYouMean).toBeUndefined();
    expect(venue.hits.map((h) => h.match)).toEqual(venue.hits.map(() => "fuzzy"));
    expect(refs(venue.hits)).toContain("USNJNEM6"); // its venue is now searchable
  });
  it("lists exact matches before fuzzy ones, naming the word a fuzzy one matched", async () => {
    const a = await ask("oradell");
    for (const h of a.hits) expect(h.match).toBe("fuzzy");
    expect(a.hits.find((h) => h.kind === "team")?.matched).toEqual(["oradell"]);
    const b = await ask("hypnotic");
    expect(b.hits[0]).toMatchObject({ ref: "4215", match: "exact" });
    expect(b.understood).toMatchObject({ kind: "team", label: "Hypnotic Robotics (4215)" });
    expect((await ask("4215")).understood).toMatchObject({ kind: "team", label: "Hypnotic Robotics (4215)" });
  });
});

describe("Greptile on #434", () => {
  it("upcoming and past read each event's own calendar: a meet under way is upcoming, never past", async () => {
    // 02:00 UTC on Nov 3 is still Nov 2 in Los Angeles.
    const late = Date.parse("2026-11-03T02:00:00Z");
    const up = await searchAnswer("upcoming meets in California", { now: late, limit: 25, learn: false });
    expect(refs(up.hits)).toContain("USCALAM");
    const past = await searchAnswer("past meets in California", { now: late, limit: 25, learn: false });
    // No past meet there: the meet under way is only a labelled fallback, never a past answer.
    expect(past.understood?.fallback).toBe("No past league meets in California — showing league meets in California instead");
    expect(refs((await ask("past meets in Texas")).hits)).toEqual(["USTXOLD"]);
    expect(refs((await ask("upcoming meets in Texas")).hits)).toContain("USTXTWO");
  });
  it("league meets are meets, never league tournaments", async () => {
    expect(refs((await ask("league meets in New Jersey")).hits)).not.toContain("USNJLT");
    expect(refs((await ask("league events in New Jersey")).hits)).toContain("USNJLT");
  });
  it("a full state name is a region answer like its code", async () => {
    expect((await ask("New Jersey")).understood).toMatchObject({ kind: "events" });
    expect((await ask("Maryland")).understood?.kind).not.toBe("names");
  });
  it("a region's events come before its teams in the sections", async () => {
    expect(answerSections(await ask("New Jersey")).sections.map((x) => x.id).slice(0, 3)).toEqual(["place", "event", "team"]);
  });
});

describe("the first HTML of /search (Greptile on #434)", () => {
  it("says a fallback is a fallback, beside the badge", async () => {
    const { pageMeta } = await import("../seoMeta");
    const html = (await pageMeta("/search", { q: "meets at Nonexistent High School in New Jersey" })).bodyHtml!;
    expect(html).toContain("No league meets in New Jersey at Nonexistent High School — showing league meets in New Jersey instead");
  });
});

describe("Greptile on #434, round 3", () => {
  it("a team at an event is the team's answer, never a set of events", async () => {
    await run("INSERT INTO event_teams (season, code, team, rank) VALUES (?, 'USNJCMP', 4215, 6)", [S]);
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, 'USNJCMP', 4215, 80, 5)", [S]);
    const a = await ask("hypnotic at New Jersey Championship");
    expect(a.understood?.kind).not.toBe("events");
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "4215" });
  });
  it("a name typed without its spaces is that name, with no correction", async () => {
    const a = await ask("badwolf");
    expect(a.hits[0]).toMatchObject({ ref: "6980", match: "exact" });
    expect(a.didYouMean).toBeUndefined();
  });
});

describe("a state's championships, every season (owner report: \"new jesey states\")", () => {
  beforeAll(async () => {
    // Last season's championship with its two divisions, and one four seasons ago: none on record for the two between.
    for (const [season, code, name, start] of [
      [S - 1, "USNJCMP", "New Jersey Championship", "2026-03-15"], [S - 1, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "2026-03-15"],
      [S - 1, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "2026-03-15"], [S - 4, "USNJCMP", "New Jersey 3/17/23 State Championship Tournament", "2023-03-17"],
    ] as const) await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', 'Hillsborough HS', 'Hillsborough', 'NJ', 'USA', ?, ?, 'test')", [season, code, name, start, start]);
    await rebuildSearch();
  });
  const order = ["USNJCMP", "USNJCMP", "USNJCMPPKWY", "USNJCMPTRPK", "USNJCMP"];
  const seasons = [S, S - 1, S - 1, S - 1, S - 4];
  it("brief test 21: the same set in the same order, newest season first, the current season's on top", async () => {
    for (const q of ["new jesey states", "nj states", "new jersey state championship", "NJ State Championship", "NJ state champs"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.didYouMean, q).toBeUndefined();
      const ev = a.hits.filter((h) => h.kind === "event");
      expect(refs(ev), q).toEqual(order);
      expect(ev.map((h) => h.season), q).toEqual(seasons);
      expect(a.understood?.label, q).toMatch(/^(?:State c|C)hampionships in New Jersey(?: \(from "new jesey"\))?, every season, none on record for /);
    }
  });
  it("a near miss of the place is said as read, never a did-you-mean to an event", async () => {
    const a = await ask("new jesey states");
    expect(a.understood).toMatchObject({ kind: "events", place: { key: "USA:NJ" } });
    expect(a.understood?.label).toBe(`State championships in New Jersey (from "new jesey"), every season, none on record for 2024–25, 2023–24`.replace("2024–25", `${S - 2}–${String(S - 1).slice(2)}`).replace("2023–24", `${S - 3}–${String(S - 2).slice(2)}`));
  });
  it("a year or a season still scopes it; 'states' is never 'stats'", async () => {
    expect(refs((await ask(`${S - 1}-${String(S).slice(2)} NJ states`)).hits)).toEqual(["USNJCMP", "USNJCMPPKWY", "USNJCMPTRPK"]);
    expect((await ask("nj states")).understood?.label).not.toMatch(/stats/i);
  });
});

describe("Greptile on #450, round 3", () => {
  it("more championships than a page holds: the newest first, how many in all, and the full list linked", async () => {
    for (let i = 0; i < 30; i++) await run("INSERT INTO events (season, code, name, type, venue, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', 'V', 'Austin', 'TX', 'USA', ?, ?, 'test')", [S - (i % 4), `USTXR${i}`, `Texas Region ${i} Championship`, `2026-0${1 + (i % 9)}-01`, `2026-0${1 + (i % 9)}-01`]);
    const a = await ask("tx states");
    expect(a.understood?.total).toBe(30); // never the FIRST Championship held in Houston (above)
    expect(a.understood?.label).toMatch(/, 30 in all \(the full list is on Events\)$/);
    expect((await searchAnswer("tx states", { now, limit: 15, learn: false })).understood?.label).toBe(a.understood?.label); // the same line for any limit
    expect(a.pages[0]).toEqual({ title: "Championships in Texas, each season: Events", href: "/events?region=USA%3ATX&type=Championship" });
  });
});
