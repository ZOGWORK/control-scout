// Which pages are kept whole and under what key (server/pageCache.ts), and that the HTML route serves a kept page
// gzipped once, with its CSP, and never for a personal or unlisted address.
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "./db";
import { rebuildSearch } from "./stats/job";
import { createApp } from "./app";
import { clearAllCaches } from "./caches";
import { CACHED_PAGE, pageKey } from "./pageCache";
import { keptCounts } from "./api/searchReads";

describe("which pages are kept", () => {
  it("keeps team, event, search and home pages", () => {
    for (const p of ["/", "/teams/4215", "/events/2025/USNJNOLT2", "/events/2025/usnjnolt2", "/search"]) expect(CACHED_PAGE.test(p), p).toBe(true);
  });
  it("leaves every other page to be drawn each time", () => {
    for (const p of ["/owner", "/scout", "/rankings", "/events", "/teams", "/predict", "/events/2025/USNJNOLT2/display", "/events/2025/X/match/qual:0:1", "/compare", "/me"]) expect(CACHED_PAGE.test(p), p).toBe(false);
  });
  it("keys a page by its path and sorted query", () => {
    expect(pageKey("/teams/4215/", {})).toBe("/teams/4215");
    expect(pageKey("/search", { q: "4215 opr" })).toBe("/search?q=4215%20opr");
    expect(pageKey("/teams/4215", { x: "1", season: "2025" })).toBe(pageKey("/teams/4215", { season: "2025", x: "1" }));
    expect(pageKey("/teams/4215", { season: "2025" })).not.toBe(pageKey("/teams/4215", { season: "2024" }));
  });
});

describe("the HTML route", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    clearAllCaches();
    const dist = mkdtempSync(join(tmpdir(), "cs-pages-"));
    writeFileSync(join(dist, "index.html"), `<!doctype html><html><head><title>x</title></head><body><div id="root"></div><script>1</script></body></html>`);
    server = createApp({ dist }).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server?.close(); });

  it("serves a kept page with its CSP, and draws it once", async () => {
    const before = keptCounts().pages;
    // No such team in an empty database: the app's not-found page (404), kept like any other.
    const a = await fetch(`${base}/teams/4215`);
    expect(a.status).toBe(404);
    expect(a.headers.get("content-type")).toContain("text/html");
    expect(a.headers.get("vary")).toContain("Accept-Encoding");
    expect(a.headers.get("etag")).toBeTruthy();
    expect(a.headers.get("content-security-policy") ?? a.headers.get("content-security-policy-report-only")).toContain("script-src");
    const html = await a.text();
    expect(html).toContain(`<div id="root">`);
    expect(keptCounts().pages).toBe(before + 1);
    const b = await fetch(`${base}/teams/4215`);
    expect(await b.text()).toBe(html);
    expect(keptCounts().pages).toBe(before + 1);
  });

  const raw = (path: string, enc: string, more: Record<string, string> = {}) => new Promise<{ status: number; etag: string | undefined; encoding: string | undefined; body: Buffer }>((resolve, reject) => {
    request(`${base}${path}`, { headers: { "Accept-Encoding": enc, ...more } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, etag: res.headers.etag, encoding: res.headers["content-encoding"], body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
  });

  it("answers a repeat visit with 304 by ETag", async () => {
    // A 200 page (Express answers 304 only for a success), asked over a plain socket: fetch adds no-cache to a
    // conditional request, which rightly turns the 304 off.
    const a = await raw("/", "gzip");
    expect(a.status).toBe(200);
    const b = await raw("/", "gzip", { "If-None-Match": a.etag! });
    expect(b.status).toBe(304);
  });

  it("lets a shared cache keep a found page as long as the server does, and a browser always revalidate", async () => {
    const ok = await fetch(`${base}/`);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate, s-maxage=30");
    // Not found: never kept by a shared cache.
    const missing = await fetch(`${base}/teams/4215`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-cache");
  });

  it("counts every visit to a search, though its page is drawn once", async () => {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (40001, 'Prism Lights', 'Edison', 'NJ', 'USA')");
    await rebuildSearch();
    const path = `/search?q=${encodeURIComponent("40001 robot specs")}`;
    expect((await fetch(`${base}${path}`)).status).toBe(200);
    const drawn = keptCounts().pages;
    for (let i = 0; i < 2; i++) expect((await fetch(`${base}${path}`)).status).toBe(200);
    expect(keptCounts().pages).toBe(drawn);
    // Counted after the page is sent: give the write a turn to land.
    await new Promise((r) => setTimeout(r, 50));
    expect(await all<{ kind: string; count: number }>("SELECT kind, count FROM search_intents")).toEqual([{ kind: "robot-specs", count: 3 }]);
  });

  it("never lets a shared cache keep a search page", async () => {
    const r = await fetch(`${base}/search?q=${encodeURIComponent("4215 opr")}`);
    expect(r.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it("sends plain HTML to a client that takes no gzip", async () => {
    const r = await raw("/", "identity");
    expect(r.encoding).toBeUndefined();
    expect(r.body.toString()).toContain("<html");
  });

  it("sends the kept gzip to a client that asks for it", async () => {
    const r = await raw("/teams/4215", "gzip");
    expect(r.encoding).toBe("gzip");
    expect(gunzipSync(r.body).toString()).toContain(`<div id="root">`);
  });
});
