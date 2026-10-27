// The FTC New Jersey events page (a saved copy from 2026-10-27): every event, its details and its registered
// teams, and how each lands on FIRST's event codes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchNjEvents, pageLines, pageSeason, parseNjEvents, type FirstNjEvent } from "./ftcnj";

const html = readFileSync(fileURLToPath(new URL("./fixtures/ftcnj-upcoming-2026-10-27.html", import.meta.url)), "utf8");
const events = parseNjEvents(html, 2026);
const on = (date: string) => events.filter((e) => e.date === date);

describe("FTC NJ events page", () => {
  it("reads the season from the welcome line", () => {
    expect(pageSeason(pageLines(html))).toBe(2026);
  });

  it("finds all 30 meets and tournaments, dated by month (the page's 'Dec. 12, 2027' is 2026)", () => {
    expect(events).toHaveLength(30);
    expect(events[0].date).toBe("2026-10-31");
    expect(events.at(-1)!.date).toBe("2027-02-28");
    expect(on("2026-12-12")).toHaveLength(1);
    expect(new Set(events.map((e) => e.date)).size).toBe(30);
  });

  it("reads a meet's details", () => {
    const [e] = on("2026-10-31");
    expect(e).toMatchObject({
      league: "Central", hosts: "Teams 8421 Tigers & 24419 TIgers.exe", venue: "Timothy Christian School",
      address: "13 Ethel Road, Piscataway, NJ 08854", capacity: "24", closed: false,
    });
    expect(e.schedule).toEqual(["Team Check In - 8:30am-9:00am", "All teams must be in inspection by 9:00am", "Day Ends 4:30pm"]);
    expect(e.notes).toEqual(["This event will offer 6 qualification matches!", "There will be no elimination matches"]);
    expect(e.teams).toHaveLength(16);
    expect(e.teams[0]).toEqual({ team: 3944, name: "Team Mercury", status: "registered", session: null });
  });

  it("reads tournaments whose title runs onto a second line, nicknames and closed events", () => {
    const [lt] = on("2027-02-07");
    expect(lt).toMatchObject({ league: "Central", nickname: "Snow Day Showdown", venue: "Hightstown High School", address: "25 Leshin Lane, Hightstown, NJ" });
    expect(lt.title).toMatch(/Central Conference, Central League Tournament/);
    // "W Central/Bergen Conference, Northeast League Tournament": the league is the one before "League".
    expect(on("2027-02-06")[0].league).toBe("Northeast");
    // "FTCNJ Deep South Conference" with "Southern League Tournament (Sunday)" on the next line, no comma.
    expect(on("2027-02-14")[0]).toMatchObject({ league: "Southern", title: "FTCNJ Deep South Conference Southern League Tournament (Sunday)" });
    expect(on("2027-01-10")[0].hosts).toBe("Teams 9848--GearView; 12441--C.V.T.D.; 15458--Green Machine; 20204--Charging Pioneers; 20205--Chaotic Pioneers");
    expect(events.every((e) => e.league && e.venue && e.address && e.teams.length)).toBe(true);
    expect(on("2026-12-05")[0].closed).toBe(true);
    expect(on("2027-01-10")[0]).toMatchObject({ closed: true, venue: "Clearview Regional High School", address: "625 Breakneck Rd, Mullica Hill NJ" });
  });

  it("keeps AM/PM sessions and the waitlist apart, and lists a team once", () => {
    const [e] = on("2026-11-07");
    expect(e.capacity).toBe("14 / 14");
    expect(e.schedule).toContain("AM Session: 8:00 AM - 12:00 PM");
    expect(e.teams.filter((t) => t.session === "AM")).toHaveLength(8);
    expect(e.teams.filter((t) => t.session === "PM")).toHaveLength(6);
    expect(e.teams.filter((t) => t.status === "pending").map((t) => t.team)).toEqual([4215, 6980, 8902, 11124, 23314, 23717, 33950, 36142]);
    // Feb 20 lists 19772 twice.
    const feb20 = on("2027-02-20")[0].teams.map((t) => t.team);
    expect(feb20.filter((t) => t === 19772)).toHaveLength(1);
    // "26952--" has no name; "11124-AngelBots" has one dash.
    expect(on("2027-01-10")[0].teams.find((t) => t.team === 26952)?.name).toBeNull();
    expect(on("2027-01-24")[0].teams.find((t) => t.team === 11124)?.name).toBe("AngelBots");
  });

  it("reads another season's page as that season (the sync then skips it)", () => {
    expect(pageSeason(pageLines(html.replaceAll("2026/2027", "2027/2028")))).toBe(2027);
    expect(pageSeason(pageLines("<p>Upcoming events</p>"))).toBeNull();
  });
});

describe("matching FIRST's events", () => {
  const first: FirstNjEvent[] = [
    { code: "USNJCENM7", name: "P1-3 Central League Meet", type: "LeagueMeet", league: "CEN", start: "2026-10-31" },
    { code: "USNJNEM2", name: "P1-5 AM Northeast League Meet", type: "LeagueMeet", league: "NE", start: "2026-11-07" },
    { code: "USNJNEM3", name: "P1-5 PM Northeast League Meet", type: "LeagueMeet", league: "NE", start: "2026-11-07" },
    { code: "USNJCENM2", name: "P2-4 AM Central League Meet", type: "LeagueMeet", league: "CEN", start: "2026-11-22" },
    { code: "USNJCENM3", name: "P2-4 PM Central League Meet", type: "LeagueMeet", league: "CEN", start: "2026-11-22" },
    { code: "USNJNELT", name: "West/Central Bergen Conference Northeast League", type: "LeagueTournament", league: "NE", start: "2027-02-06" },
    // Same date, another league: never picked.
    { code: "USNJXX", name: "Somewhere else", type: "LeagueMeet", league: "SO", start: "2026-10-31" },
  ];
  const { matched, unmatched } = matchNjEvents(events, first);
  const by = new Map(matched.map((m) => [m.code, m]));

  it("matches by date and league", () => {
    expect(by.get("USNJCENM7")!.teams).toHaveLength(16);
    expect(by.get("USNJNELT")!.event.date).toBe("2027-02-06");
    expect(by.has("USNJXX")).toBe(false);
    expect(unmatched).toHaveLength(30 - 4);
  });

  it("gives each session its own teams, and pending teams to both", () => {
    const am = by.get("USNJNEM2")!, pm = by.get("USNJNEM3")!;
    expect(am.sessionUnknown).toBe(false);
    expect(am.teams.filter((t) => t.status === "registered")).toHaveLength(8);
    expect(pm.teams.filter((t) => t.status === "registered")).toHaveLength(6);
    expect(am.teams.filter((t) => t.status === "pending")).toHaveLength(8);
    expect(pm.teams.filter((t) => t.status === "pending")).toHaveLength(8);
  });

  it("an AM/PM event the page doesn't split: both sessions get the list, marked unknown", () => {
    expect(by.get("USNJCENM2")).toMatchObject({ sessionUnknown: true });
    expect(by.get("USNJCENM3")!.teams).toHaveLength(13);
  });
});
