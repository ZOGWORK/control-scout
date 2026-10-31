// Light pages (docs/lite.md) under /lite: an event, a team, a match and a workspace's pick list as plain HTML
// for one bar of signal. A rendering of the same data the API answers with (the same functions, trimmed:
// ./trim.ts), never a second app. Public pages cache like the API (a minute, then stale while revalidating;
// revalidated every time on an event day); the pick list needs what the rich one needs (a member of the
// workspace, signed in) and is never cached. ?lite=1 on a rich page's address redirects to its twin.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all } from "../db.js";
import { CURRENT_SEASON, SEASON_NUMBERS } from "../data/seasons.js";
import { cachedEventDetail } from "../api/events.js";
import { matchDetail, matchViews } from "../api/matches.js";
import { teamProfile, teamSummaries } from "../api/teams.js";
import { canonicalUrl } from "../seo.js";
import { cspHeaderName } from "../securityHeaders.js";
import { currentUser } from "../auth/session.js";
import { controlPointInfo, isWorkspaceId, linkedAccountId } from "../auth/controlPoint.js";
import { workspaceAccess } from "../scout/entries.js";
import { isEnabled, isEnabledFor } from "../flags.js";
import { readPickList } from "../scout/picklist.js";
import { currentSettings } from "../scout/settings.js";
import { formerWorkspaces } from "../scout/orphans.js";
import { normalMatchKey } from "../../src/shared/matchReport.js";
import { fullHref, liteHref } from "../../src/shared/lite.js";
import { liteEvent, liteMatch, litePicks, liteTeam } from "./trim.js";
import { esc, eventPage, liteDocument, matchPage, messagePage, picklistPage, teamPage, type LitePage } from "./render.js";

/**
 * The workspaces an account reads when Control Point can't answer (and its last answer has expired): the memberships
 * saved from its last answer and the deleted workspaces it still reads as a former member, as /api/flags lists them.
 * workspaceAccess still accepts these, so the choice shouldn't say "No workspace" during an outage.
 */
async function savedWorkspaces(account: number): Promise<{ id: string; name: string }[]> {
  const [members, former] = await Promise.all([
    all<{ id: string; name: string }>("SELECT cp_workspace_id id, workspace_name name FROM workspace_members WHERE account_id = ? ORDER BY workspace_name, cp_workspace_id", [account]),
    formerWorkspaces(account),
  ]);
  const out = new Map(members.map((w) => [String(w.id), { id: String(w.id), name: String(w.name ?? "") }]));
  for (const w of former) if (!out.has(w.id)) out.set(w.id, { id: w.id, name: w.name });
  return [...out.values()];
}

/** No scripts, no images, no frames: a light page loads its HTML and nothing else. */
export const LITE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'";
export const PUBLIC_CACHE = "public, max-age=60, stale-while-revalidate=300";

type Cache = "public" | "revalidate" | "private";
function send(res: Response, page: LitePage, opts: { status?: number; cache?: Cache } = {}) {
  const status = opts.status ?? 200;
  const cache = status >= 400 ? "no-store" : opts.cache === "private" ? "private, no-store" : opts.cache === "revalidate" ? "no-cache" : PUBLIC_CACHE;
  res.setHeader("Cache-Control", cache);
  res.setHeader(cspHeaderName(), LITE_CSP);
  // The rich page is the one to index; this is a lighter copy of it.
  const canonical = status === 200 && opts.cache !== "private" ? canonicalUrl(page.full.split("?")[0]) : null;
  res.status(status).type("html").send(liteDocument(page, canonical));
}

const notFound = (req: Request, res: Response, text: string) =>
  send(res, messagePage("Not found", text, fullHref(`/lite${req.path}`, queryOf(req))), { status: 404 });
const queryOf = (req: Request) => { const i = req.originalUrl.indexOf("?"); return i >= 0 ? req.originalUrl.slice(i) : ""; };

const seasonOf = (x: unknown): number | null | undefined => {
  if (x == null || x === "") return undefined;
  const n = Number(x);
  return SEASON_NUMBERS.includes(n) ? n : null;
};
const CODE = /^[A-Za-z0-9_-]{2,24}$/;

const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

/** ?lite=1 on a rich page with a light twin: 302 there (the rest of the query as the twin reads it). Ignored while
 *  the owner has the light version switched off (the venueLightMode flag). */
export const liteSwitch = h(async (req, res, next) => {
  if ((req.method !== "GET" && req.method !== "HEAD") || req.query.lite !== "1") return next();
  const to = liteHref(req.path, queryOf(req));
  if (!to || !(await isEnabled("venueLightMode"))) return next();
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, to);
});

export function liteRouter(): Router {
  const r = express.Router();

  // Switched off by the owner (venueLightMode): every light address goes to its full page, never a dead end.
  r.use(h(async (req, res, next) => {
    if (await isEnabled("venueLightMode")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, fullHref(`/lite${req.path}`, queryOf(req)));
  }));

  r.get("/events/:season/:code", h(async (req, res) => {
    const season = seasonOf(req.params.season), code = String(req.params.code).toUpperCase();
    if (!season || !CODE.test(code)) return notFound(req, res, "There's no such event.");
    const d = await cachedEventDetail(season, code);
    if (!d) return notFound(req, res, `No event ${code} in ${season}.`);
    send(res, eventPage(liteEvent(d), `/events/${season}/${d.event.code}`), { cache: d.live ? "revalidate" : "public" });
  }));

  r.get("/events/:season/:code/match/:key", h(async (req, res) => {
    const season = seasonOf(req.params.season), code = String(req.params.code).toUpperCase(), key = normalMatchKey(req.params.key);
    if (!season || !CODE.test(code) || !key) return notFound(req, res, "There's no such match.");
    const event = await cachedEventDetail(season, code);
    const d = event ? await matchDetail(season, code, key, event) : null;
    if (!event || !d) return notFound(req, res, `No match ${key} at ${code}.`);
    send(res, matchPage(liteMatch(d), `/events/${season}/${event.event.code}/match/${key}`), { cache: event.live ? "revalidate" : "public" });
  }));

  r.get("/teams/:number", h(async (req, res) => {
    const n = Number(req.params.number);
    const season = seasonOf(req.query.season);
    if (!Number.isInteger(n) || n < 1 || n > 999999 || season === null) return notFound(req, res, "There's no such team or season.");
    const p = await teamProfile(n, season);
    if (!p) return notFound(req, res, `No FTC team ${n} in our data.`);
    const matches = await matchViews({ season: p.season, team: n }, { predictUnplayed: true });
    // Revalidated while the team has a match today or later (its results move); otherwise the usual minute.
    send(res, teamPage(liteTeam(p, matches), `/teams/${n}${season ? `?season=${season}` : ""}`), { cache: matches.some((m) => !m.played) ? "revalidate" : "public" });
  }));

  // The workspace's shared pick list, read-only: the same gate as GET /api/scout/workspaces/:id/picklist.
  r.get("/picklist", h(async (req, res) => {
    const full = fullHref("/lite/picklist", queryOf(req));
    const season = seasonOf(req.query.season);
    if (season === null) return notFound(req, res, "That season isn't covered.");
    // Carried on links only when it was asked for: otherwise each workspace's own default applies, as on the full page.
    const seasonParam = season ? `&amp;season=${season}` : "";
    const user = await currentUser(req);
    if (!user) return send(res, messagePage("Sign in first", "The pick list belongs to your workspace. Sign in on the full version, then come back here.", full), { status: 401 });
    const space = req.query.space;
    if (space === undefined || space === "") {
      // No workspace named: the account's workspaces as the app lists them (deleted ones a former member still reads
      // included), to pick one; straight to it when there's only one.
      const account = await linkedAccountId(user.id);
      const spaces = account == null ? [] : (await controlPointInfo(account))?.workspaces ?? await savedWorkspaces(account);
      if (spaces.length === 1) { res.setHeader("Cache-Control", "no-store"); return res.redirect(302, `/lite/picklist?space=${encodeURIComponent(spaces[0].id)}${seasonParam.replace("&amp;", "&")}`); }
      if (!spaces.length) return send(res, messagePage("No workspace", "Pick lists belong to a Control Point workspace, and this account isn't in one.", full), { cache: "private" });
      return send(res, messagePage("Pick list", "Which workspace?", full,
        `<ul>${spaces.map((w) => `<li><a href="/lite/picklist?space=${encodeURIComponent(w.id)}${seasonParam}">${esc(w.name.trim() || "Your workspace")}</a></li>`).join("")}</ul>`), { cache: "private" });
    }
    if (!isWorkspaceId(space)) return notFound(req, res, "There's no such workspace.");
    if (!(await isEnabledFor("workspaceScouting", space))) return send(res, messagePage("Paused", "Workspace scouting is paused for this workspace right now.", full), { status: 403 });
    const access = await workspaceAccess(user, space);
    if (!access.ok) return send(res, messagePage("No access", access.error, full), { status: access.status });
    // The season the full page opens on: the address's, else the workspace's default, else the current one.
    const preferred = season ?? (await currentSettings(space)).defaults.season;
    const s = preferred != null && SEASON_NUMBERS.includes(preferred) ? preferred : CURRENT_SEASON;
    const list = await readPickList(space, s);
    const summaries = await teamSummaries(list.picks.map((p) => p.team), s);
    send(res, picklistPage(litePicks(list, summaries), access.membership.workspaceName.trim() || "Your workspace", full), { cache: "private" });
  }));

  // Anything else under /lite: a 404 that still leads to the full site.
  r.use((req, res) => notFound(req, res, "There's no light version of this page."));
  // A failure is a page too, with its way to the full version (which may still work).
  r.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error("[lite]", err);
    send(res, messagePage("Something went wrong", "This page couldn't be built just now. Try again, or open the full version.", fullHref(`/lite${req.path}`, queryOf(req))), { status: 500 });
  });
  return r;
}
