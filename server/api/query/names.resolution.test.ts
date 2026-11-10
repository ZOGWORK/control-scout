// Which team a name means (launch audit, Phase E): a name several teams share is picked by the shared rules or asked
// about, a place's name is the place, and ordinary words are words. Fixture names only, none of the audit's teams.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery, type ParseContext } from "./parse";
import { pickShared, STRONGER } from "./shared";
import { asksWhich, onlyOrdinary } from "./ordinary";

const TEAMS = [
  { number: 4101, name: "Copper Comets", city: "Paramus", state: "NJ", country: "USA", lastPlayed: 2025 },
  // One name, two active teams: NJ last season, MI this season. Neither clearly stronger.
  { number: 4201, name: "Prism Bots", city: "Newark", state: "NJ", country: "USA", lastPlayed: 2025, strength: 0.97 },
  { number: 4202, name: "Prism Bots", city: "Lansing", state: "MI", country: "USA", lastPlayed: 2026, strength: 0.93 },
  // One name, two active teams, one far stronger.
  { number: 4301, name: "Gamma Squad", city: "Arad", state: "AR", country: "Romania", lastPlayed: 2025, strength: 0.98 },
  { number: 4302, name: "Gamma Squad", city: "Pasco", state: "WA", country: "USA", lastPlayed: 2026, strength: 0.3 },
  // One name: a team that stopped playing years ago, and one playing now.
  { number: 4401, name: "Old Gears", city: "Austin", state: "TX", country: "USA", lastPlayed: 2019 },
  { number: 4402, name: "Old Gears", city: "Reno", state: "NV", country: "USA", lastPlayed: 2026 },
  // Named after places.
  { number: 4501, name: "Ohio Robotics", city: "Akron", state: "OH", country: "USA", lastPlayed: null },
  { number: 4502, name: "OH", city: "Tripoli", state: "TB", country: "Libya", lastPlayed: null },
  { number: 4503, name: "Romania Placeholder Team", city: "Otopeni", state: "B", country: "Romania", lastPlayed: null },
  // Named only with ordinary words.
  { number: 4601, name: "Never Mind", city: "Town", state: "WA", country: "USA", lastPlayed: 2024 },
  { number: 4602, name: "Quite Early", city: "Town", state: "WA", country: "USA", lastPlayed: 2025 },
  { number: 4603, name: "Monte", city: "Town", state: "BJ", country: "China", lastPlayed: 2025 },
];
const EVENTS = ["river conference", "jersey championship"];
const ctx: ParseContext = {
  names: buildNames(TEAMS, [{ city: "Bucharest", state: "B", country: "Romania" }]),
  today: "2026-11-10",
  isEvent: async (w) => EVENTS.some((e) => e.includes(w) && w.length >= 3 && w.split(" ").length >= 2),
  nearTeam: async (w) => ctx.names.nearTeam(w),
};
const parse = (q: string) => parseQuery(q, ctx);
const numbers = async (q: string) => (await parse(q)).teams.map((t) => t.number);

describe("a name several teams share", () => {
  it("is the one in the same region as the other team named, before the one that played most recently", async () => {
    for (const q of ["copper comets and prism bots opr compare", "prism bots vs copper comets", "copper comets with prism bots matches"]) {
      const t = (await parse(q)).teams.find((x) => x.candidates);
      expect(t, q).toMatchObject({ number: 4201, rule: "the one in the same region as 4101" });
    }
  });
  it("two teams both still playing, neither clearly stronger: no team, never the newest by default", async () => {
    for (const q of ["prism bots opr", "did prism bots choke at states", "prism bots record pls"]) {
      const p = await parse(q);
      expect(p.teams.find((t) => t.candidates)?.rule, q).toBeUndefined();
      expect(p.complete, q).toBe(false);
    }
  });
  it("is the clearly stronger one, or the only one still playing", async () => {
    expect((await parse("gamma squad record")).teams[0]).toMatchObject({ number: 4301, rule: "the stronger one" });
    expect((await parse("old gears opr")).teams[0]).toMatchObject({ number: 4402, rule: "the only one still playing" });
  });
  it("is the one in the place named, or the one whose number is typed beside it", async () => {
    expect((await parse("prism bots michigan record")).teams[0]).toMatchObject({ number: 4202 });
    expect(await numbers("prism bots 4201 record")).toEqual([4201]);
  });
  it("the rule's own order: your team first, then place, region, played, active, stronger", () => {
    const a = { number: 1, state: "NJ", country: "USA", city: null, lastPlayed: 2025, strength: 0.9 };
    const b = { number: 2, state: "MI", country: "USA", city: null, lastPlayed: 2026, strength: 0.9 - STRONGER };
    expect(pickShared([a, b], { mine: (n) => n === 2 })).toMatchObject({ team: b, rule: "your team" });
    expect(pickShared([a, b], {})).toMatchObject({ team: a, rule: "the stronger one" });
    expect(pickShared([a, { ...b, strength: 0.85 }], {})).toEqual({ tied: [a, { ...b, strength: 0.85 }] });
    expect(pickShared([a, { ...b, strength: 0.85 }], { others: [{ number: 9, state: "MI", country: "USA", city: null, lastPlayed: 2026 }] })).toMatchObject({ team: { number: 2 } });
    // A registration that never played names nothing, even in the other team's region: the twin that played is it.
    const unplayed = { ...a, lastPlayed: null };
    expect(pickShared([unplayed, b], { others: [{ number: 9, state: "NJ", country: "USA", city: null, lastPlayed: 2026 }] })).toMatchObject({ team: b, rule: "the only one that has played" });
    // Missing location data is no shared region.
    const noState = { ...a, state: null }, other = { number: 9, state: null, country: "USA", city: null, lastPlayed: 2026 };
    expect(pickShared([noState, { ...b, strength: 0.85 }], { others: [other] })).toEqual({ tied: [noState, { ...b, strength: 0.85 }] });
  });
});

describe("a place's name is the place", () => {
  it("never a team named after it, typed in any case or order", async () => {
    for (const q of ["lowest score ohio last week", "Ohio lowest scoring match last week", "top scoring match OH this week", "best match in ohio this week"]) {
      const p = await parse(q);
      expect(p.teams, q).toEqual([]);
      expect(p.place?.name, q).toBe("Ohio");
    }
    expect((await parse("who has the longest win streak in romania")).teams).toEqual([]);
  });
  it("unless the query calls it a team: its whole name, or 'team' before it", async () => {
    expect(await numbers("ohio robotics record")).toEqual([4501]);
    expect(await numbers("team OH record")).toEqual([4502]);
  });
});

describe("ordinary words are words", () => {
  it("never a team in a question asking which team", async () => {
    for (const q of ["who won inspire at river conference never mind", "which team was quite early at jersey championship"]) {
      expect(await numbers(q), q).toEqual([]);
    }
  });
  it("a team typed as its whole name where a team is asked about", async () => {
    expect(await numbers("never mind record")).toEqual([4601]);
    expect(await numbers("quite early opr")).toEqual([4602]);
  });
  it("never a name typed nearly right", async () => {
    // "month" is one letter from Monte.
    expect((await parse("4101 record this month versus last month")).teams.map((t) => t.number)).toEqual([4101]);
  });
  it("reads ordinary words and which-questions", () => {
    for (const w of ["i forgot", "the average", "lost", "hardest", "actual rank", "worlds"]) expect(onlyOrdinary(w), w).toBe(true);
    for (const w of ["ultraviolet", "copper comets", "4215", "bad wolf"]) expect(onlyOrdinary(w), w).toBe(false);
    expect(asksWhich("who won inspire at east bergen")).toBe(true);
    expect(asksWhich("which division was hardest")).toBe(true);
    expect(asksWhich("4215 opr")).toBe(false);
  });
});
