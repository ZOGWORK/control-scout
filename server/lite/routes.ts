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
import { esc, eventPage, liteDocument, list as rowList, listRow, matchPage, messagePage, picklistPage, teamPage, type LitePage, type LiteView } from "./render.js";
import { LITE_COOKIE, TEXT_SIZE_COOKIE, THEME_COOKIE, cookieValue, textSizeFromCookie, themeFromCookie } from "../../src/shared/themeTokens.js";
import { storedEventCode } from "../eventCodes.js";
import { eventPath, isEventCodeParam } from "../../src/shared/eventCode.js";

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

/** Lite is on (sticky): the cs-lite cookie. */
const isSticky = (req: Request) => cookieValue(req.headers.cookie, LITE_COOKIE) === "1";

/** How this visitor sees Lite: the app's theme and text size and whether Lite is on, from the cookies the app keeps
 *  (src/lib/liteCookies.ts; no script runs here to read its settings). */
export const viewOf = (req: Request): LiteView => ({
  theme: themeFromCookie(cookieValue(req.headers.cookie, THEME_COOKIE)),
  textSize: textSizeFromCookie(cookieValue(req.headers.cookie, TEXT_SIZE_COOKIE)),
  sticky: isSticky(req),
  here: req.originalUrl,
});

type Cache = "public" | "revalidate" | "private";
function send(req: Request, res: Response, page: LitePage, opts: { status?: number; cache?: Cache } = {}) {
  const status = opts.status ?? 200;
  const cache = status >= 400 ? "no-store" : opts.cache === "private" ? "private, no-store" : opts.cache === "revalidate" ? "no-cache" : PUBLIC_CACHE;
  res.setHeader("Cache-Control", cache);
  // The page follows the visitor's theme, text size and Lite setting (cookies): a cache keeps one copy per set.
  res.setHeader("Vary", "Cookie");
  res.setHeader(cspHeaderName(), LITE_CSP);
  // The rich page is the one to index; this is a lighter copy of it.
  const canonical = status === 200 && opts.cache !== "private" ? canonicalUrl(page.full.split("?")[0]) : null;
  res.status(status).type("html").send(liteDocument(page, canonical, viewOf(req)));
}

const notFound = (req: Request, res: Response, text: string) =>
  send(req, res, messagePage("Not found", text, fullHref(`/lite${req.path}`, queryOf(req))), { status: 404 });
const queryOf = (req: Request) => { const i = req.originalUrl.indexOf("?"); return i >= 0 ? req.originalUrl.slice(i) : ""; };

const seasonOf = (x: unknown): number | null | undefined => {
  if (x == null || x === "") return undefined;
  const n = Number(x);
  return SEASON_NUMBERS.includes(n) ? n : null;
};

const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

/** A page load in the browser (typed, linked, reloaded), not the app's own fetch of data or a script. */
const isNavigation = (req: Request) => {
  const mode = req.get("sec-fetch-mode");
  return mode ? mode === "navigate" : (req.get("accept") ?? "").includes("text/html");
};

/** ?lite=1 on a rich page with a Lite twin: 302 there (the rest of the query as the twin reads it). With Lite on
 *  (the cs-lite cookie), any page load of a rich page with a twin goes there too, unless it asks for the full page
 *  this once (?lite=0, Lite's "Full version"). Ignored while the owner has Lite switched off (venueLightMode). */
export const liteSwitch = h(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const asked = req.query.lite === "1";
  if (!asked && (req.query.lite === "0" || !isSticky(req) || !isNavigation(req))) return next();
  const to = liteHref(req.path, queryOf(req));
  if (!to || !(await isEnabled("venueLightMode"))) return next();
  res.setHeader("Cache-Control", "no-store");
  if (!asked) res.setHeader("Vary", "Cookie");
  res.redirect(302, to);
});

/** Where /lite/on and /lite/off go next: a path on this site (never another site), "/" otherwise. */
export function safeNext(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  if (!/^\/(?![/\\])/.test(s) || /[\u0000-\u001f\\]/.test(s)) return "/";
  try {
    const u = new URL(s, "http://x");
    const out = `${u.pathname}${u.search}`;
    // Checked again once normalized: "/a/..//evil.example" becomes "//evil.example", another site.
    return u.host === "x" && /^\/(?![/\\])/.test(out) ? out : "/";
  } catch { return "/"; }
}

/** The Vary header for an app page: one with a Lite twin is answered differently with Lite on (liteSwitch sends a
 *  page load there), so a cache must keep it per cookie; any other page only per encoding. */
export const pageVary = (path: string, search = "") => (liteHref(path, search) ? "Accept-Encoding, Cookie" : "Accept-Encoding");

const YEAR_MS = 31536000 * 1000;
/** Turn Lite on or off for this browser (docs/lite.md): a cookie, then on to `next`. Plain links, no script needed,
 *  so the settings (and Lite's own footer) can offer them. On: pages with a Lite version open in Lite. Off: back to
 *  the full version of where you were. */
export function liteToggleRouter(): Router {
  const r = express.Router();
  r.get("/on", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.cookie(LITE_COOKIE, "1", { path: "/", maxAge: YEAR_MS, sameSite: "lax", secure: req.secure });
    res.redirect(302, safeNext(req.query.next));
  });
  r.get("/off", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.clearCookie(LITE_COOKIE, { path: "/", sameSite: "lax", secure: req.secure });
    const next = safeNext(req.query.next);
    // Off from a Lite page: its full version (a Lite address would still be Lite).
    const q = next.indexOf("?");
    res.redirect(302, /^\/lite(\/|\?|$)/i.test(next) ? fullHref(q >= 0 ? next.slice(0, q) : next, q >= 0 ? next.slice(q) : "") : next);
  });
  return r;
}

export function liteRouter(): Router {
  const r = express.Router();
  // On and off work whatever the owner's switch says: turning Lite off must never be out of reach.
  r.use(liteToggleRouter());

  // Switched off by the owner (venueLightMode): every light address goes to its full page, never a dead end.
  r.use(h(async (req, res, next) => {
    if (await isEnabled("venueLightMode")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, fullHref(`/lite${req.path}`, queryOf(req)));
  }));

  r.get("/events/:season/:code", h(async (req, res) => {
    const season = seasonOf(req.params.season), raw = String(req.params.code);
    if (!season || !isEventCodeParam(raw)) return notFound(req, res, "There's no such event.");
    const code = await storedEventCode(season, raw); // any case (src/shared/eventCode.ts)
    const d = await cachedEventDetail(season, code);
    if (!d) return notFound(req, res, `No event ${code} in ${season}.`);
    send(req, res, eventPage(liteEvent(d), eventPath(season, d.event.code)), { cache: d.live ? "revalidate" : "public" });
  }));

  r.get("/events/:season/:code/match/:key", h(async (req, res) => {
    const season = seasonOf(req.params.season), raw = String(req.params.code), key = normalMatchKey(req.params.key);
    if (!season || !isEventCodeParam(raw) || !key) return notFound(req, res, "There's no such match.");
    const code = await storedEventCode(season, raw);
    const event = await cachedEventDetail(season, code);
    const d = event ? await matchDetail(season, code, key, event) : null;
    if (!event || !d) return notFound(req, res, `No match ${key} at ${code}.`);
    send(req, res, matchPage(liteMatch(d), `${eventPath(season, event.event.code)}/match/${key}`), { cache: event.live ? "revalidate" : "public" });
  }));

  r.get("/teams/:number", h(async (req, res) => {
    const n = Number(req.params.number);
    const season = seasonOf(req.query.season);
    if (!Number.isInteger(n) || n < 1 || n > 999999 || season === null) return notFound(req, res, "There's no such team or season.");
    const p = await teamProfile(n, season);
    if (!p) return notFound(req, res, `No FTC team ${n} in our data.`);
    const matches = await matchViews({ season: p.season, team: n }, { predictUnplayed: true });
    // Revalidated while the team has a match today or later (its results move); otherwise the usual minute.
    send(req, res, teamPage(liteTeam(p, matches), `/teams/${n}${season ? `?season=${season}` : ""}`), { cache: matches.some((m) => !m.played) ? "revalidate" : "public" });
  }));

  // The workspace's shared pick list, read-only: the same gate as GET /api/scout/workspaces/:id/picklist.
  r.get("/picklist", h(async (req, res) => {
    const full = fullHref("/lite/picklist", queryOf(req));
    const season = seasonOf(req.query.season);
    if (season === null) return notFound(req, res, "That season isn't covered.");
    // Carried on links only when it was asked for: otherwise each workspace's own default applies, as on the full page.
    const seasonParam = season ? `&season=${season}` : "";
    const user = await currentUser(req);
    if (!user) return send(req, res, messagePage("Sign in first", "The pick list belongs to your workspace. Sign in on the full version, then come back here.", full), { status: 401 });
    const space = req.query.space;
    if (space === undefined || space === "") {
      // No workspace named: the account's workspaces as the app lists them (deleted ones a former member still reads
      // included), to pick one; straight to it when there's only one.
      const account = await linkedAccountId(user.id);
      const spaces = account == null ? [] : (await controlPointInfo(account))?.workspaces ?? await savedWorkspaces(account);
      if (spaces.length === 1) { res.setHeader("Cache-Control", "no-store"); return res.redirect(302, `/lite/picklist?space=${encodeURIComponent(spaces[0].id)}${seasonParam}`); }
      if (!spaces.length) return send(req, res, messagePage("No workspace", "Pick lists belong to a Control Point workspace, and this account isn't in one.", full), { cache: "private" });
      return send(req, res, messagePage("Pick list", "Which workspace?", full,
        rowList(spaces.map((w) => listRow(`/lite/picklist?space=${encodeURIComponent(w.id)}${seasonParam}`, `<b>${esc(w.name.trim() || "Your workspace")}</b><span class="res">→</span>`, true)), "")), { cache: "private" });
    }
    if (!isWorkspaceId(space)) return notFound(req, res, "There's no such workspace.");
    if (!(await isEnabledFor("workspaceScouting", space))) return send(req, res, messagePage("Paused", "Workspace scouting is paused for this workspace right now.", full), { status: 403 });
    const access = await workspaceAccess(user, space);
    if (!access.ok) return send(req, res, messagePage("No access", access.error, full), { status: access.status });
    // The season the full page opens on: the address's, else the workspace's default, else the current one.
    const preferred = season ?? (await currentSettings(space)).defaults.season;
    const s = preferred != null && SEASON_NUMBERS.includes(preferred) ? preferred : CURRENT_SEASON;
    const list = await readPickList(space, s);
    const summaries = await teamSummaries(list.picks.map((p) => p.team), s);
    send(req, res, picklistPage(litePicks(list, summaries), access.membership.workspaceName.trim() || "Your workspace", full), { cache: "private" });
  }));

  // Anything else under /lite: a 404 that still leads to the full site.
  r.use((req, res) => notFound(req, res, "There's no Lite version of this page."));
  // A failure is a page too, with its way to the full version (which may still work).
  r.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error("[lite]", err);
    send(req, res, messagePage("Something went wrong", "This page couldn't be built just now. Try again, or open the full version.", fullHref(`/lite${req.path}`, queryOf(req))), { status: 500 });
  });
  return r;
}
