// The owner's wash on the server (server/wash.ts): saved in owner_settings, read through a cache that never fails
// a page, and put in every page's head (server/seo.ts) so the first paint never shows the default wash first.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb } from "./db";
import { liveWash, ownerWash, resetWash, setWash, invalidateWash, WASH_TTL_MS } from "./wash";
import { renderPage, washStyle } from "./seo";
import { BOOT_STYLE } from "./bootShell";
import { DEFAULT_WASH, WASH_STYLE_ID } from "../src/shared/wash";

const MINE = { a: "#112233", b: "#445566", c: "#778899", strength: 0.6, spread: 1.4 };

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  invalidateWash();
});

describe("the saved wash", () => {
  it("is the defaults until the owner saves one, then theirs; reset goes back and reports what it replaced", async () => {
    expect(await liveWash()).toEqual({ wash: DEFAULT_WASH, custom: false });
    expect(await setWash(MINE, "owner@example.com")).toBeNull();
    expect(await liveWash()).toEqual({ wash: MINE, custom: true });
    const o = await ownerWash();
    expect(o).toMatchObject({ wash: MINE, custom: true, defaults: DEFAULT_WASH, updatedBy: "owner@example.com" });
    expect(o.updatedAt).toMatch(/^\d{4}-/);
    expect(await setWash({ ...MINE, spread: 1 }, "owner@example.com")).toEqual(MINE);
    expect(await resetWash()).toEqual({ ...MINE, spread: 1 });
    expect(await liveWash()).toEqual({ wash: DEFAULT_WASH, custom: false });
    expect(await all("SELECT * FROM owner_settings WHERE key = 'wash'")).toEqual([]);
    expect(await resetWash()).toBeNull();
  });

  it("a row that no longer reads as a wash counts as none (never reaches a page)", async () => {
    const { run } = await import("./db");
    await run("INSERT INTO owner_settings (key, value, updated_at, updated_by) VALUES ('wash', ?, 'x', 'x')", [JSON.stringify({ ...MINE, a: "</style><script>" })]);
    expect(await liveWash()).toEqual({ wash: DEFAULT_WASH, custom: false });
  });

  it("a database that can't be read keeps the last known wash", async () => {
    await setWash(MINE, "o");
    const t = Date.now();
    expect((await liveWash(t)).custom).toBe(true);
    setDb({ execute: async () => { throw new Error("down"); }, batch: async () => { throw new Error("down"); } } as never);
    expect(await liveWash(t + WASH_TTL_MS + 1)).toEqual({ wash: MINE, custom: true });
  });
});

describe("the first paint", () => {
  const index = () => {
    const file = join(mkdtempSync(join(tmpdir(), "cs-wash-")), "index.html");
    writeFileSync(file, '<html><head><title>x</title></head><body><div id="root"></div></body></html>');
    return file;
  };

  it("carries the owner's wash as a <style> in the head, on every page; none for the defaults", async () => {
    const file = index();
    for (const p of ["/", "/events", "/teams/4215"]) expect((await renderPage(file, p)).html, p).not.toContain(`id="${WASH_STYLE_ID}"`);
    await setWash(MINE, "o");
    for (const p of ["/", "/events", "/teams/4215"]) {
      const html = (await renderPage(file, p)).html;
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head, p).toContain(`<style id="${WASH_STYLE_ID}">html[data-v8]:root{--wash-a:#112233;--wash-b:#445566;--wash-c:#778899;--wash-strength:0.6;--wash-spread:1.4}</style>`);
    }
  });

  it("washStyle is empty for the defaults", () => {
    expect(washStyle({ wash: { ...DEFAULT_WASH }, custom: false })).toBe("");
  });

  it("the shell's own wash reads the same variables, with the defaults as fallbacks before the app's CSS loads", () => {
    const rule = BOOT_STYLE.match(/html\[data-v8\] \.csb-col\{[^}]*\}/)![0];
    for (const [v, d] of [["--wash-a", "#5a76ad"], ["--wash-b", "#5f5785"], ["--wash-c", "#91689c"]]) expect(rule).toContain(`var(${v},${d})`);
    expect(rule).toContain("var(--wash-strength,1)");
    expect(rule).toContain("var(--wash-spread,1)");
    expect(rule).not.toMatch(/#5a76adcc|#5f5785cc|#91689ccc/);
  });
});
