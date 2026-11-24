// Our own traffic (server/testTraffic.ts): the X-CS-Test header, and the one query a Reproduce link opened.
import { describe, expect, it } from "vitest";
import { isTestTraffic } from "./testTraffic";
import { reproduceUrl } from "./searchFailures";

const req = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] }) as Parameters<typeof isTestTraffic>[0];

describe("isTestTraffic", () => {
  it("is the test header, any value but 0", () => {
    expect(isTestTraffic(req({ "x-cs-test": "1" }), "4215 opr")).toBe(true);
    expect(isTestTraffic(req({ "x-cs-test": "heldout" }), "4215 opr")).toBe(true);
    expect(isTestTraffic(req({ "x-cs-test": "0" }), "4215 opr")).toBe(false);
    expect(isTestTraffic(req({}), "4215 opr")).toBe(false);
  });

  it("is the query a Reproduce link opened, read from the page's Referer", () => {
    const ref = reproduceUrl("Q16 Chicago Meet 2 Westside");
    expect(ref).toBe("https://controlscout.org/search?q=Q16%20Chicago%20Meet%202%20Westside&from=issue");
    expect(isTestTraffic(req({ referer: ref }), "Q16 Chicago Meet 2 Westside")).toBe(true);
    // Case and spacing as the box sends it.
    expect(isTestTraffic(req({ referer: ref }), "q16  chicago meet 2 westside")).toBe(true);
  });

  it("is not what the visitor types next on that page, nor an ordinary search page", () => {
    const ref = reproduceUrl("4215 opr");
    expect(isTestTraffic(req({ referer: ref }), "4215 record")).toBe(false);
    expect(isTestTraffic(req({ referer: "https://controlscout.org/search?q=4215%20opr" }), "4215 opr")).toBe(false);
    expect(isTestTraffic(req({ referer: "not a url" }), "4215 opr")).toBe(false);
  });
});
