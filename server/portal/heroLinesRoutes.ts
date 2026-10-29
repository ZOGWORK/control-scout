// The owner console's hero-line editor (/api/owner/hero-lines…, Rankings & content), mounted inside the
// owner router (server/portal/routes.ts), so everyone else gets its 403. Add, edit, reorder, switch on or
// off, start from the built-in lines, or go back to them. Every change is in the audit log with the value it
// replaced and the value it set.
import type { NextFunction, Request, Response, Router } from "express";
import { homeHeadlineAt } from "../../src/shared/boot.js";
import { DEFAULT_HERO_LINES, cleanHeroPart, heroLineProblem, type HeroLine, type HeroLineRow, type OwnerHeroLines } from "../../src/shared/heroLines.js";
import {
  HeroLineError, addHeroLine, deleteHeroLine, heroLine, listHeroLines, liveHeroLines, reorderHeroLines, resetHeroLines, seedHeroLines, updateHeroLine,
} from "../heroLines.js";
import { recordAudit } from "./audit.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;
type Wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => void;

/** A line in the audit log: its words and whether it's on (no ids or dates: those are in `details`). */
const value = (r: HeroLineRow | null) => (r ? { plain: r.plain, accent: r.accent, enabled: r.enabled } : null);

export async function ownerHeroLines(now = Date.now()): Promise<OwnerHeroLines> {
  const [rows, live] = await Promise.all([listHeroLines(), liveHeroLines(now)]);
  return { rows, live: { ...live, index: homeHeadlineAt(now, live.lines.length) }, defaults: DEFAULT_HERO_LINES.map(([a, b]) => [a, b] as HeroLine) };
}

export function heroLinesOwnerRoutes(r: Router, h: Wrap, actor: (req: Request) => string) {
  const confirmed = (req: Request, res: Response) => {
    if (req.body?.confirm === true) return true;
    res.status(400).json({ error: "Confirm with {\"confirm\": true}" });
    return false;
  };
  const idOf = (req: Request) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  r.get("/hero-lines", h(async () => ownerHeroLines()));

  r.post("/hero-lines", h(async (req, res) => {
    const b = req.body ?? {};
    const problem = heroLineProblem(b.plain, b.accent);
    if (problem) { res.status(400).json({ error: problem }); return; }
    if (b.enabled !== undefined && typeof b.enabled !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
    try {
      const line = await addHeroLine(b.plain, b.accent, b.enabled ?? true);
      await recordAudit(actor(req), "heroLine.add", { id: line.id }, null, { from: null, to: value(line) });
      return { line, panel: await ownerHeroLines() };
    } catch (e) {
      if (e instanceof HeroLineError) { res.status(409).json({ error: e.message }); return; }
      throw e;
    }
  }));

  r.patch("/hero-lines/:id", h(async (req, res) => {
    const id = idOf(req);
    const was = id ? await heroLine(id) : null;
    if (!id || !was) { res.status(404).json({ error: "No such line" }); return; }
    const b = req.body ?? {};
    if (b.enabled !== undefined && typeof b.enabled !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
    if (b.plain !== undefined || b.accent !== undefined) {
      const problem = heroLineProblem(b.plain === undefined ? was.plain : b.plain, b.accent === undefined ? was.accent : b.accent);
      if (problem) { res.status(400).json({ error: problem }); return; }
    }
    if (b.plain === undefined && b.accent === undefined && b.enabled === undefined) { res.status(400).json({ error: "Nothing to change" }); return; }
    const same = (b.plain === undefined || cleanHeroPart(b.plain) === was.plain) && (b.accent === undefined || cleanHeroPart(b.accent) === was.accent) && (b.enabled === undefined || b.enabled === was.enabled);
    if (same) return { line: was, panel: await ownerHeroLines() };
    const line = await updateHeroLine(id, { plain: b.plain, accent: b.accent, enabled: b.enabled });
    if (!line) { res.status(404).json({ error: "No such line" }); return; }
    const words = line.plain !== was.plain || line.accent !== was.accent;
    await recordAudit(actor(req), words ? "heroLine.edit" : line.enabled ? "heroLine.on" : "heroLine.off", { id }, null, { from: value(was), to: value(line) });
    return { line, panel: await ownerHeroLines() };
  }));

  r.delete("/hero-lines/:id", h(async (req, res) => {
    const id = idOf(req);
    const was = id ? await heroLine(id) : null;
    if (!id || !was) { res.status(404).json({ error: "No such line" }); return; }
    if (!confirmed(req, res)) return;
    await deleteHeroLine(id);
    await recordAudit(actor(req), "heroLine.delete", { id }, null, { from: value(was), to: null });
    return { panel: await ownerHeroLines() };
  }));

  r.put("/hero-lines/order", h(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x) && x > 0)) { res.status(400).json({ error: "Send {\"ids\": [every line's id, in the new order]}" }); return; }
    const was = (await listHeroLines()).map((l) => l.id);
    if (!(await reorderHeroLines(ids))) { res.status(400).json({ error: "The order must list every line once. Reload and try again." }); return; }
    if (was.join() !== ids.join()) await recordAudit(actor(req), "heroLines.reorder", null, null, { from: was, to: ids });
    return { panel: await ownerHeroLines() };
  }));

  // Start from the built-in lines: a saved copy to edit (only while nothing is saved).
  r.post("/hero-lines/seed", h(async (req, res) => {
    if (!confirmed(req, res)) return;
    if (!(await seedHeroLines())) { res.status(409).json({ error: "Lines are already saved: edit those." }); return; }
    const rows = await listHeroLines();
    await recordAudit(actor(req), "heroLines.seed", { lines: rows.length }, null, { from: null, to: rows.map((l) => `${l.plain} | ${l.accent}`) });
    return { panel: await ownerHeroLines() };
  }));

  // Back to the built-in lines: every saved line goes, each with its own audit row (its old value).
  r.post("/hero-lines/reset", h(async (req, res) => {
    if (!confirmed(req, res)) return;
    const rows = await listHeroLines();
    await resetHeroLines();
    for (const l of rows) await recordAudit(actor(req), "heroLine.delete", { id: l.id, reset: true }, null, { from: value(l), to: null });
    return { panel: await ownerHeroLines() };
  }));
}
