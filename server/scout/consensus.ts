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
// - Cache: per workspace, season and team, for CACHE_TTL_MS. Every accepted entry write to a workspace
//   (bus.ts onEntriesWritten: adds, edits, deletes, restores) drops that workspace's cached teams at once,
//   so the TTL only bounds what nothing announced (it's a backstop, ~60 s as the brief allows).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all } from "../db.js";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { builtinTemplate } from "../../src/shared/scoutDefaults.js";
import { parseWorkspaceTemplateId, type ScoutField, type TemplateKind } from "../../src/shared/scoutTemplate.js";
import { aggregateConsensus, CONSENSUS_MAX_TEAMS, type ConsensusEntry, type ConsensusResponse, type TeamConsensus } from "../../src/shared/consensus.js";
import { accessError, workspaceAccess, workspacePaused } from "./entries.js";
import { onEntriesWritten } from "./bus.js";
import { templateVersion } from "./templates.js";

export const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5_000;

/** workspace -> "season:team" -> computed consensus. */
const cache = new Map<string, Map<string, { at: number; value: TeamConsensus }>>();
/** Bumped on every write to a workspace: a computation that started before it is never cached. */
const generation = new Map<string, number>();
let cached = 0;
let now = () => Date.now();

/** Tests: a fake clock. */
export function setConsensusClock(fn: (() => number) | null) { now = fn ?? (() => Date.now()); }
/** Tests and the owner portal: drop everything. */
export function clearConsensusCache() { cache.clear(); generation.clear(); cached = 0; }
/** Drop a workspace's cached consensus (all its seasons and teams). */
export function invalidateConsensus(workspaceId: string) {
  generation.set(workspaceId, (generation.get(workspaceId) ?? 0) + 1);
  const m = cache.get(workspaceId);
  if (m) { cached -= m.size; cache.delete(workspaceId); }
}
// An edit can move an entry from one team (or season) to another, so a write drops the whole workspace.
onEntriesWritten((workspaceId) => invalidateConsensus(workspaceId));

function remember(workspaceId: string, key: string, value: TeamConsensus) {
  if (cached >= CACHE_MAX) { clearConsensusCache(); } // rare: far more teams looked at than a minute's worth; start over
  let m = cache.get(workspaceId);
  if (!m) { m = new Map(); cache.set(workspaceId, m); }
  if (!m.has(key)) cached++;
  m.set(key, { at: now(), value });
}

/** How many teams are cached now (tests). */
export const consensusCacheSize = () => cached;

/**
 * The consensus of `workspaceId`'s live entries on each of `teams` in `season`, in the order given (a team
 * with none: entries 0). The caller has already checked the reader is a member (workspaceAccess).
 */
export async function consensusFor(workspaceId: string, season: number, teams: number[]): Promise<TeamConsensus[]> {
  const wanted = [...new Set(teams)];
  const out = new Map<number, TeamConsensus>();
  const t = now();
  const m = cache.get(workspaceId);
  const missing: number[] = [];
  for (const team of wanted) {
    const hit = m?.get(`${season}:${team}`);
    if (hit && t - hit.at < CACHE_TTL_MS) out.set(team, hit.value);
    else missing.push(team);
  }
  if (missing.length) {
    const gen = generation.get(workspaceId) ?? 0;
    const computed = await compute(workspaceId, season, missing);
    const fresh = (generation.get(workspaceId) ?? 0) === gen; // no write landed while reading
    for (const team of missing) {
      const value = computed.get(team) ?? aggregateConsensus(team, []);
      out.set(team, value);
      if (fresh) remember(workspaceId, `${season}:${team}`, value);
    }
  }
  return teams.map((team) => out.get(team)!);
}

async function compute(workspaceId: string, season: number, teams: number[]): Promise<Map<number, TeamConsensus>> {
  const rows = await all<any>(
    `SELECT w.team, w.kind, w.author_account_id, w.updated_at, w.data, w.template_id, w.template_version
       FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
      WHERE ws.cp_workspace_id = ? AND w.season = ? AND w.deleted = 0 AND w.team IN (${teams.map(() => "?").join(", ")})`,
    [workspaceId, season, ...teams]);
  const fields = fieldReader(workspaceId);
  const byTeam = new Map<number, ConsensusEntry[]>();
  for (const r of rows) {
    const kind: TemplateKind = r.kind === "pit" ? "pit" : "match";
    let data: Record<string, unknown> = {};
    try { const d = JSON.parse(r.data); if (d && typeof d === "object" && !Array.isArray(d)) data = d; } catch { /* unreadable: no answers */ }
    const e: ConsensusEntry = {
      team: Number(r.team), kind, authorAccountId: Number(r.author_account_id), updatedAt: Number(r.updated_at), data,
      fields: await fields(season, kind, r.template_id ?? null, r.template_version == null ? 0 : Number(r.template_version)),
    };
    const list = byTeam.get(e.team) ?? [];
    list.push(e);
    byTeam.set(e.team, list);
  }
  return new Map(teams.map((team) => [team, aggregateConsensus(team, byTeam.get(team) ?? [])]));
}

/**
 * The fields an entry was made with: its workspace template version (this workspace's only), else the
 * built-in default of its season. Each version is read once per computation.
 */
function fieldReader(workspaceId: string) {
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
