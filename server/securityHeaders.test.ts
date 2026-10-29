// Security headers (launch audit NEW-8): every response from the server as it really runs (server/index.ts's outer
// app around createApp) carries them, X-Powered-By never shows, and the app's HTML gets a CSP whose hashes match
// its inline scripts.
import type { AddressInfo } from "node:net";
import { request, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createApp, createServer } from "./app";
import { migrate, openDb, setDb } from "./db";
import {
  CSS_SWITCH_HANDLER, HSTS, PERMISSIONS_POLICY, buildCsp, cspReportCounts, inlineScriptHashes, resetCspReports, summarizeCspReports,
} from "./securityHeaders";

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Control Scout</title>
    <script>
      document.documentElement.classList.add('x');
    </script>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body>
    <div id="root"><!--cs-boot--></div>
  </body>
</html>
`;

let dist = "";
let server: Server;
let base = "";
let ready = true;
const saved = { CSP_ENFORCE: process.env.CSP_ENFORCE, NODE_ENV: process.env.NODE_ENV };
const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  dist = mkdtempSync(join(tmpdir(), "cs-headers-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(join(dist, "assets", "index-abc.css"), "body{}");
  writeFileSync(join(dist, "sw.js"), "self.addEventListener('fetch',()=>{})");
  writeFileSync(join(dist, "robots.txt"), "User-agent: *");
  server = createServer(createApp({ dist }), () => ({ ok: true }), () => ready).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server?.close();
  rmSync(dist, { recursive: true, force: true });
  restore();
});
beforeEach(() => { ready = true; restore(); delete process.env.CSP_ENFORCE; });

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { redirect: "manual", headers });

describe("every response", () => {
  const paths = ["/", "/teams/4215", "/api/health", "/api/meta", "/api/nope", "/assets/index-abc.js", "/sw.js", "/robots.txt", "/missing.png", "/team/4215"];
  it("never says X-Powered-By (HTML, API, static files, 404s and redirects)", async () => {
    for (const p of paths) {
      const r = await get(p);
      expect(r.headers.get("x-powered-by"), p).toBeNull();
    }
  });
  it("nor while the server is still starting up (the outer app's own 503)", async () => {
    ready = false;
    const r = await get("/api/meta");
    expect(r.status).toBe(503);
    expect(r.headers.get("x-powered-by")).toBeNull();
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
  it("carries the frame, sniffing, referrer and permissions policies", async () => {
    for (const p of paths) {
      const r = await get(p);
      expect(r.headers.get("x-content-type-options"), p).toBe("nosniff");
      expect(r.headers.get("referrer-policy"), p).toBe("strict-origin-when-cross-origin");
      expect(r.headers.get("x-frame-options"), p).toBe("SAMEORIGIN");
      expect(r.headers.get("permissions-policy"), p).toBe(PERMISSIONS_POLICY);
    }
  });
  it("lets this site use the camera and microphone (match recordings) and nothing else powerful", () => {
    expect(PERMISSIONS_POLICY).toContain("camera=(self)");
    expect(PERMISSIONS_POLICY).toContain("microphone=(self)");
    expect(PERMISSIONS_POLICY).toContain("geolocation=()");
    // Left at the browser default so the YouTube player's allow list still works.
    expect(PERMISSIONS_POLICY).not.toMatch(/fullscreen|picture-in-picture|encrypted-media/);
  });
});

describe("Strict-Transport-Security", () => {
  it("is sent over HTTPS (the proxy's X-Forwarded-Proto, or Cloudflare's CF-Visitor)", async () => {
    expect((await get("/", { "X-Forwarded-Proto": "https" })).headers.get("strict-transport-security")).toBe(HSTS);
    expect((await get("/api/health", { "CF-Visitor": '{"scheme":"https"}' })).headers.get("strict-transport-security")).toBe(HSTS);
    expect(HSTS).not.toContain("preload");
  });
  it("never to local development over plain HTTP", async () => {
    expect((await get("/")).headers.get("strict-transport-security")).toBeNull();
    process.env.NODE_ENV = "production"; // a production build run locally (npm run build + start)
    expect((await get("/")).headers.get("strict-transport-security")).toBeNull();
  });
  it("in production on the public host, whatever scheme the hop before said (browsers ignore it on plain HTTP)", async () => {
    process.env.NODE_ENV = "production";
    // fetch can't set Host, so a plain request.
    const hsts = await new Promise<unknown>((resolve, reject) => {
      request(`${base}/api/health`, { headers: { Host: "controlscout.org" } }, (r) => { r.resume(); resolve(r.headers["strict-transport-security"]); }).on("error", reject).end();
    });
    expect(hsts).toBe(HSTS);
  });
});

describe("Content-Security-Policy", () => {
  it("is report-only on the app's HTML by default, with each inline script's hash", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(r.headers.get("content-security-policy")).toBeNull();
    const csp = r.headers.get("content-security-policy-report-only")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("report-uri /api/csp-report");
    const hashes = inlineScriptHashes(html);
    expect(hashes.length).toBeGreaterThanOrEqual(2); // the theme script and the bundle loader (server/seo.ts)
    for (const h of hashes) expect(csp).toContain(h);
    // The stylesheet's onload switch is the one inline handler, allowed by its hash only.
    expect(html).toContain(`onload="${CSS_SWITCH_HANDLER}"`);
    expect(csp).toContain(`script-src-attr 'unsafe-hashes' 'sha256-${createHash("sha256").update(CSS_SWITCH_HANDLER).digest("base64")}'`);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
  it("is enforced with CSP_ENFORCE=1", async () => {
    process.env.CSP_ENFORCE = "1";
    const r = await get("/teams/4215");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("content-security-policy-report-only")).toBeNull();
  });
  it("only on HTML (API answers and static files have nothing to run)", async () => {
    for (const p of ["/api/health", "/assets/index-abc.js", "/sw.js"]) {
      const r = await get(p);
      expect(r.headers.get("content-security-policy-report-only"), p).toBeNull();
    }
  });
  it("hashes the text browsers hash (CRLF normalised, src scripts skipped)", () => {
    const h = (t: string) => `'sha256-${createHash("sha256").update(t).digest("base64")}'`;
    expect(inlineScriptHashes("<script>a\r\nb</script><script src=/x.js></script><script type=\"application/ld+json\">{}</script>"))
      .toEqual([h("a\nb"), h("{}")]);
  });
  /** A Cloudflare account id's shape: 32 hex characters. */
  const ACCT = "0123456789abcdef0123456789abcdef";
  it("allows the YouTube player, its thumbnails, sql.js's WebAssembly and the photo bucket", () => {
    const saved = { R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID, R2_PUBLIC_URL: process.env.R2_PUBLIC_URL };
    process.env.R2_ACCOUNT_ID = ACCT;
    process.env.R2_PUBLIC_URL = "https://photos.example.org/some/path";
    try {
      const csp = buildCsp([]);
      expect(csp).toContain("frame-src https://www.youtube-nocookie.com");
      expect(csp).toMatch(/img-src [^;]*https:\/\/i\.ytimg\.com/);
      expect(csp).toMatch(/script-src [^;]*'wasm-unsafe-eval'/);
      expect(csp).toMatch(new RegExp(`connect-src [^;]*https://${ACCT}\\.r2\\.cloudflarestorage\\.com`));
      expect(csp).toMatch(/img-src [^;]*https:\/\/photos\.example\.org(;|\s)/);
      expect(csp).toMatch(/worker-src 'self' blob:/);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
  it("never puts an R2_ACCOUNT_ID that isn't an account id in the policy (a token pasted in by mistake)", () => {
    const saved = process.env.R2_ACCOUNT_ID;
    process.env.R2_ACCOUNT_ID = "cfat_notAnAccountId123";
    try {
      expect(buildCsp([])).not.toContain("cfat_");
      expect(buildCsp([])).not.toContain("r2.cloudflarestorage.com");
    } finally {
      if (saved === undefined) delete process.env.R2_ACCOUNT_ID; else process.env.R2_ACCOUNT_ID = saved;
    }
  });
});

describe("violation reports", () => {
  it("are counted by directive and blocked origin (never a path), and always answered 204", async () => {
    resetCspReports();
    const post = (body: string, type: string) => fetch(`${base}/api/csp-report`, { method: "POST", headers: { "Content-Type": type }, body });
    const legacy = JSON.stringify({ "csp-report": { "document-uri": "https://controlscout.org/teams/1", "effective-directive": "img-src", "blocked-uri": "https://cdn.example.com/a/b.png?token=x" } });
    expect((await post(legacy, "application/csp-report")).status).toBe(204);
    expect((await post(legacy, "application/csp-report")).status).toBe(204);
    const modern = JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "inline" } }]);
    expect((await post(modern, "application/reports+json")).status).toBe(204);
    expect((await post("{not json", "application/csp-report")).status).toBe(204);
    const counts = cspReportCounts();
    expect(counts.get("img-src https://cdn.example.com")).toBe(2);
    expect(counts.get("script-src-elem inline")).toBe(1);
    expect([...counts.keys()].join(" ")).not.toContain("token");
  });
  it("counts every report in a Reporting API batch, each on its own", async () => {
    resetCspReports();
    const batch = JSON.stringify([
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://a.example/x.png" } },
      { type: "csp-violation", body: { effectiveDirective: "connect-src", blockedURL: "https://b.example/api?q=1" } },
      { type: "deprecation", body: { id: "x" } },
    ]);
    const r = await fetch(`${base}/api/csp-report`, { method: "POST", headers: { "Content-Type": "application/reports+json" }, body: batch });
    expect(r.status).toBe(204);
    const counts = cspReportCounts();
    expect(counts.get("img-src https://a.example")).toBe(1);
    expect(counts.get("connect-src https://b.example")).toBe(1);
    expect(counts.size).toBe(2);
  });
  it("as application/json too: its own 16 KB parser, so malformed or oversized bodies are a 204, never a 500", async () => {
    resetCspReports();
    const post = (body: string) => fetch(`${base}/api/csp-report`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect((await post("{not json")).status).toBe(204);
    const big = JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://big.example/", pad: "x".repeat(20_000) } });
    expect((await post(big)).status).toBe(204);
    expect(cspReportCounts().size).toBe(0); // over 16 KB: not read (the shared 2 MB parser would have read it)
    const ok = JSON.stringify({ "csp-report": { "effective-directive": "font-src", "blocked-uri": "https://fonts.example/a.woff2" } });
    expect((await post(ok)).status).toBe(204);
    expect(cspReportCounts().get("font-src https://fonts.example")).toBe(1);
  });
  it("summarises only well-formed reports", () => {
    expect(summarizeCspReports(null)).toEqual([]);
    expect(summarizeCspReports({ "csp-report": { "effective-directive": "<script>" } })).toEqual([]);
    expect(summarizeCspReports({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "data:image/png;base64,AAAA" } })).toEqual(["img-src data:"]);
  });
});

it("the outer app alone (no createApp) also hides X-Powered-By", async () => {
  const s = createServer(express(), () => ({ ok: true }), () => true).listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/health`);
    expect(r.headers.get("x-powered-by")).toBeNull();
  } finally { s.close(); }
});
