// A page's first paint, for team and event pages: the real page, rendered here from the same answers its API calls
// give, plus those answers for the app to start from (src/lib/pageData.ts). A team page's: its profile, the season's
// matches and the site's metadata; an event page's: the event's detail, its result changes and the metadata. The
// render itself is the server-side bundle's (src/prerender/page.tsx, built by npm run build into build/ssr): before a
// build (dev, tests) there's none, and the page keeps its plain first paint (server/seoMeta.ts).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { teamProfile } from "./api/teams.js";
import { matchViews } from "./api/matches.js";
import { eventView } from "./api/eventView.js";
import { resultChanges } from "./api/resultChanges.js";
import { siteMeta } from "./api/meta.js";
import { SEASON_NUMBERS } from "./data/seasons.js";

export interface FirstPaint {
  /** The page's markup, as the app draws it. */
  html: string;
  /** API path → its answer, exactly as the app asks for it. */
  data: Record<string, unknown>;
}

type Render = (url: string, data: Record<string, unknown>) => string;
let render: Promise<Render | null> | null = null;
/** The build's render function, loaded once (null when there's no build). */
function renderer(): Promise<Render | null> {
  render ??= (async () => {
    const f = join(process.env.CS_SSR_DIR ?? join(process.cwd(), "build", "ssr"), "index.js");
    // Unit tests see the plain first paint whether or not a build is lying around (setPageRenderer opts in).
    if (process.env.VITEST || !existsSync(f)) return null;
    try {
      return ((await import(pathToFileURL(f).href)) as { renderAppPage: Render }).renderAppPage;
    } catch (e) {
      console.warn(`first paint: page render unavailable: ${(e as Error).message}`);
      return null;
    }
  })();
  return render;
}

/** For tests: use this render function (or none) instead of the build's. */
export function setPageRenderer(fn: Render | null) { render = Promise.resolve(fn); }

/** A season the API covers, as written in an address ("2025"), else null. */
const covered = (raw: string) => (/^\d{4}$/.test(raw) && SEASON_NUMBERS.includes(Number(raw)) ? Number(raw) : null);

/** Draw `url` from the answers `gather` collects (null: nothing to draw). Any failure leaves the plain first paint. */
async function draw(url: string, what: string, gather: () => Promise<Record<string, unknown> | null>): Promise<FirstPaint | null> {
  const fn = await renderer();
  if (!fn) return null;
  try {
    const data = await gather();
    if (!data) return null;
    // Through JSON first: the render sees exactly what the app will (dates as strings, no undefined).
    const sent = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    return { html: fn(url, sent), data: sent };
  } catch (e) {
    console.warn(`first paint: ${what} not rendered: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Team `n`'s page as its first paint, for `/teams/n` (`seasonRaw`: the address's ?season=, as written). Null when it
 * can't be drawn here (no build, a season the API would refuse, no such team, or the render failed).
 */
export async function teamFirstPaint(n: number, seasonRaw?: string): Promise<FirstPaint | null> {
  // The app asks for ?season= exactly as the address has it: only a covered season is drawn (the API refuses the rest).
  const asked = seasonRaw != null && seasonRaw !== "" ? seasonRaw : null;
  if (asked != null && covered(asked) == null) return null;
  const url = `/teams/${n}${asked != null ? `?season=${asked}` : ""}`;
  return draw(url, `team ${n}`, async () => {
    const p = await teamProfile(n, asked != null ? Number(asked) : undefined);
    if (!p) return null;
    const [matches, meta] = await Promise.all([matchViews({ season: p.season, team: n }, { predictUnplayed: true }), siteMeta()]);
    // The same keys the page's useApi calls build (src/pages/TeamPage.tsx), and the same bodies the routes send (server/app.ts).
    return {
      "/api/meta": meta,
      [`/api${url}`]: p,
      [`/api/teams/${n}/matches?season=${p.season}`]: { team: n, season: p.season, matches },
    };
  });
}

/**
 * An event's page as its first paint, for `/events/:season/:code` (both as the address has them, decoded; `search`:
 * the address's query, "?tab=odds" or ""). Null when it can't be drawn here.
 */
export async function eventFirstPaint(seasonRaw: string, codeRaw: string, search: string): Promise<FirstPaint | null> {
  const season = covered(seasonRaw);
  if (season == null || !/^[A-Za-z0-9_-]{2,24}$/.test(codeRaw)) return null;
  const code = codeRaw.toUpperCase();
  // The page asks with the address's own spelling (src/pages/EventPage.tsx): /api/events/2025/usnjcmp stays lowercase.
  const base = `/api/events/${seasonRaw}/${codeRaw}`;
  return draw(`/events/${seasonRaw}/${codeRaw}${search}`, `event ${season} ${code}`, async () => {
    const [d, changes, meta] = await Promise.all([eventView(season, code), resultChanges(season, code), siteMeta()]);
    if (!d) return null;
    // The timeline asks by the event's own season and code (src/components/ResultChanges.tsx).
    return { "/api/meta": meta, [base]: d, ...(changes ? { [`/api/events/${d.event.season}/${encodeURIComponent(d.event.code)}/result-changes`]: changes } : {}) };
  });
}
