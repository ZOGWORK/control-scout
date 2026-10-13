// Global search: teams, events and matches.
//
// Full-text (FTS5, prefix-indexed) over team numbers/names/schools/places and
// event codes/names/places; exact team numbers jump to the top; a query like
// "USNJQ1 Q12" or "2025 USNJQ1 M3" resolves straight to a match.
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { SearchHit } from "../../src/shared/api.js";
import { fuzzyScore, trigramQuery } from "./fuzzy.js";

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
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => { const k = `${h.kind}:${h.ref}`; if (!seen.has(k)) { seen.add(k); out.push(h); } };

  // 1. A specific match ("USNJQ1 Q12").
  const mh = await matchHit(query);
  if (mh) push(mh);

  // 2. Team numbers: exact first, then prefix matches as you type ("163" → 16321…).
  // (Team numbers never start with 0 — and a 0 prefix would never end the range loop.)
  if (/^[1-9]\d{0,5}$/.test(query)) {
    // Prefix "16" = numbers 16, 160–169, 1600–1699, … — integer ranges the primary key can serve.
    const p = Number(query);
    const ranges: [number, number][] = [];
    for (let m = 1; p * m < 1_000_000; m *= 10) ranges.push([p * m, (p + 1) * m - 1]);
    const rows = await all<any>(
      `SELECT t.number, t.name, t.city, t.state, t.country, cs.season last
       FROM teams t LEFT JOIN team_seasons cs ON cs.team = t.number AND cs.season = ?
       WHERE ${ranges.map(() => "t.number BETWEEN ? AND ?").join(" OR ")}
       ORDER BY t.number = ? DESC, cs.season IS NOT NULL DESC, t.number LIMIT ?`,
      [CURRENT_SEASON, ...ranges.flat(), p, limit],
    );
    for (const t of rows) push({ kind: "team", ref: String(t.number), title: `${t.number} ${t.name ?? ""}`.trim(), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: t.last == null ? null : Number(t.last) });
    if (out.length) return out.slice(0, limit);
  }
  // Digits that can't be a team number (leading 0, too long): nothing else to find.
  if (/^\d+$/.test(query)) return out;

  // 3. Text: word-prefix matches (exact words) + trigram candidates (typos),
  //    re-ranked together by how closely each query word matches.
  type Cand = SearchHit & { weight: number; name: string };
  const cands = new Map<string, Cand>();
  const add = (r: any, name: string) => {
    const k = `${r.kind}:${r.ref}`;
    if (!cands.has(k)) cands.set(k, { kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season == null ? null : Number(r.season), weight: Number(r.weight) || 1, name });
  };
  const fts = ftsQuery(query);
  if (fts) for (const r of await all<any>("SELECT kind, ref, season, weight, title, subtitle FROM search WHERE search MATCH ? ORDER BY bm25(search, 0, 0, 0, 0, 10.0, 2.0, 1.0) LIMIT 60", [fts])) add(r, `${r.title} ${r.subtitle}`);
  const tri = /[a-z]/i.test(query) ? trigramQuery(query) : null;
  if (tri) for (const r of await all<any>("SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy WHERE search_fuzzy MATCH ? ORDER BY bm25(search_fuzzy) LIMIT 150", [tri])) add(r, `${r.title} ${r.name}`);
  const ranked = [...cands.values()]
    .map((c) => ({ c, s: Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.name), fuzzyScore(query, `${c.title} ${c.subtitle}`) * 0.95) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s || b.c.weight - a.c.weight || (b.c.season ?? 0) - (a.c.season ?? 0) || a.c.title.localeCompare(b.c.title));
  for (const { c } of ranked) push({ kind: c.kind, ref: c.ref, title: c.title, subtitle: c.subtitle, season: c.season });
  return out.slice(0, limit);
}
