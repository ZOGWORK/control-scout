// Global search: teams, events and matches.
//
// Full-text (FTS5, prefix-indexed) over team numbers/names/schools/places and
// event codes/names/places; exact team numbers jump to the top; a query like
// "USNJQ1 Q12" or "2025 USNJQ1 M3" resolves straight to a match.
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { SearchHit } from "../../src/shared/api.js";

/** Turn free text into a safe FTS5 query: every word as a quoted prefix term. */
export function ftsQuery(q: string): string | null {
  const words = q.toLowerCase().replace(/["*^():]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}

const MATCH_RE = /^(?:(20\d\d)\s+)?([a-z0-9]{3,16})\s+(q|qual|m|match|f|final)\s*-?\s*(\d{1,3})(?:-(\d))?$/i;

async function matchHit(q: string): Promise<SearchHit | null> {
  const m = MATCH_RE.exec(q.trim());
  if (!m) return null;
  const code = m[2].toUpperCase();
  const season = m[1] ? Number(m[1]) : Number((await get<{ s: number }>("SELECT MAX(season) s FROM events WHERE code = ?", [code]))?.s ?? 0);
  if (!season) return null;
  const kind = m[3].toLowerCase()[0];
  const n = Number(m[4]);
  const row = kind === "q"
    ? await get<any>("SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'qual' AND number = ?", [season, code, n])
    : kind === "f"
      ? await get<any>("SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND series = 0 AND number = ?", [season, code, n])
      : await get<any>("SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND series = ? AND number = ?", [season, code, n, Number(m[5] ?? 1)]);
  if (!row) return null;
  const ev = await get<any>("SELECT name FROM events WHERE season = ? AND code = ?", [season, code]);
  return { kind: "match", ref: `${season}:${code}:${row.level}:${row.series}:${row.number}`, title: `${row.label} · ${ev?.name ?? code}`, subtitle: `${code} · ${season}`, season };
}

export async function search(q: string, limit = 12): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => { const k = `${h.kind}:${h.ref}`; if (!seen.has(k)) { seen.add(k); hits.push(h); } };

  const mh = await matchHit(query);
  if (mh) push(mh);
  // Exact team number first.
  if (/^\d{1,6}$/.test(query)) {
    const t = await get<any>("SELECT number, name, city, state, country FROM teams WHERE number = ?", [Number(query)]);
    if (t) push({ kind: "team", ref: String(t.number), title: `${t.number} ${t.name ?? ""}`.trim(), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: null });
  }
  const fts = ftsQuery(query);
  if (fts) {
    const rows = await all<any>(
      `SELECT kind, ref, season, title, subtitle, bm25(search, 0, 0, 0, 0, 10.0, 2.0, 1.0) - weight * 0.5 - CASE WHEN kind = 'event' AND season = ? THEN 1 ELSE 0 END AS score
       FROM search WHERE search MATCH ? ORDER BY score LIMIT ?`,
      [CURRENT_SEASON, fts, limit * 2],
    );
    for (const r of rows) push({ kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season == null ? null : Number(r.season) });
  }
  return hits.slice(0, limit);
}
