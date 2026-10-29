// The owner portal's "Power rankings" panel (/api/owner/power-rankings…, mounted inside the owner
// router: server/portal/routes.ts, so non-owners get its 403). Lists the generated weeks; edits an
// intro or blurbs, regenerates a week with Bruno, hides or shows one, and publishes this week now.
// Every change needs {"confirm": true} (the panel's confirmation dialog sends it) and is audited.
import type { Request, Response, Router } from "express";
import { all } from "../db.js";
import { isEnabled } from "../flags.js";
import { recordAudit } from "../portal/audit.js";
import { brunoAvailable } from "../auth/controlPoint.js";
import { isWeekId } from "../../src/shared/powerRankings.js";
import type { OwnerPowerRankings, OwnerPowerRankingsRefresh, OwnerPowerRankingsWeek } from "../../src/shared/owner.js";
import { publishNow, regenerateWeek } from "./auto.js";
import { editGenerated, getGenerated, listGenerated, revOf, setGeneratedStatus, type GeneratedWeek } from "./generated.js";
import { nextRefresh, nextSlot } from "./schedule.js";
import { fileWeeks } from "./store.js";
import { BLURB_MAX, INTRO_MAX } from "./format.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;

interface RefreshRow { season: number; week: string; day: string; status: string; started_at: string; finished_at: string | null; changed: number; bruno: number; template: number; kept: number; note: string | null }

/** Each week's daily checks, newest first (the last 14 of each). */
async function refreshes(): Promise<Map<string, OwnerPowerRankingsRefresh[]>> {
  const out = new Map<string, OwnerPowerRankingsRefresh[]>();
  const rows = await all<RefreshRow>("SELECT * FROM power_rankings_refreshes ORDER BY day DESC").catch(() => [] as RefreshRow[]);
  for (const r of rows) {
    const key = `${r.season}/${r.week}`;
    const list = out.get(key) ?? [];
    if (list.length >= 14) continue;
    list.push({
      day: r.day, status: r.status as OwnerPowerRankingsRefresh["status"], at: r.finished_at ?? r.started_at,
      changed: Number(r.changed), bruno: Number(r.bruno), template: Number(r.template), kept: Number(r.kept), note: r.note,
    });
    out.set(key, list);
  }
  return out;
}

async function view(g: GeneratedWeek, names: Map<number, string | null>, files: Set<string>, runs: Map<string, OwnerPowerRankingsRefresh[]>): Promise<OwnerPowerRankingsWeek> {
  return {
    season: g.season, week: g.week, published: g.published, updated: g.updated, refreshes: runs.get(`${g.season}/${g.week}`) ?? [], status: g.status, generatedAt: g.generatedAt, editedAt: g.editedAt, rev: revOf(g),
    overridden: files.has(g.week), intro: g.intro, introSource: g.introSource, comparedWith: (g.packet as { comparedWith?: string | null }).comparedWith ?? null,
    entries: g.entries.map((e) => ({ rank: e.rank, team: e.team, name: names.get(e.team) ?? null, text: e.text, source: e.source, rejected: e.rejected ?? null })),
  };
}

async function names(weeks: GeneratedWeek[]): Promise<Map<number, string | null>> {
  const teams = [...new Set(weeks.flatMap((w) => w.entries.map((e) => e.team)))];
  const out = new Map<number, string | null>();
  if (!teams.length) return out;
  for (const r of await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${teams.map(() => "?").join(",")})`, teams)) {
    out.set(Number(r.number), r.name?.trim() || null);
  }
  return out;
}

export async function ownerPowerRankings(now = Date.now()): Promise<OwnerPowerRankings> {
  const weeks = (await listGenerated()).reverse();
  const n = await names(weeks);
  const files = new Set(fileWeeks().map((d) => d.week));
  const runs = await refreshes();
  return {
    enabled: await isEnabled("autoPowerRankings"),
    controlPoint: brunoAvailable(),
    nextRun: new Date(nextSlot(now).at).toISOString(),
    daily: { enabled: await isEnabled("dailyPowerRankings"), nextRun: new Date(nextRefresh(now).at).toISOString() },
    weeks: await Promise.all(weeks.map((g) => view(g, n, files, runs))),
  };
}

const clean = (s: string) => s.replace(/\r\n?/g, "\n").trim();

/** Add the panel's routes to the owner router. `h` wraps a handler; `actor` names the signed-in owner. */
export function powerRankingsOwnerRoutes(r: Router, h: (fn: Handler) => (req: Request, res: Response, next: (e?: unknown) => void) => void, actor: (req: Request) => string) {
  const target = (req: Request) => {
    const season = Number(req.params.season), week = String(req.params.week).toLowerCase();
    return Number.isInteger(season) && season >= 2000 && season <= 2100 && isWeekId(week) ? { season, week } : null;
  };
  const confirmed = (req: Request, res: Response) => {
    if (req.body?.confirm === true) return true;
    res.status(400).json({ error: "Confirm with {\"confirm\": true}" });
    return false;
  };

  r.get("/power-rankings", h(async () => ownerPowerRankings()));

  r.post("/power-rankings/publish-now", h(async (req, res) => {
    if (!confirmed(req, res)) return;
    const out = await publishNow(Date.now(), (m) => console.log(`[owner] ${m}`));
    const result = out.status === "published" ? `published: ${out.bruno} by Bruno, ${out.template} from the template`
      : out.status === "exists" ? "refused: this week is already published (regenerate it instead)"
        : out.status === "overridden" ? "refused: a hand-written file covers this week"
          : out.status === "off" ? "refused: automatic power rankings are switched off" : "refused: no rated teams yet";
    await recordAudit(actor(req), "powerRankings.publishNow", { week: out.week, season: out.season ?? null }, result);
    if (out.status !== "published") { res.status(409).json({ error: result.replace(/^refused: /, "").replace(/^./, (c) => c.toUpperCase()) + "." }); return; }
    return { result: out, panel: await ownerPowerRankings() };
  }));

  r.post("/power-rankings/:season/:week/regenerate", h(async (req, res) => {
    const t = target(req);
    if (!t) { res.status(404).json({ error: "No such week" }); return; }
    if (!confirmed(req, res)) return;
    const out = await regenerateWeek(t.season, t.week, (m) => console.log(`[owner] ${m}`));
    if (out === null) { res.status(404).json({ error: "No such week" }); return; }
    if (out === "conflict") {
      await recordAudit(actor(req), "powerRankings.regenerate", t, "refused: the week was edited while Bruno was writing; the edit was kept");
      res.status(409).json({ error: "The week was edited while Bruno was writing, so the edit was kept. Regenerate again to replace it." });
      return;
    }
    if (out === "unavailable") {
      await recordAudit(actor(req), "powerRankings.regenerate", t, "failed: Bruno couldn't be reached; the week is unchanged");
      res.status(502).json({ error: "Bruno couldn't be reached, so the week is unchanged. Try again later." });
      return;
    }
    const bruno = out.entries.filter((e) => e.source === "bruno").length;
    await recordAudit(actor(req), "powerRankings.regenerate", t, `${bruno} by Bruno, ${out.entries.length - bruno} from the template`);
    return { panel: await ownerPowerRankings() };
  }));

  r.post("/power-rankings/:season/:week/status", h(async (req, res) => {
    const t = target(req);
    if (!t) { res.status(404).json({ error: "No such week" }); return; }
    if (!confirmed(req, res)) return;
    const status = req.body?.status;
    if (status !== "published" && status !== "hidden") { res.status(400).json({ error: "status must be published or hidden" }); return; }
    const out = await setGeneratedStatus(t.season, t.week, status);
    if (!out) { res.status(404).json({ error: "No such week" }); return; }
    await recordAudit(actor(req), status === "hidden" ? "powerRankings.hide" : "powerRankings.unhide", t);
    return { panel: await ownerPowerRankings() };
  }));

  r.patch("/power-rankings/:season/:week", h(async (req, res) => {
    const t = target(req);
    if (!t) { res.status(404).json({ error: "No such week" }); return; }
    if (!confirmed(req, res)) return;
    const b = req.body ?? {};
    if (typeof b.rev !== "string" || !b.rev) { res.status(400).json({ error: "Send the week's rev (the version you edited)" }); return; }
    const change: { intro?: string; blurbs?: { team: number; text: string }[] } = {};
    if (b.intro !== undefined) {
      if (typeof b.intro !== "string" || !clean(b.intro) || clean(b.intro).length > INTRO_MAX) { res.status(400).json({ error: `The intro must be 1 to ${INTRO_MAX} characters` }); return; }
      change.intro = clean(b.intro);
    }
    if (b.blurbs !== undefined) {
      if (!Array.isArray(b.blurbs) || b.blurbs.length > 25) { res.status(400).json({ error: "blurbs must be a list of {team, text}" }); return; }
      const g = await getGenerated(t.season, t.week);
      const teams = new Set(g?.entries.map((e) => e.team) ?? []);
      change.blurbs = [];
      for (const x of b.blurbs) {
        if (!x || !teams.has(x.team) || typeof x.text !== "string" || !clean(x.text) || clean(x.text).length > BLURB_MAX) {
          res.status(400).json({ error: `Each blurb needs a team in the week and 1 to ${BLURB_MAX} characters of text` });
          return;
        }
        change.blurbs.push({ team: x.team, text: clean(x.text) });
      }
    }
    if (change.intro === undefined && !change.blurbs?.length) { res.status(400).json({ error: "Nothing to change" }); return; }
    const out = await editGenerated(t.season, t.week, change, b.rev);
    if (!out) { res.status(404).json({ error: "No such week" }); return; }
    if (out === "conflict") {
      res.status(409).json({ error: "This week changed since you opened it (another save or a regeneration). Reload it and make your edit again." });
      return;
    }
    await recordAudit(actor(req), "powerRankings.edit", { ...t, intro: change.intro !== undefined, teams: change.blurbs?.map((x) => x.team) ?? [] });
    return { panel: await ownerPowerRankings() };
  }));
}
