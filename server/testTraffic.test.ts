// Our own traffic (server/testTraffic.ts): the X-CS-Test header, and the one query a Reproduce link opened.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("is sent by every eval script the header comment names, at each request it makes", () => {
    // scripts/search-*.ts and scripts/search-signoff/*: one that asks a server without it would log its misses as a
    // visitor's (a script added later included). Each fetch or k6 request carries it in its own call, and a script
    // that drives a browser adds it to the site's requests (ctx.route), with no service worker to answer around it.
    const root = join(import.meta.dirname, "..", "scripts");
    const files = [
      ...readdirSync(root).filter((f) => /^search-.*\.(?:ts|mts|js)$/.test(f)).map((f) => join(root, f)),
      ...readdirSync(join(root, "search-signoff")).filter((f) => /\.(?:ts|mts|js)$/.test(f)).map((f) => join(root, "search-signoff", f)),
    ].filter((p) => !/\.test\./.test(p));
    expect(files.length).toBeGreaterThan(3);
    const header = /TEST_HEADER|x-cs-test/i;
    const missing: string[] = [];
    for (const p of files) {
      const name = p.slice(root.length + 1).replace(/\\/g, "/");
      const src = readFileSync(p, "utf8").split("\n");
      src.forEach((l, n) => { if (/\b(?:fetch|http\.(?:get|post|request))\(/.test(l) && !header.test(l)) missing.push(`${name}:${n + 1}`); });
      if (src.some((l) => /\.newContext\(/.test(l))) {
        if (!src.some((l) => /\.route\(/.test(l) && header.test(l))) missing.push(`${name}: browser requests (ctx.route)`);
        if (!src.some((l) => /\.newContext\(/.test(l) && /serviceWorkers: "block"/.test(l))) missing.push(`${name}: service workers not blocked`);
      }
    }
    expect(missing).toEqual([]);
  });
});
