// One host, one URL per page: www/alias hosts 301 to the apex with path and
// query kept; trailing slashes and /team/… aliases 301; /api is never touched;
// the HTML carries the canonical link.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { canonicalRedirects, canonicalUrl, renderIndex } from "./seo";

let server: Server;
let port = 0;
const saved = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL };
beforeAll(async () => {
  Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://controlscout.org" });
  const app = express();
  app.set("trust proxy", 1);
  app.use(canonicalRedirects);
  app.get("/api/health", (_q, r) => { r.json({ ok: true }); });
  app.get(/.*/, (_q, r) => { r.send("app"); });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server?.close();
  // Restore exactly: a variable that was unset is deleted (assigning undefined would store "undefined").
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const get = (path: string, host: string) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", headers: { "X-Forwarded-Host": host, Host: host } });

describe("canonical redirects", () => {
  it("www and alias hosts → the apex, path and query kept", async () => {
    for (const host of ["www.controlscout.org", "scout.tryctrlpoint.org", "something.onrender.com"]) {
      const r = await get("/teams/4215?season=2024", host);
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("https://controlscout.org/teams/4215?season=2024");
    }
  });
  it("aliases and trailing slashes → the real path, in one hop (even from www)", async () => {
    expect((await get("/team/4215", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
    expect((await get("/teams/4215/", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
    expect((await get("/event/2025/USNJNOM3?tab=matches", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/events/2025/USNJNOM3?tab=matches");
    expect((await get("/index.html", "controlscout.org")).headers.get("location")).toBe("https://controlscout.org/");
    expect((await get("/team/4215/", "www.controlscout.org")).headers.get("location")).toBe("https://controlscout.org/teams/4215");
  });
  it("never redirects off the site (//host paths collapse; every redirect is absolute on the apex)", async () => {
    for (const p of ["//attacker.example/foo/", "///attacker.example/foo", "//attacker.example"]) {
      const loc = (await get(p, "controlscout.org")).headers.get("location")!;
      expect(new URL(loc).origin).toBe("https://controlscout.org");
      expect(loc.startsWith("https://controlscout.org/attacker.example")).toBe(true);
    }
  });
  it("leaves the apex, the root, loopback and /api alone", async () => {
    expect((await get("/teams/4215", "controlscout.org")).status).toBe(200);
    expect((await get("/", "controlscout.org")).status).toBe(200);
    expect((await get("/teams/4215", "127.0.0.1")).status).toBe(200);
    expect((await get("/api/health", "www.controlscout.org")).status).toBe(200);
  });
});

describe("canonical link in the HTML", () => {
  it("is the apex URL of the path, without query or trailing slash", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-seo-"));
    const file = join(dir, "index.html");
    writeFileSync(file, "<html><head><title>x</title></head><body></body></html>");
    expect(canonicalUrl("/teams/4215/")).toBe("https://controlscout.org/teams/4215");
    expect(canonicalUrl("/")).toBe("https://controlscout.org/");
    expect(renderIndex(file, "/events/2025/USNJNOM3")).toContain('<link rel="canonical" href="https://controlscout.org/events/2025/USNJNOM3" />');
  });
});
