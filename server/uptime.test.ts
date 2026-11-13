// The /status checks (server/uptime.ts): each service's check, what's recorded, and what GET /api/status answers.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { BOT_STALE_MS, barsOf, beat, recordChecks, runChecks, statusNow } from "./uptime";
import { CHECK_EVERY_MIN, STATUS_BARS, overallOf } from "../src/shared/status";

const SHELL = '<!doctype html><div id="root"></div>';
const okFetch = (cpBody = '{"ok":true}') => async (url: string) => {
  if (url.endsWith("/api/health") && url.includes("scout")) return new Response('{"ready":true}', { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("cp")) return new Response(cpBody, { status: 200 });
  return new Response(SHELL, { status: 200, headers: { "content-type": "text/html" } });
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});

describe("runChecks", () => {
  it("passes every service that answers as it should, and the bot only with a fresh heartbeat", async () => {
    const now = Date.now();
    let rows = await runChecks({ fetchFn: okFetch(), site: "https://scout.test", controlPointUrl: "https://cp.test/api/health", now });
    // A bot that never reported is a gap (no row), never a failure.
    expect(rows.map((r) => [r.service, r.ok])).toEqual([["site", true], ["api", true], ["controlPoint", true]]);
    await beat("bot", now - 60_000);
    rows = await runChecks({ fetchFn: okFetch(), site: "https://scout.test", controlPointUrl: "https://cp.test/api/health", now });
    expect(rows.find((r) => r.service === "bot")!.ok).toBe(true);
    rows = await runChecks({ fetchFn: okFetch('{"ok":false}'), site: "https://scout.test", controlPointUrl: "https://cp.test/api/health", now: now + BOT_STALE_MS });
    expect(rows.filter((r) => !r.ok).map((r) => r.service)).toEqual(["controlPoint", "bot"]);
  });
});

describe("barsOf", () => {
  it("puts each check in its 2-minute slot, leaves gaps empty, and keeps a failed slot failed", () => {
    const now = 10_000_000;
    const step = CHECK_EVERY_MIN * 60_000;
    const bars = barsOf([{ at: now - 1, ok: false }, { at: now - 2, ok: true }, { at: now - step - 1, ok: true }], now);
    expect(bars).toHaveLength(STATUS_BARS);
    expect(bars.at(-1)!.ok).toBe(false);
    expect(bars.at(-2)!.ok).toBe(true);
    expect(bars.at(-3)!.ok).toBe(null);
  });
});

describe("statusNow", () => {
  it("answers each service's newest check and its uptime, and the overall state", async () => {
    const now = Date.now();
    await recordChecks([{ service: "site", ok: true, ms: 5 }, { service: "api", ok: false, ms: 5, reason: "HTTP 502" }], now - 4 * 60_000);
    await recordChecks([{ service: "site", ok: true, ms: 5 }, { service: "api", ok: true, ms: 5 }], now - 60_000);
    const s = await statusNow(now);
    const api = s.services.find((x) => x.key === "api")!;
    expect(api.up).toBe(true);
    expect(api.uptime24h).toBe(50);
    expect(s.services.find((x) => x.key === "bot")!.up).toBe(null);
    expect(s.overall).toBe("up");
  });
  it("overall: partial when some are down, down when none is up, unknown before any check", () => {
    expect(overallOf([{ up: true }, { up: false }])).toBe("partial");
    expect(overallOf([{ up: false }, { up: null }])).toBe("down");
    expect(overallOf([{ up: null }])).toBe("unknown");
  });
});
