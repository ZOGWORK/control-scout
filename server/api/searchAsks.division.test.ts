// A championship division's awards are its championship's (FIRST posts them on the parent event), and an event named
// is the newest one whose name fits best, never an older event with a longer, similar name (launch audit D1).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";
import { bestEventHit, regionsSpelled } from "./searchAsks";
import type { SearchHit } from "../../src/shared/api";

const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[7149, "ENFORCERS"], [23314, "Galactic Pigeon"], [4215, "Hypnotic Robotics"], [6980, "Bad Wolf"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
  }
  const ev = (season: number, code: string, name: string, start: string, division: string | null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', ?, 'Town', 'NJ', 'USA', ?, ?, 't')", [season, code, name, division, start, start]);
  await ev(2025, "USNJCMP", "New Jersey Championship", "2026-03-15", null);
  await ev(2025, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "2026-03-15", "USNJCMP");
  await ev(2025, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "2026-03-15", "USNJCMP");
  await ev(2024, "USNJCMP", "New Jersey Championship", "2025-03-15", null);
  await ev(2024, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "2025-03-15", "USNJCMP");
  await ev(2020, "USNJMKCT1", "NJ FTC New Jersey State Championship HYBRID", "2021-06-08", null);
  await ev(2020, "USNJMKCT1PKWY", "NJ FTC New Jersey State Championship HYBRID - Parkway Division", "2021-06-08", "USNJMKCT1");
  // The championship's judged awards are posted on the championship; the divisions have none of their own.
  await run(`INSERT INTO awards (season, code, type, placement, team, name) VALUES
    (2025, 'USNJCMP', 'Control', 1, 7149, 'Control Award'), (2025, 'USNJCMP', 'Control', 2, 23314, 'Control Award'),
    (2025, 'USNJCMP', 'Inspire', 1, 4215, 'Inspire Award'), (2024, 'USNJCMP', 'Control', 1, 6980, 'Control Award'), (2020, 'USNJMKCT1', 'Inspire', 1, 6980, 'Inspire Award')`);
  await rebuildSearch();
});

describe("a division's awards", () => {
  it("are read from its championship, named with the event and season", async () => {
    for (const q of ["who won control award at NJ championship Turnpike in 2025-26", "who got the control award at nj championship turnpike"]) {
      const a = await ask(q);
      expect(a.card, q).toMatchObject({ kind: "event-awards", award: "Control", event: { season: 2025, code: "USNJCMP" } });
      expect(a.card!.lines[0], q).toMatchObject({ text: expect.stringContaining("7149"), results: ["Winner"] });
      expect(a.card!.note, q).toContain("New Jersey Championship - Turnpike Division is a division of New Jersey Championship");
      expect(a.card!.none, q).toBeUndefined();
      expect(a.understood?.label, q).toMatch(/2025–26/);
      // The result under the card is the championship, whose Awards tab holds the award.
      expect(a.hits[0], q).toMatchObject({ ref: "2025:USNJCMP", section: "awards" });
    }
  });
  it("an older season asked reads that season's championship, and never says the newer one has none posted", async () => {
    const a = await ask("who won control award at nj championship turnpike in 2024-25");
    expect(a.card).toMatchObject({ award: "Control", event: { season: 2024, code: "USNJCMP" } });
    expect(a.card!.lines[0].text).toContain("6980");
    expect(a.understood?.label).not.toMatch(/no award posted|isn't held/);
  });
  it("an event named is the newest that fits its name best, never an older one with a longer name", async () => {
    const a = await ask("who won Inspire at NJ Championship Parkway Division");
    expect(a.card).toMatchObject({ award: "Inspire", event: { season: 2025, code: "USNJCMP" } });
    expect(a.card!.lines[0].text).toContain("4215");
    const hit = (season: number, title: string): SearchHit => ({ kind: "event", ref: `${season}:X${season}`, title, subtitle: "", season });
    const older = hit(2020, "NJ FTC New Jersey State Championship HYBRID - Parkway Division"), newer = hit(2025, "New Jersey Championship - Parkway Division");
    expect(bestEventHit("nj championship parkway division", [older, newer])).toBe(newer);
    // An event's code fits no name: search's own first hit stays, never a newer event it happens to find too.
    const q1 = hit(2024, "Garden State Qualifier"), q10 = hit(2025, "Shore Qualifier");
    expect(bestEventHit("USNJQ1", [q1, q10])).toBe(q1);
    // A two-letter word typed in lowercase ("in") is a word, not a state code (Indiana).
    expect(regionsSpelled("meet in houston or me")).toBe("meet in houston or me");
    expect(regionsSpelled("nj championship")).toBe("New Jersey championship");
    // An event the visitor follows leads its equally fitting namesakes.
    const old = hit(2024, "Shore Qualifier"), cur = hit(2025, "Shore Qualifier");
    expect(bestEventHit("shore qualifier", [cur, old], new Set(["event:2024:X2024"]))).toBe(old);
    expect(bestEventHit("shore qualifier", [old, cur])).toBe(cur);
  });
});
