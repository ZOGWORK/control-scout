// The page cache: an older reply never replaces newer data (a later request, or "Refresh results" priming).
import { afterEach, describe, expect, it, vi } from "vitest";
import { load, prime } from "./api";

const replies: ((body: unknown) => void)[] = [];
vi.stubGlobal("navigator", { onLine: true });
vi.stubGlobal("fetch", () => new Promise((res) => replies.push((body) => res(new Response(JSON.stringify(body), { status: 200 })))));
afterEach(() => { replies.length = 0; });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("load / prime ordering", () => {
  it("a reload that started before a refresh can't overwrite the refreshed data, and a later reload still lands", async () => {
    const path = "/api/events/2026/X";
    const a = load<{ v: string }>(path, true); // auto reload A goes out
    prime(path, { v: "refreshed" }); // "Refresh results" answers first
    const b = load<{ v: string }>(path, true); // the visibility reload B goes out
    replies[0]({ v: "old" }); // A comes back last-but-one, with older data
    expect(await a).toEqual({ v: "refreshed" });
    replies[1]({ v: "newest" }); // B is newer than the prime
    expect(await b).toEqual({ v: "newest" });
    await flush();
    expect(await load<{ v: string }>(path)).toEqual({ v: "newest" });
  });
});
