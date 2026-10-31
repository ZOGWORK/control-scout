// Event-day bundles (docs/event-bundle.md; types and rules: src/shared/eventBundle.ts). One download before
// leaving for the venue: an event's slice of the data, the event teams' ratings for the in-browser engine, frozen
// "Know your match" reports for your team's matches and your workspace's pick list (static HTML, snapshotHtml.ts),
// the question-box rules reference (pluggable; src/shared/rules by default) and a venue card, stamped with a manifest of contents, versions and sizes.
//
//   GET /api/bundles/:season/:code/manifest?team=N&workspace=ID  what the download holds, its size and SHA-256
//   GET /api/bundles/:season/:code/file?team=N&workspace=ID&v=VERSION  the bundle (gzipped JSON)
//
// Built on request, since a bundle is personal (your team's matches, your workspace's pick list): the workspace
// parts need the signed-in account to be a member right now (workspaceAccess, as every workspace read), and the
// answers are private, never stored by a shared cache. A build is kept a few minutes for that asker, so the
// file downloaded is the one the manifest described. Same data, same version: the version hashes the contents
// (not the build time), so the Download page's Update and Update all appear only when something changed.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { kvGet } from "../db.js";
import { SEASON_NUMBERS } from "../data/seasons.js";
import { cachedEventDetail } from "../api/events.js";
import { matchReport } from "../api/matchReport.js";
import { liveForecaster } from "../predict/engine.js";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { featureDisabled, isEnabled, requireFeature } from "../flags.js";
import { normalEventCode } from "../../src/shared/assignments.js";
import { BUNDLE_FORMAT, sliceBook, stableJson, type BundleManifest, type BundleSection, type BundleSectionId, type EventBundle, type HtmlSnapshot, type RulesSection, type VenueCard } from "../../src/shared/eventBundle.js";
import type { EventDetail, MatchView } from "../../src/shared/api.js";
import type { MatchReportWorkspace } from "../../src/shared/matchReport.js";
import { accessError, workspaceAccess, workspacePaused } from "../scout/entries.js";
import { consensusFor } from "../scout/consensus.js";
import { readPickList } from "../scout/picklist.js";
import { matchReportHtml, picklistHtml, rulesHtml } from "./snapshotHtml.js";
import { hasRuleReference, ruleReference } from "../../src/shared/rules/index.js";

/** A build answers the same asker this long (the manifest, then its file). */
export const BUNDLE_TTL_MS = 5 * 60_000;
const MAX_CACHED = 50;
/** Your matches: every one at the event, but never more than this many reports in one bundle. */
export const MAX_REPORTS = 24;

// --- The rules reference: pluggable ------------------------------------------------------------------------
/** Gives the rules reference for an event's season, or null when there's none to ship yet. */
export type RulesProvider = (season: number, code: string) => Promise<RulesSection | null>;
/** The question-box rules reference (src/shared/rules) for the season, while its owner switch is on; null for a
 *  season it doesn't cover. */
export const defaultRulesProvider: RulesProvider = async (season) => {
  if (!hasRuleReference(season) || !(await isEnabled("rulesReference"))) return null;
  const ref = ruleReference(season);
  return { title: `${ref.game} rules reference`, version: `${ref.manual.revision}|${ref.qa.readOn}|${ref.rules.length}|${ref.rulings.length}`, html: rulesHtml(ref) };
};
let rulesProvider: RulesProvider = defaultRulesProvider;
/** The rules reference's own module plugs in here (and tests). */
export function setRulesProvider(fn: RulesProvider) { rulesProvider = fn; }

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

interface BuildInput { season: number; code: string; team: number | null; workspace: { id: string; name: string } | null }
export interface BuiltBundle { manifest: BundleManifest; gz: Buffer; at: number }

const teamsOf = (m: MatchView) => [...m.red.teams, ...m.blue.teams].map((t) => t.number);

function venueOf(ev: EventDetail): VenueCard {
  const e = ev.event;
  return { name: e.name, typeLabel: e.typeLabel, venue: e.venue ?? ev.provisional?.venue ?? null, address: e.address ?? null, city: e.city, state: e.state, country: e.country,
    start: e.start, end: e.end, timezone: e.timezone, website: e.website, livestream: e.livestream };
}

/** `value` is what the version hashes; `stored` (default: the same) is what ships, whose size the manifest shows. */
function section(id: BundleSectionId, label: string, value: unknown, items: number, note: string | null = null, stored: unknown = value): BundleSection {
  const text = stableJson(value ?? null);
  return { id, label, version: sha(text).slice(0, 10), bytes: Buffer.byteLength(JSON.stringify(stored ?? null)), items, note };
}

/** Build one bundle (access to the workspace already checked). Null: no such event. */
export async function buildBundle(input: BuildInput): Promise<BuiltBundle | null> {
  const { season, code, team, workspace } = input;
  const ev = await cachedEventDetail(season, code);
  if (!ev) return null;
  const builtAt = new Date().toISOString();
  const sync = await kvGet<{ at: string }>("sync:last");
  const dataAsOf = ev.live?.checkedAt ?? sync?.at ?? null;
  const asOf = dataAsOf ?? builtAt;
  const tz = ev.event.timezone;
  const fieldTeams = ev.field.map((f) => f.team);

  // The event teams' ratings for the in-browser engine (the lite pack's book, cut to this event).
  const book = (await liveForecaster(season)).book(season);
  const ratings = book ? sliceBook(book.toData(), fieldTeams) : null;

  // The workspace's half: consensus on the event's teams and the pick list, read once for every report.
  let wsPart: { consensus: Awaited<ReturnType<typeof consensusFor>>; picks: Awaited<ReturnType<typeof readPickList>> } | null = null;
  if (workspace) {
    const [consensus, picks] = await Promise.all([consensusFor(workspace.id, season, fieldTeams), readPickList(workspace.id, season)]);
    wsPart = { consensus, picks };
  }

  // Your team's matches, frozen as static HTML.
  const reports: HtmlSnapshot[] = [];
  // What the reports are made of, for their version: the HTML prints the snapshot time, which moves without new data.
  const reportData: unknown[] = [];
  const mine = team != null ? ev.matches.filter((m) => teamsOf(m).includes(team)).slice(0, MAX_REPORTS) : [];
  for (const m of mine) {
    const r = await matchReport(season, code, m.key);
    if (!r) continue;
    const lineup = r.teams.map((t) => t.team);
    const ws: MatchReportWorkspace | null = wsPart && workspace ? {
      workspaceId: workspace.id, season,
      teams: wsPart.consensus.filter((c) => lineup.includes(c.team)),
      picklist: wsPart.picks.picks.map((p) => p.team).filter((t) => lineup.includes(t)),
      assignedToMe: [],
    } : null;
    reportData.push({ r, ws });
    reports.push({ key: m.key, label: m.label, time: m.time, html: matchReportHtml(r, ws, { asOf, timezone: tz, mine: team, workspaceName: workspace?.name ?? null }) });
  }

  const picklist = wsPart && workspace
    ? { key: "picklist", label: "Pick list", time: null, count: wsPart.picks.picks.length, html: picklistHtml(wsPart.picks, ev, { asOf, workspaceName: workspace.name }) }
    : null;
  const rules = await rulesProvider(season, code).catch(() => null);
  const venue = venueOf(ev);

  const sections: BundleSection[] = [
    section("event", "Teams, schedule and rankings", ev, ev.field.length, ev.matches.length ? null : "No schedule published yet: it's in the bundle once FIRST posts it."),
    // The book's clock (`now`) moves with every build; the ratings themselves only with new results.
    section("ratings", "Ratings for offline predictions", ratings && { ...ratings, now: 0 }, ratings?.ratings.length ?? 0, ratings ? null : "No ratings for this season yet."),
    section("reports", "Know your match reports", reportData, reports.length,
      team == null ? "Pick your team to include its matches." : !mine.length ? `Team ${team} has no matches scheduled here yet.` : null, reports),
    section("picklist", "Pick list", wsPart ? { picks: wsPart.picks, field: ev.field.map((f) => [f.team, f.name, f.rank, f.opr.np]) } : null, picklist?.count ?? 0, workspace ? null : "Sign in with a scouting workspace to include its pick list.", picklist),
    section("rules", "Rules reference", rules, rules ? 1 : 0, rules ? null : "No rules reference for this season yet."),
    section("venue", "Venue card", venue, 1),
  ];
  const version = sha(sections.map((s) => `${s.id}:${s.version}`).join("|") + `|${team ?? ""}|${workspace?.id ?? ""}|${BUNDLE_FORMAT}`).slice(0, 12);
  const head: EventBundle["manifest"] = {
    format: BUNDLE_FORMAT, season, code: ev.event.code, name: ev.event.name, end: ev.event.end ?? ev.event.start, version, builtAt, dataAsOf,
    engineVersion: ENGINE_VERSION, team, workspace, sections, field: ev.field.map((f) => [f.team, f.name]), reportKeys: reports.map((r) => r.key),
  };
  const body: EventBundle = { format: BUNDLE_FORMAT, manifest: head, event: ev, ratings, reports, picklist, rules, venue };
  const gz = gzipSync(Buffer.from(JSON.stringify(body)), { level: 9 });
  const q = new URLSearchParams({ ...(team != null ? { team: String(team) } : {}), ...(workspace ? { workspace: workspace.id } : {}), v: version });
  const manifest: BundleManifest = { ...head, url: `/api/bundles/${season}/${encodeURIComponent(ev.event.code)}/file?${q}`, bytes: gz.length, sha256: sha(gz) };
  return { manifest, gz, at: Date.now() };
}

// One build per asker and request, kept BUNDLE_TTL_MS (the newest MAX_CACHED).
const built = new Map<string, BuiltBundle>();
const building = new Map<string, Promise<BuiltBundle | null>>();
/** Tests: forget every build. */
export function clearBundleCache() { built.clear(); building.clear(); }

async function cachedBuild(key: string, input: BuildInput, fresh: boolean): Promise<BuiltBundle | null> {
  const hit = built.get(key);
  if (hit && !fresh && Date.now() - hit.at < BUNDLE_TTL_MS) return hit;
  let p = building.get(key);
  if (!p) {
    p = buildBundle(input).finally(() => building.delete(key));
    building.set(key, p);
  }
  const b = await p;
  if (b) {
    built.delete(key);
    built.set(key, b);
    while (built.size > MAX_CACHED) built.delete(built.keys().next().value!);
  }
  return b;
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

/** The request's bundle inputs, checked; or an answer already sent. */
async function inputs(req: Request, res: Response): Promise<{ input: BuildInput; key: string } | null> {
  res.set("Cache-Control", "private, no-store");
  const season = Number(req.params.season);
  if (!SEASON_NUMBERS.includes(season)) { res.status(404).json({ error: `Season ${req.params.season} isn't covered.` }); return null; }
  const code = normalEventCode(req.params.code);
  if (!code) { res.status(400).json({ error: "That isn't an event code." }); return null; }
  const rawTeam = req.query.team;
  const team = rawTeam == null || rawTeam === "" ? null : Number(rawTeam);
  if (team != null && !(Number.isSafeInteger(team) && team > 0 && team < 1e6)) { res.status(400).json({ error: "team must be a team number" }); return null; }
  let workspace: BuildInput["workspace"] = null;
  const wsId = req.query.workspace;
  const user = await currentUser(req);
  if (wsId != null && wsId !== "") {
    if (typeof wsId !== "string" || !isWorkspaceId(wsId)) { res.status(400).json({ error: "workspace must be a workspace id" }); return null; }
    if (!user) { res.status(401).json({ error: "Sign in first." }); return null; }
    if (await workspacePaused(res, wsId)) return null;
    const access = await workspaceAccess(user, wsId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return null; }
    workspace = { id: wsId, name: access.membership.workspaceName || "Your workspace" };
  }
  // A workspace bundle is the member's own; a public one is the same for everyone (cached once).
  const key = `${workspace ? `u${user!.id}` : "public"}|${season}|${code}|${team ?? ""}|${workspace?.id ?? ""}`;
  return { input: { season, code, team, workspace }, key };
}

export function bundleRouter(): Router {
  const r = express.Router();
  // Part of offline packs: paused with them (the offlinePacks toggle), and switched off on its own (eventBundle).
  // Either way only new builds are refused: bundles already on a device are never asked for again.
  r.use((_req: Request, res: Response, next: NextFunction) => {
    isEnabled("offlinePacks").then((on) => (on ? next() : featureDisabled(res, "offlinePacks", { paused: true })), next);
  });
  r.use(requireFeature("eventBundle"));
  r.get("/:season/:code/manifest", h(async (req, res) => {
    const x = await inputs(req, res);
    if (!x) return;
    // Asked fresh each time the Download page looks (that's how it finds an update); the file then reuses it.
    const b = await cachedBuild(x.key, x.input, true);
    if (!b) { res.status(404).json({ error: `No event ${x.input.code} in ${x.input.season}.` }); return; }
    return b.manifest;
  }));
  r.get("/:season/:code/file", h(async (req, res) => {
    const x = await inputs(req, res);
    if (!x) return;
    let b = await cachedBuild(x.key, x.input, false);
    // The version asked for is gone (data moved on): the newest build answers, and says its version.
    if (b && typeof req.query.v === "string" && req.query.v !== b.manifest.version) b = await cachedBuild(x.key, x.input, true);
    if (!b) { res.status(404).json({ error: `No event ${x.input.code} in ${x.input.season}.` }); return; }
    res.set("Content-Type", "application/gzip");
    res.set("X-Bundle-Version", b.manifest.version);
    res.set("X-Bundle-Sha256", b.manifest.sha256);
    res.set("Content-Disposition", `attachment; filename="control-scout-${b.manifest.season}-${b.manifest.code}-bundle.json.gz"`);
    res.send(b.gz);
  }));
  return r;
}
