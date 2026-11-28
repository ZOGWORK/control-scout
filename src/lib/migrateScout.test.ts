// The first-sign-in merge sends at most MIGRATE_MAX_ENTRIES scout entries (the server answers 413 past that,
// which would fail the whole merge): the newest ones. The rest are still queued and go up with the next sync.
import { describe, expect, it } from "vitest";
import { migrateScoutEntries } from "./personal";
import { MIGRATE_MAX_ENTRIES } from "../shared/personal";

describe("migrateScoutEntries", () => {
  it("sends every entry when there are few enough, as they are", () => {
    const few = [{ uuid: "a", updatedAt: 1 }, { uuid: "b", updatedAt: 3 }];
    expect(migrateScoutEntries(few)).toBe(few);
  });
  it("sends only the newest MIGRATE_MAX_ENTRIES of a bigger set", () => {
    const many = Array.from({ length: MIGRATE_MAX_ENTRIES + 50 }, (_, i) => ({ uuid: `e${i}`, updatedAt: i }));
    const sent = migrateScoutEntries(many);
    expect(sent).toHaveLength(MIGRATE_MAX_ENTRIES);
    expect(Math.min(...sent.map((e) => e.updatedAt))).toBe(50);
    expect(many).toHaveLength(MIGRATE_MAX_ENTRIES + 50); // the device's list is untouched
  });
});
