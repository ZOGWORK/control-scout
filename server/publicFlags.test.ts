// The flags every page carries in its head (server/seo.ts flagsBlock, marked fresh for the app): one snapshot, and a
// switch flipped drops every kept page, so no visitor starts with the old value marked confirmed.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { allFlags, flagWrites, invalidateFlags, setFlag } from "./flags";
import { keptCounts, keptPage } from "./api/searchReads";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  invalidateFlags();
});

describe("the flags a shared page carries", () => {
  it("a switch flipped drops the kept pages (each carried the old flags in its head)", async () => {
    await keptPage("/teams/4215", async () => "<html>");
    expect(keptCounts().pages).toBeGreaterThan(0);
    const before = flagWrites();
    await setFlag("brunoSearch", true, "test");
    expect(flagWrites()).toBe(before + 1);
    expect(keptCounts().pages).toBe(0);
  });
  it("a switch flipped on another server: this one's next read sees it and drops its kept pages too", async () => {
    const now = Date.now();
    await allFlags(now);
    await keptPage("/teams/6980", async () => "<html>");
    const before = flagWrites();
    // Another server's write: the row changes under this one, which only notices on its next read.
    await run("INSERT INTO feature_flags (name, enabled, updated_at, updated_by) VALUES ('brunoSearch', 0, ?, 'other') ON CONFLICT (name) DO UPDATE SET enabled = 0", [new Date().toISOString()]);
    expect(keptCounts().pages).toBeGreaterThan(0);
    await allFlags(now + 24 * 3600_000);
    expect(flagWrites()).toBe(before + 1);
    expect(keptCounts().pages).toBe(0);
    // Read again with nothing changed: nothing more goes.
    await keptPage("/teams/6980", async () => "<html>");
    await allFlags(now + 48 * 3600_000);
    expect(flagWrites()).toBe(before + 1);
    expect(keptCounts().pages).toBeGreaterThan(0);
  });
});
