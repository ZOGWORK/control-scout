// A team or event page's first HTML carries the page itself (server/firstPaint.ts): the app's own markup in the app's
// page frame, the answers it was drawn from for the app to start with, and the CSS (inline) and text fonts it needs
// before it paints, so the first paint is the finished page, styled. Without a render (no build, a refused season,
// a failed render) the page keeps its plain first paint.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FONT_WAIT_CLASS, FONT_WAIT_MS, renderIndex } from "./seo";
import { setPageRenderer } from "./firstPaint";
import { migrate, openDb, run, setDb } from "./db";
import { APP_CSS_ID, PAGE_DATA_ID, PAGE_FRAME } from "../src/shared/boot";
import { CURRENT_SEASON } from "./data/seasons";

const INDEX = '<html><head><title>x</title>\n<script type="module" crossorigin src="/assets/index-a.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/vendor-react-b.js">\n<link rel="stylesheet" crossorigin href="/assets/index-a.css">\n</head><body><div id="root"><!--cs-boot--></div></body></html>';
const dir = mkdtempSync(join(tmpdir(), "cs-first-paint-"));
const file = join(dir, "index.html");
writeFileSync(file, INDEX);
mkdirSync(join(dir, "assets"));
// The app's stylesheet: a rule the drawn markup uses, one it doesn't, and a reset that names no class.
writeFileSync(join(dir, "assets", "index-a.css"), "@layer base{*{box-sizing:border-box}}@layer utilities{.drawn-used{color:red}.never-drawn{color:blue}}");
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
const draw = () => setPageRenderer((url: string, d: Record<string, unknown>) => { drawnWith.push(url); return `<div id="drawn" class="drawn-used">${url} ${Object.keys(d).join(" ")}</div>`; });

describe("team page first paint (HTML)", () => {
  it("is the page drawn by the app's component, in the app's frame, with the answers it was drawn from", async () => {
    draw();
    const html = await renderIndex(file, "/teams/4215");
    expect(drawnWith).toEqual(["/teams/4215"]);
    expect(html).toContain(`<div class="csb-app ${PAGE_FRAME}" id="cs-boot-page" data-path="/teams/4215"><div class="min-w-0 flex-1"><div id="drawn" class="drawn-used">`);
    // The same keys the page's useApi calls ask for, so the app's first render finds them.
    const d = data(html);
    expect(Object.keys(d).sort()).toEqual(["/api/meta", "/api/teams/4215", `/api/teams/4215/matches?season=${d["/api/teams/4215"].season}`].sort());
    expect(d["/api/teams/4215"].team.name).toBe("Hypnotic Robotics");
    expect(d["/api/meta"].currentSeason).toBe(CURRENT_SEASON);
    // Not the plain summary: one page, one H1 (the drawn page's own).
    expect(html).not.toContain("<h1>4215 Hypnotic Robotics</h1>");
  });

  it("paints once, styled: the CSS its markup uses is inline, and the page waits for its text fonts", async () => {
    draw();
    const html = await renderIndex(file, "/teams/4215");
    // Only the rules the drawn markup uses, in their layers; the whole stylesheet is added by the loader later.
    expect(html).toContain('<style id="cs-critical">@layer base{*{box-sizing:border-box}}@layer utilities{.drawn-used{color:red}}</style>');
    expect(html).not.toContain(".never-drawn");
    expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(1); // nothing render-blocking: only the <noscript> copy
    expect(html).toContain('<noscript><link rel="stylesheet" crossorigin href="/assets/index-a.css" /></noscript>');
    expect(html).toContain(`c.href="/assets/index-a.css";c.media='print';c.id='${APP_CSS_ID}'`);
    expect(html).toMatch(/@font-face\{font-family:"Inter";[^}]*font-display:block/);
    expect(html).toMatch(/@font-face\{font-family:"Space Grotesk";[^}]*font-display:block/);
    expect(html).toMatch(/@font-face\{font-family:"JetBrains Mono";[^}]*font-display:block/);
    expect(html).toContain('<link rel="preload" href="/fonts/JetBrainsMono-400.woff2" as="font" type="font/woff2" crossorigin />');
    // The page stays hidden until those fonts are ready (FONT_WAIT_MS at most), so it never lays out in a stand-in font.
    expect(html).toContain(`html.${FONT_WAIT_CLASS} body{visibility:hidden;animation:${FONT_WAIT_CLASS} 0s ${FONT_WAIT_MS}ms forwards}`);
    // The app's code, and its stylesheet, wait for the fonts too, rather than share a slow line with them.
    expect(html).not.toContain('rel="modulepreload"');
    expect(html).not.toContain('<script type="module"');
    expect(html).toContain('["400 1em Inter","700 1em \\"Space Grotesk\\"","400 1em \\"JetBrains Mono\\""].map(function(f){return F.load(f)})');
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
    expect(html).toContain('<style id="cs-critical">');
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
      // No inline critical CSS, and no wait on fonts: the plain first paint has its own inline styles.
      expect(html, path).not.toContain('id="cs-critical"');
      expect(html, path).not.toContain(FONT_WAIT_CLASS);
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
