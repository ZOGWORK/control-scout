// Highlights searches that named an event or a country's championships and found nothing (failed-search issues
// #1420, #1443, #1436): an event's whole stored name with a word search reads only inside a longer phrase ("fit" of
// "best fit"), a word after an event that nearly spells a word of its division's stored name, and a country with only
// a championship word after it (its championships, as a state's is).
import { describe, expect, it } from "vitest";
import { buildNames, fold } from "./names";
import { parseQuery, type ParseContext } from "./parse";

const TEAMS = [{ number: 14270, name: "Quantum Robotics", city: "Bucharest", state: "B", country: "Romania", lastPlayed: 2026 }];
const EVENTS = [
  { city: "San Antonio", state: "TX", country: "USA", name: "FiT-Central Texas Regional Championship", code: "USTXCMP4" },
  { city: "Bucharest", state: "B", country: "Romania", name: "Romania Championship", code: "ROCMP" },
  { city: "Bucharest", state: "B", country: "Romania", name: "Romania Championship - VLAICU Division", code: "ROCMPVLC" },
  { city: "Bucharest", state: "B", country: "Romania", name: "Romania Championship - COANDA Division", code: "ROCMPCND" },
  { city: "Toronto", state: "ON", country: "Canada", name: "Ontario Provincial Championship", code: "CAONCMP" },
];
// An event is named when every word typed (a plural as its singular) is a word of one stored name.
const isEvent = async (w: string) => EVENTS.some((e) => { const name = fold(e.name).split(" "); return w.split(" ").every((x) => name.includes(x) || name.includes(x.replace(/s$/, ""))); });
const ctx: ParseContext = { names: buildNames(TEAMS, EVENTS), today: "2026-11-14", isEvent };
const parse = (q: string) => parseQuery(q, ctx);

describe("highlights of an event or a country's championships", () => {
  it("reads an event's whole stored name with a word search reads only inside a phrase", async () => {
    const p = await parse("FiT-Central Texas Regional Championship highlights");
    expect(p.event?.words).toBe("fit central texas regional championship");
    expect(p.place).toBeNull();
    expect(p.leftover).toEqual([]);
    expect(p.intent).toBe("highlights");
  });

  it("reads a word after an event that nearly spells its division's name as that division", async () => {
    const p = await parse("Romania championships highlights vlaciu");
    expect(p.event?.words).toBe("romania championships vlaicu");
    expect(p.leftover).toEqual([]);
    expect(p.complete).toBe(true);
  });

  it("leaves a word no event's name nearly spells unread", async () => {
    const p = await parse("Romania championships highlights zebra");
    expect(p.event?.words).toBe("romania championships");
    expect(p.leftover).toEqual(["zebra"]);
  });

  it("reads a country with only a championship word after it as its championships", async () => {
    for (const q of ["usa champs highlights", "canada championship highlights"]) {
      const p = await parse(q);
      expect(p.place?.kind, q).toBe("country");
      expect(p.states, q).toBe(true);
      expect(p.complete, q).toBe(true);
    }
  });
});
