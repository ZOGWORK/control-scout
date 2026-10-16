// Share cards: the drawing (fonts, fitting, what's on it), the PNG endpoint
// (validation, caching, a real 1200×630 / 1080×1080 PNG) and the link-preview
// tags that point at it.
import type { AddressInfo } from "node:net";
import { get as httpGet, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { renderIndex } from "../seo";
import { cardFonts, fitText, glyphs, parseFont, textWidth } from "./fonts";
import { cardSvg, renderCard, type CardModel } from "./card";
import { CARD_CACHE_MAX, PromiseLru, cardCacheSize } from "./match";

/** Width and height from a PNG's IHDR chunk (after checking the signature). */
function pngSize(b: Uint8Array): { width: number; height: number } {
  expect([...b.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(String.fromCharCode(...b.slice(12, 16))).toBe("IHDR");
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

const model: CardModel = {
  format: "landscape", red: [4215, 16379], blue: [33950, 21058],
  names: { 4215: "Hypnotic Robotics", 16379: "KookyBotz", 33950: "First Street Kids", 21058: "NIS KYRAN" },
  pRed: 0.73, predicted: { red: 182.4, blue: 145.2 }, final: null, tier: "moderate", label: "Q12 · Texas Championship", season: "2025–26 season",
};
const text = (svg: string) => svg.replace(/<tspan[^>]*>/g, "").replace(/<\/tspan>/g, "").replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")).filter(Boolean);

describe("card fonts", () => {
  it("read the bundled fonts' widths, and drop what they can't draw", () => {
    const { display, body } = cardFonts();
    expect(display.family).toBe("Space Grotesk");
    expect(display.advance("4".codePointAt(0)!)).toBeGreaterThan(0.3);
    expect(display.advance(0x4e2d)).toBeNull(); // 中: not in the Latin subset
    expect(textWidth(body, 100, "WWW")).toBeGreaterThan(textWidth(body, 100, "iii"));
    expect(glyphs(body, "Robo中文  Team 🤖")).toBe("Robo Team");
    expect(glyphs(body, "Équipe Ñandú")).toBe("Équipe Ñandú");
    expect(() => parseFont(new Uint8Array(64))).toThrow();
  });
  it("cut text to fit at a word, with an ellipsis", () => {
    const { body } = cardFonts();
    const long = "Another Extremely Long Team Name From Somewhere Far Away";
    const cut = fitText(body, 24, long, 300);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(body, 24, cut)).toBeLessThanOrEqual(300);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(fitText(body, 24, "Short", 300)).toBe("Short");
  });
});

describe("card drawing", () => {
  it("says the call, the score, the confidence and the address", () => {
    const t = text(cardSvg(model));
    expect(t).toContain("Our model gives");
    expect(t).toContain("4215 & 16379");
    expect(t).toContain("a 73% win chance");
    expect(t).toContain("Hypnotic Robotics & KookyBotz");
    expect(t.some((s) => s.includes("33950 & 21058"))).toBe(true);
    expect(t).toContain("Moderate confidence");
    expect(t).toContain("controlscout.org");
    expect(t).toContain("Q12 · Texas Championship · 2025–26 season");
    expect(t.join(" ")).not.toMatch(/FTC ?Scout/i);
  });
  it("leads with blue when blue is favoured, in past tense once played, with the final score", () => {
    const t = text(cardSvg({ ...model, pRed: 0.21, final: { red: 150, blue: 160 } }));
    expect(t).toContain("Our model gave");
    expect(t).toContain("33950 & 21058");
    expect(t).toContain("a 79% win chance");
    expect(t).toContain("Final 160 – 150");
  });
  it("escapes names, and always keeps the confidence (scores give way first)", () => {
    const svg = cardSvg({ ...model, names: { 123456: "<script>&\"x\"" }, backtest: true, final: { red: 1, blue: 2 }, red: [123456, 234567, 345678], blue: [456789, 567890, 678901] });
    expect(svg).not.toContain("<script>");
    const t = text(svg);
    expect(t).toContain('<script>&"x"');
    expect(t).toContain("Moderate confidence");
    expect(t).toContain("Backtest, not a live call");
  });
  it("a season with no score basis shows no predicted score", () => {
    expect(text(cardSvg({ ...model, predicted: null }))).not.toContain("Predicted");
  });
  it("renders a PNG at 1200×630 and 1080×1080, the same bytes every time", async () => {
    const a = await renderCard(model);
    expect(pngSize(a)).toEqual({ width: 1200, height: 630 });
    expect((await renderCard(model)).equals(a)).toBe(true);
    expect(pngSize(await renderCard({ ...model, format: "square" }))).toEqual({ width: 1080, height: 1080 });
  });
});

let server: Server;
let base = "";
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (101, 'Gearheads'), (102, 'Kraken'), (103, 'Pi Rates'), (104, 'Volt')");
  await run(`INSERT INTO events (season, code, name, type, start, "end", timezone, source) VALUES (2025, 'SHARE1', 'Share Test Qualifier', 'Qualifier', '2025-11-08', '2025-11-08', 'UTC', 'first')`);
  // Q1: unplayed (today's call). Q2: played, with its live call logged before it.
  await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (2025, 'SHARE1', 'qual', 0, 1, 'Q1', '2025-11-08T10:00:00', 0, 'first')`);
  await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'SHARE1', 'qual', 0, 2, 'Q2', '2025-11-08T10:10:00', 1, 120, 110, 98, 90, 'first')`);
  for (const n of [1, 2]) for (const [team, alliance] of [[101, "red"], [102, "red"], [103, "blue"], [104, "blue"]] as const) {
    await run(`INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'SHARE1', 'qual', 0, ?, ?, ?)`, [n, team, alliance]);
  }
  await run(`INSERT INTO predictions (kind, season, code, level, series, number, red, blue, p_red, red_mean, blue_mean, tier, engine_version, predicted_at) VALUES ('live', 2025, 'SHARE1', 'qual', 0, 2, '101,102', '103,104', 0.64, 115, 101, 'moderate', 'test', '2025-11-08T10:00:00Z')`);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

const LAB = "/api/share/match.png?season=2025&red=101,102&blue=103,104";

describe("GET /api/share/match.png", () => {
  it("sends a 1200×630 PNG, cached for a day with an ETag; the same request revalidates to a 304", async () => {
    const r = await fetch(base + LAB);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
    const etag = r.headers.get("etag")!;
    expect(etag).toMatch(/^"sc\d+-[\w-]+"$/);
    expect(pngSize(new Uint8Array(await r.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    const again = await fetch(base + LAB);
    expect(again.headers.get("etag")).toBe(etag);
    await again.arrayBuffer();
    // As a browser revalidates (plain http: fetch() adds no-cache to a hand-made conditional request).
    const status = await new Promise<number>((resolve, reject) => {
      httpGet(base + LAB, { headers: { "If-None-Match": etag } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); }).on("error", reject);
    });
    expect(status).toBe(304);
  });

  it("square for Instagram: 1080×1080, its own ETag", async () => {
    const r = await fetch(`${base}${LAB}&format=square`);
    expect(r.status).toBe(200);
    expect(pngSize(new Uint8Array(await r.arrayBuffer()))).toEqual({ width: 1080, height: 1080 });
    expect(r.headers.get("etag")).not.toBe((await fetch(base + LAB).then(async (x) => { await x.arrayBuffer(); return x; })).headers.get("etag"));
  });

  it("a match on its event page: its own call, label and result; the teams must be its lineup", async () => {
    const ok = await fetch(`${base}/api/share/match.png?season=2025&red=102,101&blue=103,104&event=share1&match=qual:0:2`);
    expect(ok.status).toBe(200);
    expect(pngSize(new Uint8Array(await ok.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    const unplayed = await fetch(`${base}/api/share/match.png?season=2025&red=101,102&blue=103,104&event=SHARE1&match=qual:0:1`);
    expect(unplayed.status).toBe(200);
    await unplayed.arrayBuffer();
    const wrong = await fetch(`${base}/api/share/match.png?season=2025&red=101,103&blue=102,104&event=SHARE1&match=qual:0:2`);
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${base}/api/share/match.png?season=2025&red=101,102&blue=103,104&event=SHARE1&match=qual:0:9`)).status).toBe(404);
    expect((await fetch(`${base}/api/share/match.png?season=2025&red=101,102&blue=103,104&event=NOPE&match=qual:0:1`)).status).toBe(404);
  });

  it("refuses bad input with a 4xx, never a crash", async () => {
    const bad = [
      "", "?red=101,102", "?season=2025&red=101,102", "?season=2025&red=abc&blue=103",
      "?season=2025&red=101,101&blue=103", "?season=2025&red=101&blue=101", "?season=2025&red=1,2,3,4&blue=5",
      "?season=2025&red=0&blue=5", "?season=2025&red=9999999&blue=5", "?season=2021&red=101&blue=103", "?season=1999&red=101&blue=103",
      "?season=2025&red=101&blue=103&format=gif", "?season=2025&red=101&blue=103&match=qual:0:1",
      "?season=2025&red=101&blue=103&event=SHARE1&match=../../x", "?season=2025&red=101&blue=103&event=%3Cx%3E",
      "?season=2025.5&red=101&blue=103",
    ];
    for (const q of bad) {
      const r = await fetch(`${base}/api/share/match.png${q}`);
      expect(r.status, q).toBeGreaterThanOrEqual(400);
      expect(r.status, q).toBeLessThan(500);
      expect(r.headers.get("content-type"), q).toContain("application/json");
    }
  });

  it("keeps a bounded number of cards", () => {
    expect(cardCacheSize()).toBeGreaterThan(0);
    expect(cardCacheSize()).toBeLessThanOrEqual(CARD_CACHE_MAX);
  });
});

describe("the card cache (PromiseLru)", () => {
  it("past its limit drops the least recently used card, keeping one just used", async () => {
    const lru = new PromiseLru<number>(CARD_CACHE_MAX);
    let made = 0;
    const make = (n: number) => () => { made++; return Promise.resolve(n); };
    for (let i = 0; i < CARD_CACHE_MAX; i++) lru.getOrCreate(`k${i}`, make(i));
    expect(lru.size).toBe(CARD_CACHE_MAX);
    // k0 is the oldest; using it makes k1 the oldest.
    expect(await lru.get("k0")).toBe(0);
    for (let i = CARD_CACHE_MAX; i < CARD_CACHE_MAX + 5; i++) lru.getOrCreate(`k${i}`, make(i));
    expect(lru.size).toBe(CARD_CACHE_MAX);
    expect(lru.has("k0")).toBe(true);
    for (let i = 1; i <= 5; i++) expect(lru.has(`k${i}`), `k${i}`).toBe(false);
    expect(lru.has("k6")).toBe(true);
    expect(lru.has(`k${CARD_CACHE_MAX + 4}`)).toBe(true);
    // A cached key is never made twice.
    const before = made;
    expect(await lru.getOrCreate("k0", make(99))).toBe(0);
    expect(made).toBe(before);
  });
  it("shares one producer between concurrent requests, and forgets a failure", async () => {
    const lru = new PromiseLru<number>(4);
    let calls = 0;
    let fail = true;
    const make = () => { calls++; return fail ? Promise.reject(new Error("no")) : Promise.resolve(1); };
    const [a, b] = [lru.getOrCreate("x", make), lru.getOrCreate("x", make)];
    expect(a).toBe(b);
    await expect(a).rejects.toThrow("no");
    await Promise.resolve();
    expect(lru.has("x")).toBe(false);
    fail = false;
    expect(await lru.getOrCreate("x", make)).toBe(1);
    expect(calls).toBe(2);
  });
});

describe("link previews for a shared matchup", () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL };
  let file = "";
  beforeAll(() => {
    Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://controlscout.org" });
    file = join(mkdtempSync(join(tmpdir(), "cs-share-")), "index.html");
    writeFileSync(file, "<html><head><title>x</title></head><body><div id=\"root\"></div></body></html>");
  });
  afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const meta = (html: string, prop: string) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, "&");

  it("a Predict Lab matchup previews as its card, titled and described by the call", async () => {
    const html = await renderIndex(file, "/predict", "?mode=match&season=2025&red=101,102&blue=103,104");
    expect(meta(html, "og:image")).toBe("https://controlscout.org/api/share/match.png?season=2025&red=101,102&blue=103,104");
    expect(meta(html, "twitter:image")).toBe(meta(html, "og:image"));
    expect(meta(html, "og:image:width")).toBe("1200");
    expect(meta(html, "og:image:height")).toBe("630");
    expect(meta(html, "og:url")).toBe("https://controlscout.org/predict?mode=match&season=2025&red=101,102&blue=103,104");
    expect(meta(html, "og:title")).toContain("101 & 102 vs 103 & 104");
    expect(meta(html, "og:description")).toMatch(/^Our model gives (101 & 102|103 & 104) a \d+% win chance vs/);
    expect(meta(html, "og:description")).toMatch(/confidence/);
    expect(meta(html, "og:image:alt")).toMatch(/^Our model gives/);
    // The canonical stays the Predict page (endless matchups aren't separate pages to index).
    expect(html).toContain('<link rel="canonical" href="https://controlscout.org/predict" />');
  });

  it("an event match previews as its own card", async () => {
    const html = await renderIndex(file, "/events/2025/SHARE1", "?tab=matches&match=qual%3A0%3A2");
    expect(meta(html, "og:image")).toBe("https://controlscout.org/api/share/match.png?season=2025&red=101,102&blue=103,104&event=SHARE1&match=qual:0:2");
    expect(meta(html, "og:title")).toContain("Q2: 101 & 102 vs 103 & 104");
    expect(meta(html, "og:description")).toContain("Our model gave 101 & 102 a 64% win chance vs 103 & 104");
    expect(meta(html, "og:description")).toContain("final 120–98");
  });

  it("anything else keeps the site card", async () => {
    for (const [p, q] of [["/predict", ""], ["/predict", "?red=101,102"], ["/predict", "?mode=advancement&red=101,102&blue=103,104"], ["/predict", "?season=2021&red=101,102&blue=103,104"],
      ["/predict", "?red=101,101&blue=103,104"], ["/events/2025/SHARE1", "?match=nope"], ["/events/2025/SHARE1", "?match=qual:0:77"], ["/teams/101", "?red=1,2&blue=3,4"]] as const) {
      expect(meta(await renderIndex(file, p, q), "og:image"), `${p}${q}`).toBe("https://controlscout.org/og-image.png");
    }
  });
});
