// Scout consensus (v1.6 Task 1): a workspace's live entries on a team, rolled up per season into averages,
// strengths / weaknesses and tags (the rules: src/shared/consensus.ts). Docs: docs/shared-accounts.md,
// "Scout consensus".
//
// - GET /api/scout/workspaces/:workspaceId/consensus?season=YYYY&teams=1,2,3 (up to CONSENSUS_MAX_TEAMS):
//   members only, exactly as reading the workspace's entries (workspaceAccess: 401 signed out, 403 not a
//   member, 403 feature_disabled while workspace scouting is switched off for the workspace; a read-only (orphaned) space still reads). One answer
//   per team asked for, in that order; a team with no entries has entries 0. Never cached by a browser or
//   proxy beyond the asking user (private, no-store).
// - consensusFor(workspaceId, season, teams) is the same answer for server code that has already checked
//   membership (the pre-match report). It reads one workspace only: entries, and the template versions
//   they were made with, of that workspace; a template id naming another workspace is read as the built-in.
// - consensusForScope(scope, season, teams) widens that to a ConsensusScope: several workspaces' entries, each
//   read with its own workspace's templates, optionally at one event only (a scouting alliance: alliances.ts).
// - Cache: per scope, season and team, for CACHE_TTL_MS. Every accepted entry write to a workspace
//   (bus.ts onEntriesWritten: adds, edits, deletes, restores) drops every cached scope with that workspace at once,
//   so the TTL only bounds what nothing announced (it's a backstop, ~60 s as the brief allows).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all } from "../db.js";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { builtinTemplate } from "../../src/shared/scoutDefaults.js";
import { parseWorkspaceTemplateId, type ScoutField, type TemplateKind } from "../../src/shared/scoutTemplate.js";
import { aggregateConsensus, CONSENSUS_MAX_TEAMS, fieldGrouper, type ConsensusEntry, type ConsensusResponse, type TeamConsensus } from "../../src/shared/consensus.js";
import { accessError, workspaceAccess, workspacePaused } from "./entries.js";
import { onEntriesWritten } from "./bus.js";
import { templateVersion } from "./templates.js";

export const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5_000;

/**
 * Which entries a consensus reads: the live entries of these workspaces (one, for a workspace's own consensus;
 * two linked by a scouting alliance, alliances.ts), only those at `eventCode` when it's set. The caller has
 * already checked the reader may see every workspace in it, for that event.
 */
export interface ConsensusScope {
  workspaces: string[]; eventCode?: string;
  /** Read each observation once: a workspace's copy (kept from an earlier alliance) is skipped while its original, in another workspace of the scope, is live at the same event. */
  oneEach?: boolean;
}
const scopeKey = (s: ConsensusScope) => `${[...new Set(s.workspaces)].sort().join("+")}@${s.eventCode?.toUpperCase() ?? ""}${s.oneEach ? "#1" : ""}`;

/**
 * SQL: the entry row `w` (in workspace `wsCol`) isn't a copy (kept when an alliance ended: scout_alliance_copies) whose
 * original, in one of these workspaces, is still live at the same season and event, so is read itself. A copy whose
 * original was deleted (or moved) since is the only one left of that observation, and is read. Its `n`
 * placeholders are the workspaces.
 */
export const notACopyWithin = (w: string, wsCol: string, n: number) =>
  `NOT EXISTS (SELECT 1 FROM scout_alliance_copies c
      JOIN workspaces ow ON ow.cp_workspace_id = c.origin_ws
      JOIN workspace_scout_entries o ON o.workspace_id = ow.id AND o.uuid = c.origin_uuid AND o.deleted = 0
        AND o.season = ${w}.season AND UPPER(o.event_code) = UPPER(${w}.event_code)
     WHERE c.to_ws = ${wsCol} AND c.copy_uuid = ${w}.uuid AND c.origin_ws IN (${Array(n).fill("?").join(", ")}))`;

/** scope key -> "season:team" -> computed consensus. */
const cache = new Map<string, { workspaces: string[]; teams: Map<string, { at: number; value: TeamConsensus }> }>();
/** Bumped on every write to a workspace: a computation that started before it is never cached. */
const generation = new Map<string, number>();
let cached = 0;
let now = () => Date.now();

/** Tests: a fake clock. */
export function setConsensusClock(fn: (() => number) | null) { now = fn ?? (() => Date.now()); }
/** Tests and the owner portal: drop everything. */
export function clearConsensusCache() { cache.clear(); generation.clear(); cached = 0; }
/** Drop a workspace's cached consensus (all its seasons and teams, and every scope it's part of). */
export function invalidateConsensus(workspaceId: string) {
  generation.set(workspaceId, (generation.get(workspaceId) ?? 0) + 1);
  for (const [key, c] of cache) if (c.workspaces.includes(workspaceId)) { cached -= c.teams.size; cache.delete(key); }
}
// An edit can move an entry from one team (or season) to another, so a write drops the whole workspace.
onEntriesWritten((workspaceId) => invalidateConsensus(workspaceId));

const generationOf = (s: ConsensusScope) => s.workspaces.map((w) => generation.get(w) ?? 0).join(",");

function remember(scope: ConsensusScope, key: string, value: TeamConsensus) {
  if (cached >= CACHE_MAX) { clearConsensusCache(); } // rare: far more teams looked at than a minute's worth; start over
  const k = scopeKey(scope);
  let c = cache.get(k);
  if (!c) { c = { workspaces: [...new Set(scope.workspaces)], teams: new Map() }; cache.set(k, c); }
  if (!c.teams.has(key)) cached++;
  c.teams.set(key, { at: now(), value });
}

/** How many teams are cached now (tests). */
export const consensusCacheSize = () => cached;

/**
 * The consensus of `workspaceId`'s live entries on each of `teams` in `season`, in the order given (a team
 * with none: entries 0). The caller has already checked the reader is a member (workspaceAccess).
 */
export function consensusFor(workspaceId: string, season: number, teams: number[]): Promise<TeamConsensus[]> {
  return consensusForScope({ workspaces: [workspaceId] }, season, teams);
}

/** consensusFor over a scope (ConsensusScope): one consensus over every entry in it. */
export async function consensusForScope(scope: ConsensusScope, season: number, teams: number[]): Promise<TeamConsensus[]> {
  const wanted = [...new Set(teams)];
  const out = new Map<number, TeamConsensus>();
  const t = now();
  const m = cache.get(scopeKey(scope))?.teams;
  const missing: number[] = [];
  for (const team of wanted) {
    const hit = m?.get(`${season}:${team}`);
    if (hit && t - hit.at < CACHE_TTL_MS) out.set(team, hit.value);
    else missing.push(team);
  }
  if (missing.length) {
    const gen = generationOf(scope);
    const computed = await compute(scope, season, missing);
    const fresh = generationOf(scope) === gen; // no write landed while reading
    for (const team of missing) {
      const value = computed.get(team) ?? aggregateConsensus(team, []);
      out.set(team, value);
      if (fresh) remember(scope, `${season}:${team}`, value);
    }
  }
  return teams.map((team) => out.get(team)!);
}

async function compute(scope: ConsensusScope, season: number, teams: number[]): Promise<Map<number, TeamConsensus>> {
  const spaces = [...new Set(scope.workspaces)];
  if (!spaces.length) return new Map();
  const event = scope.eventCode?.toUpperCase();
  const rows = await all<any>(
    `SELECT ws.cp_workspace_id, w.team, w.kind, w.author_account_id, w.updated_at, w.data, w.template_id, w.template_version
       FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
      WHERE ws.cp_workspace_id IN (${spaces.map(() => "?").join(", ")}) AND w.season = ? AND w.deleted = 0${event ? " AND UPPER(w.event_code) = ?" : ""}
        AND w.team IN (${teams.map(() => "?").join(", ")})${scope.oneEach ? ` AND ${notACopyWithin("w", "ws.cp_workspace_id", spaces.length)}` : ""}`,
    [...spaces, season, ...(event ? [event] : []), ...teams, ...(scope.oneEach ? spaces : [])]);
  const readers = new Map(spaces.map((w) => [w, fieldReader(w)]));
  // Several workspaces: each has its own templates, so a field id is only averaged with fields asking the same question.
  const group = spaces.length > 1 ? fieldGrouper() : null;
  const byTeam = new Map<number, ConsensusEntry[]>();
  for (const r of rows) {
    const kind: TemplateKind = r.kind === "pit" ? "pit" : "match";
    let data: Record<string, unknown> = {};
    try { const d = JSON.parse(r.data); if (d && typeof d === "object" && !Array.isArray(d)) data = d; } catch { /* unreadable: no answers */ }
    const own = await readers.get(String(r.cp_workspace_id))!(season, kind, r.template_id ?? null, r.template_version == null ? 0 : Number(r.template_version));
    const read = group ? group(own, data) : { fields: own, data };
    const e: ConsensusEntry = {
      team: Number(r.team), kind, authorAccountId: Number(r.author_account_id), updatedAt: Number(r.updated_at), data: read.data, fields: read.fields,
    };
    const list = byTeam.get(e.team) ?? [];
    list.push(e);
    byTeam.set(e.team, list);
  }
  return new Map(teams.map((team) => [team, aggregateConsensus(team, byTeam.get(team) ?? [])]));
}

/**
 * The fields an entry was made with: its workspace template version (the entry's own workspace only), else the
 * built-in default of its season. Each version is read once per computation.
 */
export function fieldReader(workspaceId: string) {
  const versions = new Map<string, Promise<Awaited<ReturnType<typeof templateVersion>>>>();
  return async (season: number, kind: TemplateKind, templateId: string | null, version: number): Promise<ScoutField[]> => {
    const ws = parseWorkspaceTemplateId(templateId);
    if (!ws || ws.workspaceId !== workspaceId || version < 1) return builtinTemplate(season, kind).fields;
    const key = `${ws.season}:${version}`;
    let p = versions.get(key);
    if (!p) { p = templateVersion(workspaceId, ws.season, version); versions.set(key, p); }
    const t = await p;
    return t?.[kind] ?? builtinTemplate(season, kind).fields;
  };
}

const isSeason = (n: number) => Number.isSafeInteger(n) && n >= 2000 && n <= 2100;

/** "1,2,3" -> [1, 2, 3]; null when any part isn't a team number or there are too many. */
export function parseTeams(raw: unknown): number[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > CONSENSUS_MAX_TEAMS) return null;
  if (!parts.every((x) => /^\d{1,6}$/.test(x))) return null;
  const teams = parts.map(Number);
  return teams.every((n) => n >= 1) ? teams : null;
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

export function consensusRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/consensus", h(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (await workspacePaused(res, workspaceId)) return;
    const season = Number(req.query.season);
    if (!isSeason(season)) { res.status(400).json({ error: "season required" }); return; }
    const teams = parseTeams(req.query.teams);
    if (!teams) { res.status(400).json({ error: `teams: 1 to ${CONSENSUS_MAX_TEAMS} team numbers, comma separated` }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    const body: ConsensusResponse = { workspaceId, season, teams: await consensusFor(workspaceId, season, teams) };
    return body;
  }));
  return r;
}
