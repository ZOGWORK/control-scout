// The home page's hero lines, set in the owner console: add, edit, reorder, switch on and off, start from the
// built-in lines and go back to them, every change audited with its old and new value; the built-in lines
// whenever none is saved and on, or the database is out of reach; and the home page (its first paint, the
// JSON block every page carries, and /api/home/headlines) showing exactly the lines in use.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { all, get, migrate, openDb, run, setDb } from "./db";
import { createApp } from "./app";
import { sha256 } from "./auth/session";
import { renderPage } from "./seo";
import { invalidateHeroLines, liveHeroLines } from "./heroLines";
import { HOME_HEADLINE_MS, HOME_HEADLINES } from "../src/shared/boot";
import { HERO_PART_MAX } from "../src/shared/heroLines";

let server: Server;
let base = "";
let ownerCookie = "", otherCookie = "";
let index = "";
const saved = process.env.OWNER_EMAILS;
let auditFrom = 0;

async function signIn(email: string): Promise<string> {
  const u = await get<{ id: number }>("INSERT INTO users (email, created_at) VALUES (?, ?) RETURNING id", [email, new Date().toISOString()]);
  const t = `tok-${email}`;
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, '')", [sha256(t), u!.id, new Date().toISOString(), new Date(Date.now() + 864e5).toISOString()]);
  return `cs_session=${t}`;
}

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, json: await res.json().catch(() => null) as any, headers: res.headers };
}
const owner = (method: string, path: string, body?: unknown) => call(method, `/api/owner/hero-lines${path}`, { cookie: ownerCookie, body });
const audit = async () => (await all<{ actor: string; action: string; details: string | null; old_value: string | null; new_value: string | null }>(
  "SELECT * FROM owner_audit WHERE id > ? ORDER BY id", [auditFrom])).map((a) => ({
  actor: a.actor, action: a.action, details: a.details && JSON.parse(a.details), from: a.old_value && JSON.parse(a.old_value), to: a.new_value && JSON.parse(a.new_value),
}));
const home = async () => (await renderPage(index, "/")).html;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerCookie = await signIn("owner@example.com");
  otherCookie = await signIn("scout@example.com");
  index = join(mkdtempSync(join(tmpdir(), "hero-html-")), "index.html");
  writeFileSync(index, '<html><head><title>FTC Control Scout</title></head><body><div id="root"></div></body></html>');
});
afterAll(() => {
  server?.close();
  if (saved === undefined) delete process.env.OWNER_EMAILS; else process.env.OWNER_EMAILS = saved;
});
beforeEach(async () => {
  process.env.OWNER_EMAILS = "owner@example.com";
  await run("DELETE FROM hero_lines");
  invalidateHeroLines();
  auditFrom = Number((await get<{ n: number }>("SELECT COALESCE(MAX(id), 0) n FROM owner_audit"))!.n);
});

describe("hero lines", () => {
  it("is a 403 for anyone but the owner, and nothing changes", async () => {
    for (const cookie of [undefined, otherCookie]) {
      expect((await call("GET", "/api/owner/hero-lines", { cookie })).status).toBe(403);
      expect((await call("POST", "/api/owner/hero-lines", { cookie, body: { plain: "a", accent: "b" } })).status).toBe(403);
      expect((await call("POST", "/api/owner/hero-lines/seed", { cookie, body: { confirm: true } })).status).toBe(403);
    }
    expect(await all("SELECT * FROM hero_lines")).toEqual([]);
    expect(await audit()).toEqual([]);
  });

  it("uses the built-in lines while none is saved: the console, the API and the first paint", async () => {
    const panel = (await owner("GET", "")).json;
    expect(panel.rows).toEqual([]);
    expect(panel.live.custom).toBe(false);
    expect(panel.live.lines).toEqual(HOME_HEADLINES.map((l) => [...l]));
    expect(panel.defaults).toHaveLength(HOME_HEADLINES.length);
    const pub = await call("GET", "/api/home/headlines");
    expect(pub.status).toBe(200);
    expect(pub.json).toEqual({ lines: HOME_HEADLINES.map((l) => [...l]), custom: false });
    expect(pub.headers.get("cache-control")).toBe("public, max-age=60");
    const html = await home();
    expect(html).not.toContain('id="cs-hero"'); // the app has the built-in lines already: nothing extra on the page
    for (const [a, b] of HOME_HEADLINES) expect(html).toContain(`<i aria-hidden="true">${a} <b>${b}</b></i>`);
  });

  it("add, edit, switch off and on, reorder and delete: each one audited with its old and new value", async () => {
    const a = await owner("POST", "", { plain: "  Scout   smarter, ", accent: "win sooner." });
    expect(a.status).toBe(200);
    expect(a.json.line).toMatchObject({ plain: "Scout smarter,", accent: "win sooner.", enabled: true, position: 0 });
    const b = (await owner("POST", "", { plain: "Second", accent: "line." })).json.line;
    const c = (await owner("POST", "", { plain: "Third", accent: "line.", enabled: false })).json.line;
    expect(c.enabled).toBe(false);
    const idA = a.json.line.id;

    // Bad input is refused and changes nothing.
    expect((await owner("POST", "", { plain: "", accent: "x" })).status).toBe(400);
    expect((await owner("POST", "", { plain: "x".repeat(HERO_PART_MAX + 1), accent: "x" })).status).toBe(400);
    expect((await owner("POST", "", { plain: "x", accent: 5 })).status).toBe(400);
    expect((await owner("PATCH", `/${idA}`, { plain: null })).status).toBe(400);
    expect((await owner("PATCH", `/${idA}`, {})).status).toBe(400);
    expect((await owner("PATCH", "/9999", { plain: "x" })).status).toBe(404);

    const edit = await owner("PATCH", `/${idA}`, { accent: "win every match." });
    expect(edit.json.line).toMatchObject({ plain: "Scout smarter,", accent: "win every match." });
    expect((await owner("PATCH", `/${b.id}`, { enabled: false })).json.line.enabled).toBe(false);
    expect((await owner("PATCH", `/${c.id}`, { enabled: true })).json.line.enabled).toBe(true);
    // The same value again: nothing to record.
    expect((await owner("PATCH", `/${c.id}`, { enabled: true })).status).toBe(200);

    // Reorder: every line, each once, or nothing moves.
    expect((await owner("PUT", "/order", { ids: [c.id, idA] })).status).toBe(400);
    expect((await owner("PUT", "/order", { ids: [c.id, idA, idA] })).status).toBe(400);
    const order = await owner("PUT", "/order", { ids: [c.id, idA, b.id] });
    expect(order.json.panel.rows.map((r: any) => r.id)).toEqual([c.id, idA, b.id]);
    // The home page goes through the lines that are on, in order.
    expect(order.json.panel.live).toMatchObject({ custom: true, lines: [["Third", "line."], ["Scout smarter,", "win every match."]] });

    // Delete needs the confirmation.
    expect((await owner("DELETE", `/${b.id}`, {})).status).toBe(400);
    expect((await owner("DELETE", `/${b.id}`, { confirm: true })).json.panel.rows).toHaveLength(2);

    const log = await audit();
    expect(log.map((x) => x.action)).toEqual(["heroLine.add", "heroLine.add", "heroLine.add", "heroLine.edit", "heroLine.off", "heroLine.on", "heroLines.reorder", "heroLine.delete"]);
    expect(log.every((x) => x.actor === "owner@example.com")).toBe(true);
    expect(log[0]).toMatchObject({ details: { id: idA }, from: null, to: { plain: "Scout smarter,", accent: "win sooner.", enabled: true } });
    expect(log[3]).toMatchObject({ from: { plain: "Scout smarter,", accent: "win sooner.", enabled: true }, to: { plain: "Scout smarter,", accent: "win every match.", enabled: true } });
    expect(log[4]).toMatchObject({ from: { enabled: true }, to: { enabled: false } });
    expect(log[6]).toMatchObject({ from: [idA, b.id, c.id], to: [c.id, idA, b.id] });
    expect(log[7]).toMatchObject({ details: { id: b.id }, from: { plain: "Second", accent: "line.", enabled: false }, to: null });
  });

  it("the home page shows the owner's lines: its first paint, the lines every page carries, and the API", async () => {
    await owner("POST", "", { plain: "Custom <one>", accent: "in colour." });
    await owner("POST", "", { plain: "Custom two", accent: "also." });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(7 * HOME_HEADLINE_MS + 60_000); // hour 7: line 7 % 2 = 1
      invalidateHeroLines();
      const html = await home();
      expect(html).toContain('<h1 data-line="1">Custom two <span>also.</span></h1>');
      expect(html).toContain('<i aria-hidden="true">Custom &lt;one&gt; <b>in colour.</b></i>'); // escaped, and sized for
      expect(html).not.toContain("Know the match");
      // The JSON block the app reads (no "<" that could close the script).
      const json = /<script type="application\/json" id="cs-hero">(.*?)<\/script>/.exec(html)?.[1];
      expect(JSON.parse(json!)).toEqual([["Custom <one>", "in colour."], ["Custom two", "also."]]);
      expect(json).not.toContain("<");
      // Another page carries them too, so Home draws the same lines when opened from it.
      expect((await renderPage(index, "/events")).html).toContain('id="cs-hero"');
      vi.setSystemTime(8 * HOME_HEADLINE_MS + 60_000);
      expect(await home()).toContain('<h1 data-line="0">Custom &lt;one&gt; <span>in colour.</span></h1>'); // the next hour, the next line
    } finally { vi.useRealTimers(); }
    expect((await call("GET", "/api/home/headlines")).json).toEqual({ lines: [["Custom <one>", "in colour."], ["Custom two", "also."]], custom: true });
  });

  it("falls back to the built-in lines when every saved line is off, and when the database can't be read", async () => {
    const l = (await owner("POST", "", { plain: "Only", accent: "line." })).json.line;
    await owner("PATCH", `/${l.id}`, { enabled: false });
    expect((await call("GET", "/api/home/headlines")).json.custom).toBe(false);
    expect((await owner("GET", "")).json.live.lines).toHaveLength(HOME_HEADLINES.length);
    // The table unreadable (as on a database that's down): the built-in lines, never an error page.
    await run("ALTER TABLE hero_lines RENAME TO hero_lines_away");
    try {
      invalidateHeroLines();
      expect(await liveHeroLines()).toEqual({ lines: HOME_HEADLINES.map((x) => [...x]), custom: false });
      expect(await home()).toContain('<i aria-hidden="true">Know the match <b>before it starts.</b></i>');
    } finally {
      await run("ALTER TABLE hero_lines_away RENAME TO hero_lines");
      invalidateHeroLines();
    }
  });

  it("starts from the built-in lines (once), and goes back to them with every line's old value audited", async () => {
    expect((await owner("POST", "/seed", {})).status).toBe(400);
    const seeded = await owner("POST", "/seed", { confirm: true });
    expect(seeded.json.panel.rows.map((r: any) => [r.plain, r.accent])).toEqual(HOME_HEADLINES.map((x) => [...x]));
    expect(seeded.json.panel.live.custom).toBe(true);
    expect((await owner("POST", "/seed", { confirm: true })).status).toBe(409);
    expect((await owner("POST", "/reset", {})).status).toBe(400);
    const reset = await owner("POST", "/reset", { confirm: true });
    expect(reset.json.panel).toMatchObject({ rows: [], live: { custom: false } });
    const log = await audit();
    expect(log[0]).toMatchObject({ action: "heroLines.seed", details: { lines: HOME_HEADLINES.length }, from: null });
    expect(log[0].to).toHaveLength(HOME_HEADLINES.length);
    expect(log.slice(1)).toHaveLength(HOME_HEADLINES.length);
    expect(log[1]).toMatchObject({ action: "heroLine.delete", details: { reset: true }, from: { plain: HOME_HEADLINES[0][0], accent: HOME_HEADLINES[0][1], enabled: true }, to: null });
  });

  it("a save writes only what it changes, so overlapping saves never undo each other", async () => {
    const l = (await owner("POST", "", { plain: "Words", accent: "here." })).json.line;
    // Another save switches the line off after this editor opened it (the editor still shows it on).
    await run("UPDATE hero_lines SET enabled = 0 WHERE id = ?", [l.id]);
    const edit = await owner("PATCH", `/${l.id}`, { plain: "New words" });
    expect(edit.json.line).toMatchObject({ plain: "New words", accent: "here.", enabled: false }); // still off
    expect((await call("GET", "/api/home/headlines")).json.custom).toBe(false);
    // The audit row's old value is the line as it really was when the edit landed.
    const log = await audit();
    expect(log.at(-1)).toMatchObject({ action: "heroLine.edit", from: { plain: "Words", enabled: false }, to: { plain: "New words", enabled: false } });
  });

  it("a refused start-from-built-in copies nothing, even when a line was added just before", async () => {
    await owner("POST", "", { plain: "Mine", accent: "first." });
    expect((await owner("POST", "/seed", { confirm: true })).status).toBe(409);
    expect(await all("SELECT plain FROM hero_lines")).toEqual([{ plain: "Mine" }]);
    expect((await audit()).map((x) => x.action)).toEqual(["heroLine.add"]);
  });

  it("keeps at most the line limit", async () => {
    await owner("POST", "/seed", { confirm: true });
    for (let i = HOME_HEADLINES.length; i < 48; i++) expect((await owner("POST", "", { plain: `Line ${i}`, accent: "x." })).status).toBe(200);
    const over = await owner("POST", "", { plain: "One more", accent: "x." });
    expect(over.status).toBe(409);
    expect(over.json.error).toMatch(/up to 48/);
  });
});
