// A team or event page's first HTML carries the page itself (server/firstPaint.ts): the app's own markup in the app's
// page frame, the answers it was drawn from for the app to start with, and the stylesheet and text fonts it needs
// before it paints, so the first paint is the finished page, styled. Without a render (no build, a refused season,
// a failed render) the page keeps its plain first paint.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderIndex } from "./seo";
import { setPageRenderer } from "./firstPaint";
import { migrate, openDb, run, setDb } from "./db";
import { PAGE_DATA_ID, PAGE_FRAME } from "../src/shared/boot";
import { CURRENT_SEASON } from "./data/seasons";

const INDEX = '<html><head><title>x</title>\n<script type="module" crossorigin src="/assets/index-a.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/vendor-react-b.js">\n<link rel="stylesheet" crossorigin href="/assets/index-a.css">\n</head><body><div id="root"><!--cs-boot--></div></body></html>';
const dir = mkdtempSync(join(tmpdir(), "cs-first-paint-"));
const file = join(dir, "index.html");
writeFileSync(file, INDEX);
const drawnWith: string[] = [];
const data = (html: string) => JSON.parse(new RegExp(`<script type="application/json" id="${PAGE_DATA_ID}">([^<]*)</script>`).exec(html)![1]) as Record<string, any>;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO events (season, code, name, type, start, \"end\", timezone, source) VALUES (?, 'USNJCMP', 'New Jersey Championship', 'Championship', '2026-03-14', '2026-03-15', 'UTC', 'first')", [CURRENT_SEASON]);
});
afterEach(() => { setPageRenderer(null); drawnWith.length = 0; });
const draw = () => setPageRenderer((url: string, d: Record<string, unknown>) => { drawnWith.push(url); return `<div id="drawn">${url} ${Object.keys(d).join(" ")}</div>`; });

describe("team page first paint (HTML)", () => {
  it("is the page drawn by the app's component, in the app's frame, with the answers it was drawn from", async () => {
    draw();
    const html = await renderIndex(file, "/teams/4215");
    expect(drawnWith).toEqual(["/teams/4215"]);
    expect(html).toContain(`<div class="csb-app ${PAGE_FRAME}" id="cs-boot-page" data-path="/teams/4215"><div class="min-w-0 flex-1"><div id="drawn">`);
    // The same keys the page's useApi calls ask for, so the app's first render finds them.
    const d = data(html);
    expect(Object.keys(d).sort()).toEqual(["/api/meta", "/api/teams/4215", `/api/teams/4215/matches?season=${d["/api/teams/4215"].season}`].sort());
    expect(d["/api/teams/4215"].team.name).toBe("Hypnotic Robotics");
    expect(d["/api/meta"].currentSeason).toBe(CURRENT_SEASON);
    // Not the plain summary: one page, one H1 (the drawn page's own).
    expect(html).not.toContain("<h1>4215 Hypnotic Robotics</h1>");
  });

  it("paints once, styled: the stylesheet blocks the first paint and the text fonts wait to be ready", async () => {
    draw();
    const html = await renderIndex(file, "/teams/4215");
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/index-a.css">');
    expect(html).not.toContain('media="print"');
    expect(html).toMatch(/@font-face\{font-family:"Inter";[^}]*font-display:block/);
    expect(html).toMatch(/@font-face\{font-family:"Space Grotesk";[^}]*font-display:block/);
    expect(html).toMatch(/@font-face\{font-family:"JetBrains Mono";[^}]*font-display:block/);
    expect(html).toContain('<link rel="preload" href="/fonts/JetBrainsMono-400.woff2" as="font" type="font/woff2" crossorigin />');
    // The app's code downloads meanwhile, at low priority, and still runs only after the first paint.
    expect(html).toContain('<link rel="modulepreload" crossorigin fetchpriority="low" href="/assets/index-a.js" />');
    expect(html).toContain('<link rel="modulepreload" crossorigin fetchpriority="low" href="/assets/vendor-react-b.js" />');
    expect(html).not.toContain('<script type="module"');
  });

  it("asks for ?season= as the address wrote it, and only a season the API covers", async () => {
    draw();
    const html = await renderIndex(file, "/teams/4215", { season: String(CURRENT_SEASON) });
    expect(drawnWith).toEqual([`/teams/4215?season=${CURRENT_SEASON}`]);
    expect(Object.keys(data(html))).toContain(`/api/teams/4215?season=${CURRENT_SEASON}`);
    drawnWith.length = 0;
    for (const season of ["1999", "2025x", "abc"]) {
      const plain = await renderIndex(file, "/teams/4215", { season });
      expect(drawnWith, season).toEqual([]);
      expect(plain, season).toContain("<h1>4215 Hypnotic Robotics</h1>");
    }
  });

  it("an event page too: drawn from the event's detail and metadata, asked for with the address's own spelling", async () => {
    draw();
    const html = await renderIndex(file, `/events/${CURRENT_SEASON}/usnjcmp`, { tab: "odds" });
    expect(drawnWith).toEqual([`/events/${CURRENT_SEASON}/usnjcmp?tab=odds`]);
    const d = data(html);
    expect(Object.keys(d)).toContain("/api/meta");
    expect(Object.keys(d)).toContain(`/api/events/${CURRENT_SEASON}/usnjcmp`);
    expect(d[`/api/events/${CURRENT_SEASON}/usnjcmp`].event.name).toBe("New Jersey Championship");
    expect(html).not.toContain('media="print"');
    // No such event, or an address that can't be one: nothing drawn.
    drawnWith.length = 0;
    await renderIndex(file, `/events/${CURRENT_SEASON}/NOPE`);
    await renderIndex(file, "/events/1999/USNJCMP");
    expect(drawnWith).toEqual([]);
  });

  it("keeps the plain first paint (stylesheet not blocking) with no render, a failed one, or no such team", async () => {
    const plain = async (path = "/teams/4215") => {
      const html = await renderIndex(file, path);
      expect(html, path).not.toContain(PAGE_DATA_ID);
      expect(html, path).toContain('media="print"');
      return html;
    };
    expect(await plain()).toContain("<h1>4215 Hypnotic Robotics</h1>");
    setPageRenderer(() => { throw new Error("boom"); });
    expect(await plain()).toContain("<h1>4215 Hypnotic Robotics</h1>");
    draw();
    await plain("/teams/987654");
    await plain("/events");
    await plain("/rankings");
    expect(drawnWith).toEqual([]);
  });
});
