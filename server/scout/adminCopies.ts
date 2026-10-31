// An admin of several team workspaces scouts once: every entry they save in one of them is also saved in each of
// the others (owner decision, 2026-10-31). docs/workspaces.md, "Admin of several workspaces".
//
// The rules:
// - Server side, after the write to the workspace the device sent it to (POST /api/me/scout/sync), so an entry
//   queued offline and synced later is copied the same as one saved online, from every client.
// - Only when the writer is an admin of that workspace, and only into the other workspaces they're an admin of right
//   now (Control Point's roles, re-checked as every write is: workspaceAdminAccess), whose scouting isn't paused and
//   that aren't read-only. A member who isn't an admin anywhere else: nothing changes. Personal entries are never
//   copied (they're private by choice; a workspace is shared).
// - Only the writer's own entries: an admin fixing a teammate's entry fixes it where it is, and doesn't spread the
//   teammate's observation to other teams. Deletes are never copied: deleting the original leaves the other teams'
//   copies alone (each is that team's entry now). A copy its workspace deleted stays deleted (an edit of the
//   original never brings it back).
// - One family per observation: the entry first saved is the origin; each other workspace holds one copy with the id
//   copyUuid(origin workspace, origin id), the same id an alliance copy of it would have (alliances.ts), recorded in
//   scout_alliance_copies (alliance_id 0) so consensus and alliance unions read the observation once
//   (consensus.ts notACopyWithin). An edit of the origin or of any copy, by that admin, updates the whole family; an
//   edit by anyone else stays in its own workspace. Newer updatedAt wins as for every write, so a retry, or an
//   unchanged resend, writes nothing twice; a resend also makes any copy that's missing (the retry path).
// - Each copy is an ordinary entry of its workspace: authored by the scout, in its history and activity feed, on its
//   live streams, editable by its members and admins like any entry.
// - Templates differ per workspace: answers are mapped by field id onto the receiving workspace's current template
//   for that season and kind. An answer whose field it lacks, or that doesn't fit its field there (another type, a
//   choice it doesn't offer, a number out of range), is dropped. Answers the copy has for fields the sending
//   template doesn't ask are kept. Notes are copied as they are. Photos stay with the entry they were added to.
import type { InStatement } from "@libsql/client";
import { all } from "../db.js";
import { controlPointInfo, type Membership } from "../auth/controlPoint.js";
import type { User } from "../auth/session.js";
import { isEnabledFor } from "../flags.js";
import { builtinTemplate } from "../../src/shared/scoutDefaults.js";
import { workspaceTemplateId, type ScoutField, type TemplateKind } from "../../src/shared/scoutTemplate.js";
import type { ScoutAnswer } from "../../src/shared/scoutEntry.js";
import { copyUuid } from "./alliances.js";
import { fieldReader } from "./consensus.js";
import { currentTemplate } from "./templates.js";
import { workspaceAdminAccess, writeIntoWorkspace, type PushResult, type ScoutEntryInput, type WorkspaceEntryOut } from "./entries.js";

/** The copies made through admin fan-out are recorded with this alliance id (no alliance). */
export const FANOUT_ALLIANCE_ID = 0;

/** Does this answer fit this field (its type, its choices, its range)? */
export function fits(f: ScoutField, v: unknown): v is ScoutAnswer {
  switch (f.type) {
    case "toggle": return typeof v === "boolean";
    case "text": return typeof v === "string";
    case "choice": return typeof v === "string" && (f.options ?? []).includes(v);
    case "counter": return typeof v === "number" && Number.isInteger(v) && v >= (f.min ?? 0) && (f.max == null || v <= f.max);
    case "rating": return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= (f.max ?? 5);
    default: return false;
  }
}

/**
 * The answers a copy holds: each of `data` whose field (by id) the receiving template has and fits there, over the
 * copy's own answers for fields the sending template doesn't ask (`from`: the sending entry's fields).
 */
export function mapAnswers(data: Record<string, unknown>, from: ScoutField[], to: ScoutField[], existing: Record<string, unknown> = {}): Record<string, ScoutAnswer> {
  const target = new Map(to.map((f) => [f.id, f]));
  const asked = new Set(from.map((f) => f.id));
  const out: Record<string, ScoutAnswer> = {};
  for (const [k, v] of Object.entries(existing)) {
    const f = target.get(k);
    if (!asked.has(k) && f && fits(f, v)) out[k] = v;
  }
  for (const [k, v] of Object.entries(data)) {
    const f = target.get(k);
    if (f && fits(f, v)) out[k] = v;
  }
  return out;
}

/** The template a workspace's new entries use for a season and kind: its own (with its id and version), else the built-in. */
async function templateOf(workspaceId: string, season: number, kind: TemplateKind): Promise<{ id: string; version: number; fields: ScoutField[] }> {
  const t = await currentTemplate(workspaceId, season);
  const own = t[kind];
  if (own && t.version > 0) return { id: workspaceTemplateId(workspaceId, season, kind), version: t.version, fields: own };
  const b = builtinTemplate(season, kind);
  return { id: b.id, version: 0, fields: b.fields };
}

/** The other workspaces this user may copy into now: admin there, scouting on, not read-only. */
export async function otherAdminSpaces(user: User, m: Membership): Promise<Membership[]> {
  const info = await controlPointInfo(m.accountId);
  const ids = (info?.workspaces ?? []).filter((w) => w.role === "admin" && !w.orphaned && w.id !== m.workspaceId).map((w) => w.id);
  const out: Membership[] = [];
  for (const id of [...new Set(ids)]) {
    if (!(await isEnabledFor("workspaceScouting", id))) continue;
    const a = await workspaceAdminAccess(user, id, { write: true });
    if (a.ok && a.membership.role === "admin") out.push(a.membership);
  }
  return out;
}

/** Where each entry first came from: a copy (alliance or fan-out) names its origin, anything else is its own. */
async function originsOf(workspaceId: string, uuids: string[]): Promise<Map<string, { ws: string; uuid: string }>> {
  const out = new Map(uuids.map((u) => [u, { ws: workspaceId, uuid: u }]));
  if (!uuids.length) return out;
  const rows = await all<{ copy_uuid: string; origin_ws: string; origin_uuid: string }>(
    `SELECT copy_uuid, origin_ws, origin_uuid FROM scout_alliance_copies WHERE to_ws = ? AND copy_uuid IN (${uuids.map(() => "?").join(", ")})`,
    [workspaceId, ...uuids]);
  for (const r of rows) out.set(String(r.copy_uuid), { ws: String(r.origin_ws), uuid: String(r.origin_uuid) });
  return out;
}

const parseData = (raw: string | undefined): Record<string, unknown> => {
  try { const d = JSON.parse(raw ?? "{}"); return d && typeof d === "object" && !Array.isArray(d) ? d : {}; } catch { return {}; }
};

/**
 * After a push to `m`'s workspace: save each of the writer's own live entries it accepted into the writer's other
 * admin workspaces (the rules at the top), and say where on each result (`copiedTo`). A workspace that fails is
 * logged and left out; the push itself has already succeeded, and the next save of the entry tries again.
 */
export async function copyToAdminSpaces(user: User, m: Membership, results: PushResult[]): Promise<PushResult[]> {
  if (m.role !== "admin") return results;
  const mine = results.filter((r) => r.ok && r.entry && !r.entry.deleted && r.entry.authorAccountId === m.accountId);
  if (!mine.length) return results;
  const targets = await otherAdminSpaces(user, m);
  if (!targets.length) return results;
  const admin = new Set([m.workspaceId, ...targets.map((t) => t.workspaceId)]);
  const origins = await originsOf(m.workspaceId, mine.map((r) => r.uuid));
  // An entry copied in from a workspace this user isn't an admin of (an alliance partner's) stays where it is.
  const family = mine.filter((r) => admin.has(origins.get(r.uuid)!.ws));
  if (!family.length) return results;
  const readFrom = fieldReader(m.workspaceId);
  const fromFields = new Map<string, ScoutField[]>();
  for (const r of family) {
    const e = r.entry!;
    fromFields.set(r.uuid, await readFrom(e.season, e.kind, e.templateId ?? null, e.templateVersion ?? 0));
  }
  for (const t of targets) {
    try {
      const idIn = new Map(family.map((r) => {
        const o = origins.get(r.uuid)!;
        return [r.uuid, o.ws === t.workspaceId ? o.uuid : copyUuid(o.ws, o.uuid)] as const;
      }));
      const templates = new Map<string, Awaited<ReturnType<typeof templateOf>>>();
      for (const r of family) {
        const key = `${r.entry!.season}:${r.entry!.kind}`;
        if (!templates.has(key)) templates.set(key, await templateOf(t.workspaceId, r.entry!.season, r.entry!.kind));
      }
      const { stored, entries } = await writeIntoWorkspace(user, t, (prior) => {
        const out: ScoutEntryInput[] = [];
        const after: InStatement[] = [];
        for (const r of family) {
          const e = r.entry!, uuid = idIn.get(r.uuid)!, have = prior.get(uuid);
          if (have?.deleted) continue; // deleted there: it stays deleted
          const tpl = templates.get(`${e.season}:${e.kind}`)!;
          out.push(copyOf(e, uuid, tpl, mapAnswers(e.data, fromFields.get(r.uuid)!, tpl.fields, have ? parseData(have.data) : {})));
          const o = origins.get(r.uuid)!;
          if (o.ws !== t.workspaceId) {
            after.push({
              sql: `INSERT OR IGNORE INTO scout_alliance_copies (to_ws, copy_uuid, origin_ws, origin_uuid, alliance_id)
                    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
                      WHERE ws.cp_workspace_id = ? AND w.uuid = ?)`,
              args: [t.workspaceId, uuid, o.ws, o.uuid, FANOUT_ALLIANCE_ID, t.workspaceId, uuid],
            });
          }
        }
        return { entries: out, after };
      }, [...idIn.values()]);
      const wrote = new Set(entries.map((e) => e.uuid));
      for (const r of family) {
        const uuid = idIn.get(r.uuid)!;
        if (!wrote.has(uuid) || !stored.get(uuid) || stored.get(uuid)!.deleted) continue;
        (r.copiedTo ??= []).push({ workspaceId: t.workspaceId, name: t.workspaceName });
      }
    } catch (err) {
      console.warn(`[admin-copies] copy into a workspace failed: ${(err as Error)?.message ?? "error"}`);
    }
  }
  return results;
}

/** The copy of `e` a workspace stores: the same observation, its template and mapped answers. */
function copyOf(e: WorkspaceEntryOut, uuid: string, tpl: { id: string; version: number }, data: Record<string, ScoutAnswer>): ScoutEntryInput {
  return {
    uuid, season: e.season, team: e.team, eventCode: e.eventCode, matchLabel: e.matchLabel, kind: e.kind,
    data, notes: e.notes, updatedAt: e.updatedAt, deleted: false, templateId: tpl.id, templateVersion: tpl.version,
  };
}
