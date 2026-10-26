// The first HTML paints before the JavaScript: the shell's outline and the
// page's own title (server/bootShell.ts), with the page's code chunk preloaded
// from Vite's manifest (server/seo.ts routePreloads).
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PRELOAD_MAX_DEP, afterFirstPaint, nonBlockingCss, renderIndex, routePreloads } from "./seo";
import { APP_CSS_ID } from "../src/shared/boot";
import { bootShell } from "./bootShell";
import { migrate, openDb, run, setDb } from "./db";
import { pageModule, pageTitle } from "../src/shared/routes";

const INDEX = '<html><head><title>x</title>\n</head><body><div id="root"><!--cs-boot--></div><script type="module" src="/assets/index-a.js"></script></body></html>';
const root = (html: string) => /<div id="root">([\s\S]*)<\/div><section id="cs-boot-consent"/.exec(html)![1];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (4215, 'Hypnotic <Robotics> & $&', 'Oradell', 'NJ', 'USA')");
});

describe("routes shared by the app and the server", () => {
  it("map each path to the page module main.tsx renders, like react-router (any case, trailing slash)", () => {
    const cases: [string, string | null][] = [
      ["/", null], ["/teams", "RecordsPage"], ["/matches", "RecordsPage"], ["/teams/4215", "TeamPage"], ["/Teams/4215/", "TeamPage"],
      ["/events", "EventsPage"], ["/events/2025/USNJNOM3", "EventPage"], ["/predict", "PredictPage"], ["/predict/accuracy", null],
      ["/predict/how-it-works", "MethodologyPage"], ["/methodology", "MethodologyPage"], ["/compare", "ComparePage"], ["/my-team", "MyTeamPage"],
      ["/shortlist", "ShortlistPage"], ["/scout", "ScoutPage"], ["/download", "DownloadPage"], ["/settings", "SettingsPage"],
      ["/rankings", "RankingsPage"], ["/Rankings/", "RankingsPage"], ["/rankings/x", "NotFound"],
      ["/privacy", "PrivacyPage"], ["/terms", "TermsPage"], ["/contact", "ContactPage"], ["/nope", "NotFound"], ["/events/2025", "NotFound"], ["/teams/4215/x", "NotFound"],
      ["/events/2025/USNJNOM3/match/qual:0:12", "MatchReportPage"], ["/events/2025/X/match/qual:0:1/", "MatchReportPage"], ["/events/2025/X/match", "NotFound"],
      ["/power-rankings", "PowerRankingsPage"], ["/power-rankings/2026-w42", "PowerRankingsPage"], ["/Power-Rankings/2026-W42/", "PowerRankingsPage"], ["/power-rankings/2026-w42/x", "NotFound"],
    ];
    for (const [path, mod] of cases) expect(pageModule(path), path).toBe(mod);
    for (const [, mod] of cases) if (mod) expect(existsSync(join(__dirname, "..", "src", "pages", `${mod}.tsx`)), mod).toBe(true);
    expect(pageTitle("/events/2025/X")).toBe("Event");
    expect(pageTitle("/events/2025/X/match/qual:0:1")).toBe("Match report");
    expect(pageTitle("/teams")).toBe("Teams");
    expect(pageTitle("/rankings")).toBe("Rankings");
    expect(pageTitle("/")).toBe("Home");
    // Whole routes only: anything else is the not-found page (case and a trailing slash don't matter).
    expect(pageTitle("/teams/4215/extra")).toBe("Not found");
    expect(pageTitle("/no-such-page")).toBe("Not found");
    expect(pageTitle("/Teams/")).toBe("Teams");
    expect(pageTitle("/power-rankings")).toBe("Power rankings");
    expect(pageTitle("/power-rankings/2026-w42")).toBe("Power rankings");
  });
});

describe("static first paint", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-boot-"));
  const file = join(dir, "index.html");
  writeFileSync(file, INDEX);

  it("puts the shell and the page's own title and description inside #root, escaped", async () => {
    const html = await renderIndex(file, "/teams/4215");
    const r = root(html);
    expect(r).toContain('<h1>4215 Hypnotic &lt;Robotics&gt; &amp; $&amp;</h1>'); // the number and name, as people search for them
    expect(r).toMatch(/<p>FTC team 4215 Hypnotic &lt;Robotics&gt; &amp; \$&amp; from Oradell, NJ\./);
    expect(r).toContain('<b>Team</b>'); // the top bar's page name
    expect(r).toContain('<a href="/teams" aria-current="page">'); // the sidebar marks the section
    expect(r).not.toContain('<a href="/" aria-current');
    expect(r).toContain('data-path="/teams/4215"');
    expect(html).toContain('<style>'); // its styles come with it (no wait for the app's CSS)
  });

  it("home shows the headline (the brand stays in the shell's chrome); a page with no title of its own gets the shell alone", async () => {
    const home = root(await renderIndex(file, "/"));
    expect(home).toContain("<h1>The whole field. <span>In your corner.</span></h1>");
    expect(home).toContain('<a class="csb-brand" href="/" aria-label="Control Scout home"><img src="/logo.png" alt="" /><span>Control Scout</span></a>');
    expect(home).toContain('<a href="/" aria-current="page">');
    const lost = root(await renderIndex(file, "/no-such-page"));
    expect(lost).toContain('class="csb"');
    expect(lost).not.toContain("<h1>");
  });

  it("a request path can't break out of the data-path attribute", () => {
    const r = bootShell('/x"><script>alert(1)</script>', { title: "T", description: "D", type: "website" });
    expect(r).toContain('data-path="/x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(r).not.toContain("<script>alert(1)");
  });

  // Mirrors the app's sidebar (src/components/layout/Shell.tsx SECTIONS), so nothing moves when the app takes over.
  it("draws the sidebar's everyday pages, then More, open only on one of its own pages", () => {
    const meta = { title: "T", description: "D", type: "website" } as const;
    const labels = (html: string) => [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
    const side = (path: string) => bootShell(path, meta).match(/<aside class="csb-side">.*?<\/aside>/)![0];
    expect(labels(side("/"))).toEqual(["Control Scout", "Home", "Events", "Teams", "Rankings", "Predict", "My team", "Scout", "More", "Power rankings", "Compare", "Shortlist", "Download", "How it works", "Settings"]);
    expect(side("/")).toContain('<div class="csb-more"><p>');
    expect(side("/compare")).toContain('<div class="csb-more" data-open><p>');
    expect(side("/settings")).toContain('<a href="/settings" aria-current="page">');
  });
});

describe("first paint without waiting for the app's CSS", () => {
  const BUILT = '<html><head><title>x</title>\n<script type="module" crossorigin src="/assets/index-a.js"></script>\n<link rel="stylesheet" crossorigin href="/assets/index-a.css">\n</head><body><div id="root"><!--cs-boot--></div></body></html>';

  it("the app's stylesheet loads without blocking the first paint, with a no-JS fallback", () => {
    const out = nonBlockingCss(BUILT);
    expect(out).toContain(`<link rel="stylesheet" crossorigin href="/assets/index-a.css" media="print" onload="this.media='all'" onerror="this.media='all'" id="${APP_CSS_ID}" />`);
    expect(out).toContain('<noscript><link rel="stylesheet" crossorigin href="/assets/index-a.css" /></noscript>');
    expect(out.match(/rel="stylesheet"/g)).toHaveLength(2); // the switched one and the <noscript> one: no blocking copy left
  });

  it("the app's code is requested after the first paint, entry and preloads alike, in order", () => {
    const html = '<html><head>\n<script type="module" crossorigin src="/assets/index-a.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/vendor-react-b.js">\n<link rel="modulepreload" crossorigin href="/assets/TeamPage-d.js" />\n</head><body><div id="root"></div>\n</body></html>';
    const out = afterFirstPaint(html);
    expect(out).not.toMatch(/<script type="module"|rel="modulepreload"/);
    const loader = /<script>(\(function\(\)[\s\S]*?)<\/script>\n {2}<\/body>/.exec(out)![1];
    expect(loader).toContain('["/assets/vendor-react-b.js","/assets/TeamPage-d.js"]');
    expect(loader).toContain('e.src="/assets/index-a.js"');
    expect(loader).toContain("requestAnimationFrame(function(){setTimeout(go,0)})"); // the task after the first frame
    expect(loader).toContain("setTimeout(go,100)"); // a background tab, where frames don't run
    expect(afterFirstPaint("<html><body></body></html>")).toBe("<html><body></body></html>"); // no entry script (dev): unchanged
  });

  it("the privacy banner follows #root (React's first render leaves it alone), on every page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-css-"));
    const file = join(dir, "index.html");
    writeFileSync(file, BUILT);
    for (const p of ["/", "/events", "/no-such-page"]) {
      const html = await renderIndex(file, p);
      expect(html).toMatch(/<\/div><\/div><section id="cs-boot-consent"[\s\S]*<\/section><script>/);
      expect(html).toContain(`id="${APP_CSS_ID}"`);
      expect(html).not.toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/index-a.css">/);
    }
  });
});

describe("route chunk preload", () => {
  it("modulepreloads the page's chunk, its imports and CSS, but nothing the entry already loads, nor a large dependency", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-preload-"));
    const file = join(dir, "index.html");
    writeFileSync(file, INDEX);
    mkdirSync(join(dir, ".vite"));
    writeFileSync(join(dir, ".vite", "manifest.json"), JSON.stringify({
      "index.html": { file: "assets/index-a.js", isEntry: true, imports: ["_vendor-react.js"], css: ["assets/index-a.css"] },
      "_vendor-react.js": { file: "assets/vendor-react-b.js" },
      "_chart.js": { file: "assets/chart-c.js", imports: ["_vendor-react.js"], css: ["assets/chart-c.css"] },
      "src/pages/TeamPage.tsx": { file: "assets/TeamPage-d.js", isDynamicEntry: true, imports: ["_chart.js", "_vendor-react.js"] },
      "_big.js": { file: "assets/big-f.js" },
      "src/pages/EventsPage.tsx": { file: "assets/EventsPage-e.js", isDynamicEntry: true, imports: ["_vendor-react.js", "_big.js"] },
    }));
    mkdirSync(join(dir, "assets"));
    for (const f of ["TeamPage-d.js", "chart-c.js", "EventsPage-e.js"]) writeFileSync(join(dir, "assets", f), "x");
    writeFileSync(join(dir, "assets", "big-f.js"), "x".repeat(PRELOAD_MAX_DEP + 1));
    const team = routePreloads(file, "/teams/4215");
    expect(team).toContain('<link rel="modulepreload" crossorigin href="/assets/TeamPage-d.js" />');
    expect(team).toContain('<link rel="modulepreload" crossorigin href="/assets/chart-c.js" />');
    expect(team).toContain('<link rel="preload" as="style" crossorigin href="/assets/chart-c.css" />'); // never render-blocking
    expect(team).not.toContain("vendor-react");
    expect(team).not.toContain("index-a");
    // A large shared dependency waits for the app (it would compete with the first paint).
    expect(routePreloads(file, "/events")).toBe('<link rel="modulepreload" crossorigin href="/assets/EventsPage-e.js" />');
    expect(routePreloads(file, "/")).toBe(""); // Home is in the main bundle
  });

  it("no manifest (dev, tests): no preloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-nomanifest-"));
    writeFileSync(join(dir, "index.html"), INDEX);
    expect(routePreloads(join(dir, "index.html"), "/teams/4215")).toBe("");
  });
});
