// /donate is a real page (sitemap, its own title and description); /support is a 301 to it, query kept.
// (/support/ first loses its slash, like every path.) Real app over HTTP, in-memory database.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { createApp } from "./app";
import { headTags, pageMeta } from "./seoMeta";
import { resetSitemapCache, sitemapEntries } from "./sitemap";

let server: Server;
let base = "";
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  resetSitemapCache();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("donate page", () => {
  it("/support redirects to /donate with a 301, query kept", async () => {
    for (const [from, to] of [["/support", "/donate"], ["/Support?ref=x", "/donate?ref=x"]]) {
      const res = await fetch(`${base}${from}`, { redirect: "manual" });
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(to);
    }
  });

  it("is in the sitemap, indexable, and never called a charity", async () => {
    expect((await sitemapEntries()).some((e) => new URL(e.loc).pathname === "/donate")).toBe(true);
    const m = await pageMeta("/donate");
    expect(m.title).toBe("Support Control Scout");
    expect(m.noindex).toBeFalsy();
    expect(m.description).toMatch(/Not tax-deductible/);
    expect(m.description).not.toMatch(/\b(charity|nonprofit)\b/i);
  });

  it("/supporters is never indexed, at any spelling, with a robots tag the app can drop on leaving", async () => {
    for (const p of ["/supporters", "/Supporters"]) {
      const m = await pageMeta(p);
      expect(m.searchPage, p).toBe(true);
      expect(headTags(p, m), p).toContain('<meta name="robots" content="noindex, follow" data-search />');
    }
    expect((await sitemapEntries()).some((e) => new URL(e.loc).pathname === "/supporters")).toBe(false);
  });
});
