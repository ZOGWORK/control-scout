// The first HTML paints before the JavaScript: the shell's outline and the
// page's own title (server/bootShell.ts), with the page's code chunk preloaded
// from Vite's manifest (server/seo.ts routePreloads).
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PRELOAD_MAX_DEP, renderIndex, routePreloads } from "./seo";
import { bootShell } from "./bootShell";
import { migrate, openDb, run, setDb } from "./db";
import { pageModule, pageTitle } from "../src/shared/routes";

const INDEX = '<html><head><title>x</title>\n</head><body><div id="root"><!--cs-boot--></div><script type="module" src="/assets/index-a.js"></script></body></html>';
const root = (html: string) => /<div id="root">([\s\S]*)<\/div><script type="module"/.exec(html)![1];

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
  });
});

describe("static first paint", () => {
  const dir = mkdtempSync(join(tmpdir(), "cs-boot-"));
  const file = join(dir, "index.html");
  writeFileSync(file, INDEX);

  it("puts the shell and the page's own title and description inside #root, escaped", async () => {
    const html = await renderIndex(file, "/teams/4215");
    const r = root(html);
    expect(r).toContain('<h1>Team 4215 — Hypnotic &lt;Robotics&gt; &amp; $&amp;</h1>');
    expect(r).toMatch(/<p>FTC team 4215 Hypnotic &lt;Robotics&gt; &amp; \$&amp; from Oradell, NJ\./);
    expect(r).toContain('<b>Team</b>'); // the top bar's page name
    expect(r).toContain('<a href="/teams" aria-current="page">'); // the sidebar marks the section
    expect(r).not.toContain('<a href="/" aria-current');
    expect(r).toContain('data-path="/teams/4215"');
    expect(html).toContain('<style>'); // its styles come with it (no wait for the app's CSS)
  });

  it("home shows the wordmark heading; a page with no title of its own gets the shell alone", async () => {
    const home = root(await renderIndex(file, "/"));
    expect(home).toContain('<h1><img src="/wordmark.png" alt="FTC Control Scout"');
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
