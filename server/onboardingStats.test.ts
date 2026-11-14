// POST /api/collect/onboarding (validation, bots, privacy signals, daily totals) and the owner's funnel.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { onboardingSummary, recordOnboarding } from "./onboardingStats";
import { parseOnboardingBeacon } from "../src/shared/onboardingStats";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
let server: Server;
let base = "";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });
beforeEach(async () => { await run("DELETE FROM onboarding_daily"); });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/collect/onboarding`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", "User-Agent": CHROME, ...headers } });
const rows = () => all<Record<string, unknown>>("SELECT day, event, step, screen, team, count FROM onboarding_daily ORDER BY event, step");

describe("the beacon", () => {
  it("accepts the four moments and nothing else", () => {
    expect(parseOnboardingBeacon({ e: "shown", step: 1, screen: "phone" })).toEqual({ e: "shown", step: 1, team: false, screen: "phone" });
    expect(parseOnboardingBeacon({ e: "reached", step: 3, screen: "desktop" })).toMatchObject({ e: "reached", step: 3 });
    expect(parseOnboardingBeacon({ e: "skipped", step: 1, screen: "tablet" })).toMatchObject({ e: "skipped", step: 1 });
    expect(parseOnboardingBeacon({ e: "finished", step: 4, team: true, screen: "phone" })).toMatchObject({ team: true });
    for (const bad of [null, "x", { e: "opened", step: 1, screen: "phone" }, { e: "shown", step: 2, screen: "phone" }, { e: "reached", step: 1, screen: "phone" },
      { e: "reached", step: 5, screen: "phone" }, { e: "finished", step: 3, screen: "phone" }, { e: "skipped", step: 2, screen: "watch" }, { e: "skipped", step: 1.5, screen: "phone" }]) {
      expect(parseOnboardingBeacon(bad)).toBeNull();
    }
    // A team is only ever a yes/no on finishing: which team is never sent or kept.
    expect(parseOnboardingBeacon({ e: "skipped", step: 2, team: true, screen: "phone" })!.team).toBe(false);
    expect(parseOnboardingBeacon({ e: "finished", step: 4, team: 4215, screen: "phone" })!.team).toBe(false);
  });
});

describe("POST /api/collect/onboarding", () => {
  it("adds 1 to the day's total, with no ID, address or user agent kept", async () => {
    expect((await post({ e: "shown", step: 1, screen: "phone" })).status).toBe(204);
    expect((await post({ e: "shown", step: 1, screen: "phone" })).status).toBe(204);
    expect((await post({ e: "finished", step: 4, team: true, screen: "phone" })).status).toBe(204);
    const r = await rows();
    expect(r.map((x) => [x.event, Number(x.step), Number(x.team), Number(x.count)])).toEqual([["finished", 4, 1, 1], ["shown", 1, 0, 2]]);
    const cols = (await all<{ name: string }>("PRAGMA table_info(onboarding_daily)")).map((c) => c.name).sort();
    expect(cols).toEqual(["count", "day", "event", "screen", "step", "team"]);
  });

  it("refuses what isn't a beacon", async () => {
    expect((await post({ e: "shown", step: 3, screen: "phone" })).status).toBe(400);
    expect((await post("{nope")).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("bots, Global Privacy Control and Do Not Track: accepted, not counted", async () => {
    expect((await post({ e: "shown", step: 1, screen: "phone" }, { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" })).status).toBe(204);
    expect((await post({ e: "shown", step: 1, screen: "phone" }, { "Sec-GPC": "1" })).status).toBe(204);
    expect((await post({ e: "shown", step: 1, screen: "phone" }, { DNT: "1" })).status).toBe(204);
    expect(await rows()).toEqual([]);
  });
});

describe("the owner's funnel", () => {
  it("reached per step (step 1 = shown), skips per step, finished and with a team", async () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const add = async (e: "shown" | "reached" | "skipped" | "finished", step: number, times: number, team = false) => {
      for (let i = 0; i < times; i++) await recordOnboarding({ e, step, team, screen: "phone" }, now);
    };
    await add("shown", 1, 10);
    await add("skipped", 1, 3);
    await add("reached", 2, 7);
    await add("skipped", 2, 1);
    await add("reached", 3, 6);
    await add("reached", 4, 6);
    await add("finished", 4, 4, true);
    await add("finished", 4, 2, false);
    const s = await onboardingSummary(14, now.getTime());
    expect(s).toEqual({ days: 14, shown: 10, reached: [10, 7, 6, 6], skipped: [3, 1, 0, 0], finished: 6, withTeam: 4 });
    // Outside the window: not counted.
    expect((await onboardingSummary(1, now.getTime() + 3 * 86_400_000)).shown).toBe(0);
  });
});
