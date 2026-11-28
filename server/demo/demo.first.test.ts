// Two first visits to the demo at the same moment, on a database that has never had it: one demo user, shared.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { demoAccount, resetDemoCache } from "./demo";

beforeAll(async () => {
  resetDemoCache();
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});

describe("the demo's first visits", () => {
  it("make one demo user, however many arrive together", async () => {
    const [a, b, c] = await Promise.all([demoAccount(), demoAccount(), demoAccount()]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(await all("SELECT id FROM users")).toHaveLength(1);
  });
});
