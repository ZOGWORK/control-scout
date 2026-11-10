// A page's first paint, for team, event and pre-filled compare pages: the real page, rendered here from the same answers
// its API calls give, plus those answers for the app to start from (src/lib/pageData.ts). A team page's: its profile, the
// season's matches and the site's metadata; an event page's: the event's detail, its result changes and the metadata; a
// compare page's (/compare?teams=4215,7149): the comparison itself, so a tap from a search answer lands on the teams. The
// render itself is the server-side bundle's (src/prerender/page.tsx, built by npm run build into build/ssr): before a
// build (dev, tests) there's none, and the page keeps its plain first paint (server/seoMeta.ts).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareAnswer, teamProfile } from "./api/teams.js";
import { matchViews } from "./api/matches.js";
import { eventView } from "./api/eventView.js";
import { resultChanges } from "./api/resultChanges.js";
import { siteMeta } from "./api/meta.js";
import { CURRENT_SEASON, SEASON_NUMBERS, isLegacy } from "./data/seasons.js";
import { storedEventCode } from "./eventCodes.js";
import { isEventCodeParam } from "../src/shared/eventCode.js";
import { compareApiPath, compareSeasonOf, compareTeamsOf } from "../src/shared/compareUrl.js";
import type { CompareView } from "../src/shared/api.js";
import { matchApiPath, matchupOf, modeOf } from "../src/shared/predictUrl.js";
import { matchExplanation } from "./api/predictMatch.js";
import { isEnabled } from "./flags.js";

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
  if (season == null || !isEventCodeParam(codeRaw)) return null;
  const code = await storedEventCode(season, codeRaw); // any case (src/shared/eventCode.ts)
  // The page asks with the address's own spelling (src/pages/EventPage.tsx): /api/events/2025/usnjcmp stays lowercase.
  const base = `/api/events/${seasonRaw}/${codeRaw}`;
  return draw(`/events/${seasonRaw}/${codeRaw}${search}`, `event ${season} ${code}`, async () => {
    const [d, changes, meta] = await Promise.all([eventView(season, code), resultChanges(season, code), siteMeta()]);
    if (!d) return null;
    // The timeline asks by the event's own season and code (src/components/ResultChanges.tsx).
    return { "/api/meta": meta, [base]: d, ...(changes ? { [`/api/events/${d.event.season}/${encodeURIComponent(d.event.code)}/result-changes`]: changes } : {}) };
  });
}

/**
 * A pre-filled Compare page as its first paint, for `/compare?teams=…&season=…` (`sp`: the address's query). Null when there
 * are no teams to compare, the season isn't one the API covers (the app shows its error), or it can't be drawn here.
 */
export async function compareFirstPaint(sp: URLSearchParams): Promise<(FirstPaint & { view: CompareView }) | null> {
  // Read as the page reads it (src/shared/compareUrl.ts), so the answer's key is the one its useApi asks for.
  const teams = compareTeamsOf(sp.get("teams"));
  if (!teams.length) return null;
  const asked = compareSeasonOf(sp.get("season"));
  if (asked != null && !SEASON_NUMBERS.includes(asked)) return null;
  const key = compareApiPath(teams, asked);
  let view: CompareView | null = null;
  const fp = await draw(`/compare?${sp.toString()}`, `compare ${teams.join(",")}`, async () => {
    const [d, meta] = await Promise.all([compareAnswer(teams.map(Number), asked ?? undefined), siteMeta()]);
    view = d;
    return { "/api/meta": meta, [key]: d };
  });
  return fp && view ? { ...fp, view } : null;
}

/**
 * A pre-filled Predict matchup as its first paint, for `/predict?mode=match&season=…&red=…&blue=…` (`sp`: the address's
 * query): the teams in their boxes with their names, and, when both sides are given, the prediction itself (win odds,
 * scores, the reasons), so a tap from a team page or a search answer lands on the teams, not an empty shell. Null for
 * another mode, no team at all, a season with no predictions, live predictions switched off, or no render here.
 */
export async function predictFirstPaint(sp: URLSearchParams): Promise<FirstPaint | null> {
  if (modeOf(sp) !== "match") return null;
  // As the page reads the address (src/pages/PredictPage.tsx MatchLab): the season, or the current one.
  const season = Number(sp.get("season")) || CURRENT_SEASON;
  if (!SEASON_NUMBERS.includes(season) || isLegacy(season)) return null;
  const listed = (v: string | null) => (v ?? "").split(",").map((x) => x.trim()).filter((x) => /^\d{1,6}$/.test(x) && Number(x) > 0).slice(0, 2).map(Number);
  const teams = [...new Set([...listed(sp.get("red")), ...listed(sp.get("blue"))])];
  if (!teams.length || !(await isEnabled("livePredictions"))) return null;
  const m = matchupOf(sp.get("red"), sp.get("blue"));
  return draw(`/predict?${sp.toString()}`, `predict ${teams.join(",")}`, async () => {
    const [meta, x, ...profiles] = await Promise.all([siteMeta(), m ? matchExplanation(season, m.red, m.blue) : null, ...teams.map((n) => teamProfile(n))]);
    // Each team's page answer, as the team boxes look a name up (src/components/TeamInput.tsx): its name under its number.
    const named = Object.fromEntries(teams.flatMap((n, i) => (profiles[i] ? [[`/api/teams/${n}`, profiles[i]]] : [])));
    return { "/api/meta": meta, ...named, ...(m && x ? { [matchApiPath(season, m.red, m.blue)]: x } : {}) };
  });
}
