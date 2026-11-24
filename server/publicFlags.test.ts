// The flags every page carries in its head (server/seo.ts flagsBlock, marked fresh for the app): one snapshot, and a
// switch flipped drops every kept page, so no visitor starts with the old value marked confirmed.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { flagWrites, invalidateFlags, setFlag } from "./flags";
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
});
