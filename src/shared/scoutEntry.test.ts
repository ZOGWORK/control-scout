// The one validator for a scouting entry (audit PRIVATE-F01, PRIVATE-F02): what a write may carry, how a stored
// row with bad values is read, and the dates and summaries built from them.
import { describe, expect, it } from "vitest";
import { CLOCK_SKEW_MS, DEVICE_LATEST, isEntryTimestamp, isoOrBlank, problemSummary, repairScoutEntry, validateScoutEntry } from "./scoutEntry";

const NOW = Date.UTC(2026, 9, 19);
const ok = { uuid: "entry0000001", season: 2025, team: 18360, eventCode: "USCAQ1", matchLabel: "Q1", kind: "match", data: { auto: 3, parked: true, climb: "High" }, notes: "fast", updatedAt: NOW };

describe("validateScoutEntry (writes)", () => {
  it("accepts a good entry, with defaults for absent optional fields", () => {
    expect(validateScoutEntry(ok, NOW)).toEqual({ ok: true, entry: { ...ok, kind: "match", deleted: false } });
    const bare = validateScoutEntry({ uuid: "entry0000002", season: 2025, team: 1, kind: "pit", updatedAt: 0 }, NOW);
    expect(bare).toMatchObject({ ok: true, entry: { notes: "", data: {}, eventCode: null, matchLabel: null } });
  });

  it("timestamps: whole, not negative, no further ahead than the allowed clock skew", () => {
    expect(isEntryTimestamp(NOW + CLOCK_SKEW_MS, NOW)).toBe(true);
    for (const bad of [1e300, NOW + CLOCK_SKEW_MS + 1, 1.5, -1, Number.NaN, Infinity, "1000", null, undefined]) {
      expect(validateScoutEntry({ ...ok, updatedAt: bad }, NOW)).toEqual({ ok: false, uuid: ok.uuid, problem: "bad timestamp" });
    }
    // A reference to another version that isn't a timestamp is let go; the write itself is fine.
    expect(validateScoutEntry({ ...ok, baseUpdatedAt: 1e300, restoredFrom: -3 }, NOW)).toEqual({ ok: true, entry: { ...ok, kind: "match", deleted: false } });
  });

  it("each field's type and bounds, with the reason", () => {
    const why = (over: Record<string, unknown>) => { const c = validateScoutEntry({ ...ok, ...over }, NOW); return c.ok ? "ok" : c.problem; };
    expect(why({ uuid: "short" })).toBe("no valid id");
    expect(why({ season: 1999 })).toBe("bad season");
    expect(why({ team: 0 })).toBe("bad team number");
    expect(why({ team: 1_000_000 })).toBe("bad team number");
    expect(why({ kind: "other" })).toBe("bad kind");
    expect(why({ notes: { invalid: "object" } })).toBe("notes not text");
    expect(why({ notes: 3 })).toBe("notes not text");
    expect(why({ data: [1] })).toBe("answers not values");
    expect(why({ data: "x" })).toBe("answers not values");
    expect(why({ data: { a: { b: 1 } } })).toBe("answers not values");
    expect(why({ data: { a: Number.NaN } })).toBe("answers not values");
    expect(why({ data: { a: "x".repeat(20_001) } })).toBe("answers too long");
    expect(why({ eventCode: 5 })).toBe("bad event or match");
    expect(why({ matchLabel: {} })).toBe("bad event or match");
    expect(validateScoutEntry("nope", NOW)).toEqual({ ok: false, uuid: "", problem: "not an entry" });
    // Long text is cut, as it always was; a null answer is dropped.
    const long = validateScoutEntry({ ...ok, notes: "n".repeat(5000), eventCode: "E".repeat(40), data: { a: null, b: 1 } }, NOW);
    expect(long).toMatchObject({ ok: true, entry: { data: { b: 1 } } });
    expect(long.ok && long.entry.notes.length).toBe(4000);
    expect(long.ok && long.entry.eventCode!.length).toBe(24);
  });
});

describe("repairScoutEntry (stored rows)", () => {
  it("a good row comes back unchanged, unknown fields kept", () => {
    const row = { ...ok, photos: [], authorDisplayName: "Priya" };
    expect(repairScoutEntry(row, DEVICE_LATEST)).toEqual({ entry: row, repaired: [] });
  });

  it("repairs only the bad fields, keeping what they said", () => {
    const r = repairScoutEntry({ ...ok, notes: { invalid: "object" }, updatedAt: 1e300, data: { auto: 3, odd: [1, 2] }, eventCode: 7, editorDisplayName: { x: 1 }, baseUpdatedAt: 1e300 }, DEVICE_LATEST)!;
    expect(r.entry).toMatchObject({ notes: '{"invalid":"object"}', updatedAt: 0, data: { auto: 3, odd: "[1,2]" }, eventCode: "7", editorDisplayName: '{"x":1}' });
    expect("baseUpdatedAt" in r.entry).toBe(false);
    expect(r.repaired.sort()).toEqual(["baseUpdatedAt", "data", "eventCode", "names", "notes", "updatedAt"]);
    expect(repairScoutEntry({ ...ok, data: "nope" }, DEVICE_LATEST)).toMatchObject({ entry: { data: {} }, repaired: ["data"] });
  });

  it("a row with no usable identity is skipped (null), never guessed", () => {
    for (const bad of [null, "x", [], { ...ok, uuid: 5 }, { ...ok, team: "abc" }, { ...ok, kind: "both" }, { ...ok, season: 1 }]) expect(repairScoutEntry(bad, DEVICE_LATEST)).toBeNull();
  });

  it("the device reads with a far horizon (a wrong clock never repairs good rows); the server with its own clock", () => {
    const ahead = { ...ok, updatedAt: NOW + 30 * 86_400_000 };
    expect(repairScoutEntry(ahead, DEVICE_LATEST)!.repaired).toEqual([]);
    expect(repairScoutEntry(ahead, NOW + CLOCK_SKEW_MS)!.entry.updatedAt).toBe(0);
  });
});

describe("helpers", () => {
  it("isoOrBlank never throws", () => {
    expect(isoOrBlank(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(isoOrBlank(1e300)).toBe("");
    expect(isoOrBlank(Number.NaN)).toBe("");
    expect(isoOrBlank("x")).toBe("");
  });
  it("problemSummary: most common first", () => {
    expect(problemSummary(["bad kind", "notes not text", "notes not text"])).toBe("notes not text (2), bad kind (1)");
  });
});
