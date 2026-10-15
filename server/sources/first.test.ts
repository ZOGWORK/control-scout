// FIRST GETs: an optional request (data FIRST may no longer serve) skips 5xx retries but still waits out rate limits.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => { process.env.FTC_EVENTS_USERNAME ??= "u"; process.env.FTC_EVENTS_TOKEN ??= "t"; }); // no real request is made: fetch is stubbed
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const answer = (statuses: number[]) => {
  const seen: number[] = [];
  vi.stubGlobal("fetch", async () => { const s = statuses[Math.min(seen.length, statuses.length - 1)]; seen.push(s); return new Response(s === 200 ? "{\"ok\":1}" : "x", { status: s, headers: s === 429 ? { "retry-after": "0" } : {} }); });
  return seen;
};

describe("firstGet(path, optional)", () => {
  it("gives up at once on a 5xx (null)", async () => {
    const { firstGet } = await import("./first");
    const seen = answer([503]);
    expect(await firstGet("/2021/advancement/X", true)).toBeNull();
    expect(seen).toEqual([503]);
  });
  it("retries a 429 and returns the data", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { firstGet } = await import("./first");
    const seen = answer([429, 200]);
    const p = firstGet("/2021/advancement/X", true);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: 1 });
    expect(seen).toEqual([429, 200]);
  });
});
