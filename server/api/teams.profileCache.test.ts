// A team page's profile is cached by the data version (server/api/teams.ts cachedTeamProfile): a repeat skips its dozen
// reads, a new version or data:settled rebuilds it, a write that moves neither shows within PROFILE_TTL_MS, and each
// team and season is kept apart. teamProfile itself (the pack builder's) always reads fresh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { PROFILE_TTL_MS, cachedTeamProfile, teamProfile } from "./teams";

const rename = (n: number, name: string) => run("UPDATE teams SET name = ? WHERE number = ?", [name, n]);

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  await kvSet("data:version", "v1");
  for (const [n, name] of [[16236, "Alpha"], [11115, "Beta"]] as const)
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'MI', 'USA')", [n, name]);
});
afterEach(() => vi.useRealTimers());

describe("the team profile cache", () => {
  it("reuses a profile until the data version moves", async () => {
    expect((await cachedTeamProfile(16236))?.team.name).toBe("Alpha");
    await rename(16236, "Alpha 2");
    expect((await cachedTeamProfile(16236))?.team.name).toBe("Alpha");
    expect((await teamProfile(16236))?.team.name).toBe("Alpha 2");
    await kvSet("data:version", "v2");
    expect((await cachedTeamProfile(16236))?.team.name).toBe("Alpha 2");
  });

  it("rebuilds when data:settled moves", async () => {
    await cachedTeamProfile(16236);
    await rename(16236, "Alpha 2");
    await kvSet("data:settled", "s1");
    expect((await cachedTeamProfile(16236))?.team.name).toBe("Alpha 2");
  });

  it("shows a write that moves neither within PROFILE_TTL_MS", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await cachedTeamProfile(16236);
    await rename(16236, "Alpha 2");
    vi.setSystemTime(Date.now() + PROFILE_TTL_MS + 1);
    expect((await cachedTeamProfile(16236))?.team.name).toBe("Alpha 2");
  });

  it("keeps each team and season apart, and a missing team stays missing", async () => {
    expect((await cachedTeamProfile(16236))?.team.number).toBe(16236);
    expect((await cachedTeamProfile(11115))?.team.number).toBe(11115);
    expect((await cachedTeamProfile(16236, 2024))?.season).toBe(2024);
    expect(await cachedTeamProfile(424242)).toBeNull();
  });
});
