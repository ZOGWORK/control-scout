// "This weekend" (server/api/weekend.ts): the weekend's events and a team's next match, as the page (GET /api/weekend,
// GET /api/teams/:number/next), the team page and search read them. One reading each, so search and the pages never
// list different events, a different match, a different time or a different call. Each event is placed on its own
// calendar; the current season only; none said plainly.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { clearAllCaches } from "../caches";
import { CURRENT_SEASON } from "../data/seasons";
import { createApp } from "../app";
import { searchAnswer } from "./searchAnswer";
import { inWeekend, noEventsLine, teamNextMatch, weekendEvents } from "./weekend";
import { matchViews } from "./matches";
import { eventClock, type NextMatchAnswer, type WeekendAnswer } from "../../src/shared/weekend";
import { weekendWindow } from "../../src/shared/query/time";
import type { StatAnswer } from "../../src/shared/searchStat";

const S = CURRENT_SEASON;
// Saturday 2026-11-14, 18:00 UTC (13:00 in New Jersey, 10:00 in Los Angeles).
const NOW = Date.parse("2026-11-14T18:00:00Z");
const ask = (q: string, now = NOW) => searchAnswer(q, { limit: 25, full: true, learn: false, now });
const codes = (w: WeekendAnswer) => w.events.map((e) => e.code);
const statCodes = (s: StatAnswer | undefined) => (s?.blocks ?? []).flatMap((b) => (b.kind === "links" && b.title?.startsWith("Events") ? b.items : [])).map((l) => /\/events\/\d{4}\/([^?/#]+)/.exec(l.href)?.[1]).filter(Boolean);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev = (season: number, code: string, name: string, type: string, start: string, end: string, city: string, state: string | null, country: string, tz: string | null) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, timezone, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 't')", [season, code, name, type, city, state, country, start, end, tz]);
  // This weekend: a New Jersey meet under way, a Los Angeles qualifier, a Sunday meet in Romania, a Texas meet whose
  // match list isn't posted, and a volunteer sign-up (no event).
  await ev(S, "USNJWM1", "Westfield League Meet", "LeagueMeet", "2026-11-14", "2026-11-14", "Westfield", "NJ", "USA", "America/New_York");
  await ev(S, "USCALAQ", "Los Angeles Qualifier", "Qualifier", "2026-11-14", "2026-11-15", "Los Angeles", "CA", "USA", "America/Los_Angeles");
  await ev(S, "ROBUM", "Bucharest League Meet", "LeagueMeet", "2026-11-15", "2026-11-15", "Bucharest", null, "Romania", "Europe/Bucharest");
  await ev(S, "USTXAUS", "Austin League Meet", "LeagueMeet", "2026-11-14", "2026-11-14", "Austin", "TX", "USA", "America/Chicago");
  await ev(S, "USNJVOL", "Volunteer Sign-up", "VolunteerSignup", "2026-11-14", "2026-11-14", "Union", "NJ", "USA", "America/New_York");
  // Last and next weekend, and a meet on this weekend's dates last season (never this weekend's).
  await ev(S, "USNJLW", "Last Weekend Meet", "LeagueMeet", "2026-11-07", "2026-11-07", "Ramsey", "NJ", "USA", "America/New_York");
  await ev(S, "USNJNW", "Dumont League Meet", "LeagueMeet", "2026-11-21", "2026-11-21", "Dumont", "NJ", "USA", "America/New_York");
  await ev(S - 1, "USNJOLD", "Last Season Meet", "LeagueMeet", "2025-11-15", "2026-11-14", "Oradell", "NJ", "USA", "America/New_York");
  for (const [n, name, state] of [[4215, "Hypnotic Robotics", "NJ"], [6980, "Bad Wolf", "NJ"], [100, "Red One", "NJ"], [200, "Blue Two", "NJ"], [7000, "Next Up", "NJ"], [8000, "Idle Bots", "NJ"], [9000, "Lone Star", "TX"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
  }
  for (const [code, t] of [["USNJWM1", 4215], ["USNJWM1", 6980], ["USNJWM1", 100], ["USNJWM1", 200], ["USNJNW", 7000], ["USTXAUS", 9000], ["USNJNW", 4215]] as const) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, code, t]);
  // At Westfield: Q1 played (4215 won), Q5 at 15:30 New Jersey time, called by the engine.
  const match = async (n: number, time: string, played: boolean, red: number[], blue: number[]) => {
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, 'USNJWM1', 'qual', 0, ?, ?, ?, ?, ?, ?, ?, ?, 't')`,
      [S, n, `Q${n}`, time, played ? 1 : 0, played ? 120 : null, played ? 120 : null, played ? 80 : null, played ? 80 : null]);
    for (const [t, a] of [...red.map((t) => [t, "red"] as const), ...blue.map((t) => [t, "blue"] as const)]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'USNJWM1', 'qual', 0, ?, ?, ?, 1)", [S, n, t, a]);
  };
  await match(1, "2026-11-14T10:00:00", true, [4215, 100], [6980, 200]);
  await match(5, "2026-11-14T15:30:00", false, [4215, 6980], [100, 200]);
  await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at)
    VALUES ('live', ?, 'USNJWM1', 'qual', 0, 5, '[4215,6980]', '[100,200]', 0.64, 131, 112, 'moderate', 'x', '2026-11-14T12:00:00Z')`, [S]);
  await rebuildSearch();
  clearAllCaches();
});
afterEach(() => vi.useRealTimers());

describe("the weekend's events", () => {
  it("this weekend: the current season's events of the weekend, each on its own calendar; no sign-ups", async () => {
    const w = await weekendEvents({ now: NOW });
    expect(w.season).toBe(S);
    expect(w.window).toMatchObject(weekendWindow("this", "2026-11-14"));
    expect(codes(w).sort()).toEqual(["ROBUM", "USCALAQ", "USNJWM1", "USTXAUS"]);
    const nj = w.events.find((e) => e.code === "USNJWM1")!;
    expect(nj).toMatchObject({ name: "Westfield League Meet", type: "LeagueMeet", place: expect.stringContaining("Westfield"), dates: expect.any(String), teams: 4, status: "live", href: `/events/${S}/USNJWM1` });
    expect(w.events.find((e) => e.code === "USTXAUS")!.status).not.toBe("finished");
  });
  it("last and next weekend are search's own windows", async () => {
    expect(codes(await weekendEvents({ which: "last", now: NOW }))).toEqual(["USNJLW"]);
    expect(codes(await weekendEvents({ which: "next", now: NOW }))).toEqual(["USNJNW"]);
  });
  it("a place as Rankings takes it: a state, or a whole country", async () => {
    expect(codes(await weekendEvents({ region: "USA:NJ", now: NOW }))).toEqual(["USNJWM1"]);
    expect(codes(await weekendEvents({ region: "Romania", now: NOW }))).toEqual(["ROBUM"]);
    expect((await weekendEvents({ region: "USA:NJ", now: NOW })).region).toMatchObject({ key: "USA:NJ" });
  });
  it("a Sunday evening in Los Angeles is still its weekend, when UTC's has moved on", () => {
    // 05:00 UTC Monday is 21:00 Sunday in Los Angeles.
    const late = Date.parse("2026-11-16T05:00:00Z");
    expect(inWeekend({ start: "2026-11-15", end: "2026-11-15", timezone: "America/Los_Angeles" }, "this", late)).toBe(true);
    expect(inWeekend({ start: "2026-11-15", end: "2026-11-15", timezone: null }, "this", late)).toBe(false);
  });
  it("a calendar ahead waits: Monday in Sydney doesn't move its next meet into this weekend", () => {
    // 23:00 UTC Sunday is 10:00 Monday in Sydney.
    const sun = Date.parse("2026-11-15T23:00:00Z");
    const sydney = { start: "2026-11-21", end: "2026-11-22", timezone: "Australia/Sydney" };
    expect(inWeekend(sydney, "this", sun)).toBe(false);
    expect(inWeekend(sydney, "next", sun)).toBe(true);
    // The reader's own date decides the weekend shown: a reader already on Monday has next weekend's events as this.
    expect(inWeekend(sydney, "this", sun, "2026-11-16")).toBe(true);
  });
  it("none said plainly, the place named", async () => {
    expect(noEventsLine("this", null)).toBe("No FTC events this weekend.");
    expect(noEventsLine("next", { name: "Romania" })).toBe("No FTC events next weekend in Romania.");
    expect((await weekendEvents({ region: "USA:MA", now: NOW })).events).toEqual([]);
  });
});

describe("a team's next match", () => {
  it("its next match this weekend: the event, the time on the event's clock, alliance, partners, opponents, the logged call", async () => {
    const a = await teamNextMatch(4215, NOW);
    expect(a.kind).toBe("match");
    expect(a.match).toMatchObject({ code: "USNJWM1", label: "Q5", event: "Westfield League Meet", alliance: "red", timezone: "America/New_York", played: false });
    expect(a.match!.partners.map((t) => t.number)).toEqual([6980]);
    expect(a.match!.opponents.map((t) => t.number).sort()).toEqual([100, 200]);
    expect(eventClock(a.match!.startsAt, a.match!.timezone)).toBe("Sat, 3:30 PM EST");
    // The engine's call is the match list's (the same the event page shows).
    const view = (await matchViews({ season: S, team: 4215 }, { predictUnplayed: true })).find((m) => m.label === "Q5")!;
    expect(a.match!.prediction).toMatchObject({ chance: view.prediction!.pRed, tier: view.prediction!.tier, ownMean: view.prediction!.redMean, oppMean: view.prediction!.blueMean });
  });
  it("a played match shows its score, never a time", async () => {
    const a = await teamNextMatch(4215, NOW);
    expect(a.played).toHaveLength(1);
    expect(a.played[0]).toMatchObject({ label: "Q1", played: true, time: null, startsAt: null, score: { own: 120, opp: 80, result: "W" } });
    expect(a.played[0].prediction).toBeUndefined();
  });
  it("an event this weekend with no match list posted says so", async () => {
    expect(await teamNextMatch(9000, NOW)).toMatchObject({ kind: "no-schedule", event: { code: "USTXAUS" }, line: "Austin League Meet is this weekend: its match list isn't posted yet." });
  });
  it("its matches there played or the next one late: no more listed, never \"not posted\" (Loopy, #1581)", async () => {
    // 17:00 in New Jersey: Q5 (15:30) is over half an hour late with no result.
    const a = await teamNextMatch(4215, Date.parse("2026-11-14T22:00:00Z"));
    expect(a).toMatchObject({ kind: "no-schedule", event: { code: "USNJWM1" }, line: "No more matches listed for 4215 at Westfield League Meet yet." });
    expect(a.played.map((m) => m.label)).toEqual(["Q1"]);
  });
  it("no match this weekend: its next event, linked", async () => {
    const a = await teamNextMatch(7000, NOW);
    expect(a).toMatchObject({ kind: "next-event", event: { code: "USNJNW", href: `/events/${S}/USNJNW?team=7000` } });
    expect(a.line).toMatch(/^No matches this weekend — next event is Dumont League Meet on Nov 21/);
  });
  it("no upcoming event: said plainly", async () => {
    expect((await teamNextMatch(8000, NOW)).line).toMatch(/^No matches this weekend — 8000 has no upcoming event in /);
  });
});

describe("search answers from the same readings", () => {
  it("the weekend's events, however it's asked, are the page's", async () => {
    const page = (await weekendEvents({ now: NOW })).events.map((e) => e.code).sort();
    for (const q of ["what FTC events are happening this weekend", "events this weekend", "what's on this weekend", "ftc events this weekend", "anything happening this weekend", "what's happening in ftc this weekend"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("weekend-events");
      expect(a.sorry, q).toBeUndefined();
      expect([...new Set(statCodes(a.stat))].filter((c) => page.includes(c!)).sort(), q).toEqual(page);
    }
  });
  it("meets this weekend, in a place: the page's with that place and kind", async () => {
    const page = (await weekendEvents({ region: "USA:NJ", types: ["LeagueMeet"], now: NOW })).events.map((e) => e.code);
    for (const q of ["meets this weekend in New Jersey", "events this weekend in New Jersey", "league meets in NJ this weekend"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("weekend-events");
      expect([...new Set(statCodes(a.stat))].filter((c) => !c!.startsWith("USNJNW")), q).toEqual(page);
    }
  });
  it("today and tomorrow, each event on its own calendar", async () => {
    for (const q of ["events today", "what's on today", "ftc events happening today"]) {
      const a = await ask(q);
      expect(a.stat?.intent, q).toBe("weekend-events");
      expect(statCodes(a.stat).sort(), q).toEqual(["USCALAQ", "USNJWM1", "USTXAUS"]);
    }
    expect(statCodes((await ask("events tomorrow")).stat).sort()).toEqual(["ROBUM", "USCALAQ"]);
  });
  it("next weekend, however it's asked", async () => {
    expect(statCodes((await ask("next weekend")).stat)).toContain("USNJNW");
    expect(statCodes((await ask("what events are on next weekend")).stat)).toEqual(["USNJNW"]);
  });
  it("a weekend with nothing: \"No FTC events this weekend.\", never sorry", async () => {
    const a = await ask("events this weekend in Massachusetts");
    expect(a.sorry).toBeUndefined();
    expect(a.stat?.none ?? a.understood?.label).toMatch(/^No FTC events this weekend in Massachusetts\.$/);
  });
  it("a team's next match is the page's: the same match, time and call", async () => {
    // Search's own moment (`now`), never the clock it runs at (Loopy, #1581).
    const page = await teamNextMatch(4215, NOW);
    for (const q of ["what's 4215's next match this weekend", "4215 next match", "hypnotic robotics next match", "when is 4215's next match"]) {
      const card = (await ask(q)).card!;
      expect(card.kind, q).toBe("next-match");
      expect(card.lines[0].text, q).toBe(`${page.match!.label} at ${page.match!.event}`);
      expect(card.lines[0].detail, q).toContain(eventClock(page.match!.startsAt, page.match!.timezone));
      expect(card.lines[0].detail, q).toContain(`${Math.round(page.match!.prediction!.chance * 100)}% to win`);
      expect(card.lines[0].href, q).toBe(page.match!.href);
    }
  });
  it("asked of this weekend with no match: the pages' line, the next event linked", async () => {
    const card = (await ask("what's 7000's next match this weekend")).card!;
    expect(card.none).toBe((await teamNextMatch(7000, NOW)).line);
    expect(card.closest?.[0]).toMatchObject({ text: "Dumont League Meet", href: `/events/${S}/USNJNW?team=7000` });
  });
});

describe("the routes the page reads", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  it("GET /api/weekend and /api/teams/:number/next are the readings search answers from", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const w = (await (await fetch(`${base}/api/weekend?region=USA%3ANJ`)).json()) as WeekendAnswer;
    expect(codes(w)).toEqual(codes(await weekendEvents({ region: "USA:NJ", now: NOW })));
    const n = (await (await fetch(`${base}/api/teams/4215/next`)).json()) as NextMatchAnswer;
    expect(n.match?.label).toBe("Q5");
    expect((await fetch(`${base}/api/weekend?which=someday`)).status).toBe(400);
    // An impossible date is no reader's date: UTC's is used (Loopy, #1581).
    const odd = await fetch(`${base}/api/weekend?today=2026-13-45`);
    expect(odd.status).toBe(200);
    expect(((await odd.json()) as WeekendAnswer).window).toMatchObject(weekendWindow("this", "2026-11-14"));
  });
});
