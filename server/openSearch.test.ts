// Address-bar search: /opensearch.xml serves as an OpenSearch description, every page's head links it, and its
// template lands on /search, whose first HTML already lists the results (no waiting on the app).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "./db";
import { rebuildSearch } from "./stats/job";
import { createApp } from "./app";
import { OPENSEARCH_TYPE } from "./openSearch";
import { pageModule, pageTitle } from "../src/shared/routes";

let server: Server;
let base = "";
const saved = process.env.APP_URL;
beforeAll(async () => {
  process.env.APP_URL = "https://controlscout.org";
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO team_seasons (season, team) VALUES (2025, 4215)");
  await run("INSERT INTO events (season, code, name, city, state, country, start, source) VALUES (2025, 'USNJNOM3', 'P1-4 PM Northern League Meet', 'Ramsey', 'NJ', 'USA', '2025-11-08', 'test')");
  await rebuildSearch();
  const dist = mkdtempSync(join(tmpdir(), "cs-opensearch-"));
  writeFileSync(join(dist, "index.html"), readFileSync(join(process.cwd(), "index.html"), "utf8"));
  server = createApp({ dist }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  if (saved === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved;
});

describe("OpenSearch", () => {
  it("serves /opensearch.xml as an OpenSearch description for Control Scout", async () => {
    const r = await fetch(`${base}/opensearch.xml`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(new RegExp(`^${OPENSEARCH_TYPE.replace(/\+/g, "\\+")}`));
    const xml = await r.text();
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<ShortName>Control Scout</ShortName>");
    expect(xml).toContain('template="https://controlscout.org/search?q={searchTerms}"');
  });

  it("every page's head links it", () => {
    expect(readFileSync(join(process.cwd(), "index.html"), "utf8"))
      .toContain('<link rel="search" type="application/opensearchdescription+xml" title="Control Scout" href="/opensearch.xml" />');
  });

  it("the template lands on /search, whose first HTML lists the results", async () => {
    const xml = await (await fetch(`${base}/opensearch.xml`)).text();
    const template = /<Url type="text\/html" method="get" template="([^"]+)"/.exec(xml)![1];
    const url = new URL(template.replace("{searchTerms}", encodeURIComponent("4215")));
    const r = await fetch(`${base}${url.pathname}${url.search}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<title>Search: 4215 · Control Scout</title>");
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).toContain("Results for “4215”");
    expect(html).toContain('<a href="/teams/4215">4215 Hypnotic Robotics</a>');
    // The app's own route for it, so the page stays when the app takes over.
    expect(pageModule("/search")).toBe("SearchPage");
    expect(pageTitle("/search")).toBe("Search");
  });

  it("/search lists events by name and says plainly when nothing matches", async () => {
    const ev = await (await fetch(`${base}/search?q=${encodeURIComponent("northern league")}`)).text();
    expect(ev).toContain('<a href="/events/2025/USNJNOM3">P1-4 PM Northern League Meet</a>');
    const none = await (await fetch(`${base}/search?q=${encodeURIComponent("<zzqx>")}`)).text();
    expect(none).toContain("Nothing matches “&lt;zzqx&gt;”.");
    expect(none).not.toContain("<zzqx>");
  });
});
