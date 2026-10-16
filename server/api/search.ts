// Global search: teams, events and matches.
//
// Full-text (FTS5, prefix-indexed) over team numbers/names/schools/places and
// event codes/names/places; exact team numbers jump to the top; a query like
// "USNJQ1 Q12" or "2025 USNJQ1 M3" resolves straight to a match.
import { all, get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { SearchHit } from "../../src/shared/api.js";
import { fuzzyScore, normalize, scoreWords, trigramQuery, words } from "./fuzzy.js";
import { kvGet } from "../db.js";
import { findRegions } from "../../src/shared/regions.js";
import { registerCache } from "../caches.js";

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

/** `prefer`: the visitor's own teams/events ("team:16321", "event:2025:AUBRQ2") —
 *  my team, tracked and shortlisted — rank above other matches of the same strength. */
export async function search(q: string, limit = 12, prefer: ReadonlySet<string> = new Set()): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => { const k = `${h.kind}:${h.ref}`; if (!seen.has(k)) { seen.add(k); out.push(h); } };

  // 0. A state or province ("New Jersey", "NJ"): its events this season, as one link.
  if (!/\d/.test(query)) for (const r of findRegions(query)) {
    const n = Number((await get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE season = ? AND country = ? AND state = ?", [CURRENT_SEASON, r.country, r.state]))?.n ?? 0);
    if (n) push({ kind: "place", ref: r.key, title: `All events in ${r.name}`, subtitle: `${n} this season`, season: CURRENT_SEASON });
  }

  // 1. A specific match ("USNJQ1 Q12").
  const mh = await matchHit(query);
  if (mh) push(mh);

  // 2. Team numbers: exact first, then prefix matches as you type ("163" → 16321…).
  // (Team numbers never start with 0 — and a 0 prefix would never end the range loop.)
  if (/^[1-9]\d{0,5}$/.test(query)) {
    // Prefix "16" = numbers 16, 160–169, 1600–1699, … — integer ranges the primary key can serve.
    const p = Number(query);
    const preferred = [...prefer].map((k) => /^team:(\d+)$/.exec(k)?.[1]).filter(Boolean).map(Number);
    const ranges: [number, number][] = [];
    for (let m = 1; p * m < 1_000_000; m *= 10) ranges.push([p * m, (p + 1) * m - 1]);
    const rows = await all<any>(
      `SELECT t.number, t.name, t.city, t.state, t.country, cs.season last
       FROM teams t LEFT JOIN team_seasons cs ON cs.team = t.number AND cs.season = ?
       WHERE ${ranges.map(() => "t.number BETWEEN ? AND ?").join(" OR ")}
       ORDER BY t.number = ? DESC, t.number IN (${preferred.map(() => "?").join(",") || "NULL"}) DESC, cs.season IS NOT NULL DESC, t.number LIMIT ?`,
      [CURRENT_SEASON, ...ranges.flat(), p, ...preferred, query.length >= 4 ? Math.ceil(limit / 2) : limit],
    );
    for (const t of rows) push({ kind: "team", ref: String(t.number), title: `${t.number} ${t.name ?? ""}`.trim(), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: t.last == null ? null : Number(t.last) });
    if (out.length >= limit) return out.slice(0, limit);
  }
  // Other numbers: only 4+ digits (a year, digits of an event code) go on to the
  // word index; shorter ones would match every date ("16" → the 16th).
  if (/^\d+$/.test(query) && query.length < 4) return out;

  // 3. Text: word-prefix matches (exact words) + trigram candidates (typos),
  //    re-ranked together by how closely each query word matches.
  type Cand = SearchHit & { weight: number; name: string };
  const cands = new Map<string, Cand>();
  const add = (r: any, name: string) => {
    const k = `${r.kind}:${r.ref}`;
    if (!cands.has(k)) cands.set(k, { kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season == null ? null : Number(r.season), weight: Number(r.weight) || 1, name });
  };
  const fts = ftsQuery(query);
  if (fts) for (const r of await all<any>("SELECT kind, ref, season, weight, title, subtitle, terms FROM search WHERE search MATCH ? ORDER BY bm25(search, 0, 0, 0, 0, 10.0, 2.0, 1.0) LIMIT 60", [fts])) add(r, `${r.title} ${r.subtitle} ${r.terms ?? ""}`);
  const tri = /[a-z]/i.test(query) ? trigramQuery(query) : null;
  if (tri) for (const r of await all<any>("SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy WHERE search_fuzzy MATCH ? ORDER BY bm25(search_fuzzy) LIMIT 150", [tri])) add(r, `${r.title} ${r.name}`);
  const ranked = [...cands.values()]
    .map((c) => ({ c, s: Math.max(fuzzyScore(query, c.title), fuzzyScore(query, c.name), fuzzyScore(query, `${c.title} ${c.subtitle}`) * 0.95) }))
    .filter((x) => x.s >= 0.6)
    // Your own teams/events win ties and near-ties, never beat a much better match.
    .map((x) => (prefer.has(`${x.c.kind}:${x.c.ref}`) ? { ...x, s: x.s + 0.1 } : x))
    .sort((a, b) => b.s - a.s || b.c.weight - a.c.weight || (b.c.season ?? 0) - (a.c.season ?? 0) || a.c.title.localeCompare(b.c.title));
  for (const { c } of ranked) push({ kind: c.kind, ref: c.ref, title: c.title, subtitle: c.subtitle, season: c.season });
  // Short typos can share no trigram with the right word ("dirve" vs "drive"):
  // when the index didn't find enough, scan the names in memory (bounded edit
  // distance, ~28k names, a few ms).
  if (!out.length && /\p{L}/u.test(query)) {
    const qs = words(query);
    // Cheap prefilter: a typo of a word still shares a 2-letter chunk with it.
    const qb = bigrams(qs.join(" "));
    const scanned = (await fuzzyRows()).filter((r) => { for (const b of qb) if (r.bigrams.has(b)) return true; return false; })
      .map((r) => ({ r, s: scoreWords(qs, r.words) })).filter((x) => x.s >= 0.6)
      .map((x) => (prefer.has(`${x.r.kind}:${x.r.ref}`) ? { ...x, s: x.s + 0.1 } : x)) // same preference as the indexed path
      .sort((a, b) => b.s - a.s || b.r.weight - a.r.weight || (b.r.season ?? 0) - (a.r.season ?? 0));
    // Room for the older seasons newestSeasons drops.
    for (const { r } of scanned) { if (out.length >= limit * 4) break; push({ kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season }); }
  }
  return newestSeasons(out, query).slice(0, limit);
}

/** An event code comes back every season (USNJCMP 2023, 2024, …): keep its newest season unless a year was typed. */
function newestSeasons(hits: SearchHit[], query: string): SearchHit[] {
  if (/\b(19|20)\d\d\b/.test(query)) return hits;
  const newest = new Map<string, number>();
  for (const h of hits) if (h.kind === "event") { const [s, code] = h.ref.split(":"); newest.set(code, Math.max(newest.get(code) ?? 0, Number(s))); }
  return hits.filter((h) => { if (h.kind !== "event") return true; const [s, code] = h.ref.split(":"); return Number(s) >= (newest.get(code) ?? 0); });
}

interface FuzzyRow { kind: "team" | "event"; ref: string; season: number | null; weight: number; title: string; subtitle: string; words: string[]; bigrams: Set<string> }

const bigrams = (s: string) => { const out = new Set<string>(); for (const w of s.split(" ")) for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2)); return out; };
let rowsCache: { version: string; rows: Promise<FuzzyRow[]> } | null = null;

/** The typo index in memory (reloaded when the search index is rebuilt). */
async function fuzzyRows(): Promise<FuzzyRow[]> {
  const version = (await kvGet<string>("search:version")) ?? "0";
  if (rowsCache?.version === version) return rowsCache.rows;
  const rows = all<any>("SELECT kind, ref, season, weight, title, subtitle, name FROM search_fuzzy").then((rs) => rs.map((r) => ({
    kind: r.kind, ref: r.ref, season: r.season == null ? null : Number(r.season), weight: Number(r.weight) || 1, title: r.title, subtitle: r.subtitle,
    words: words(`${r.title} ${r.name}`),
    bigrams: bigrams(normalize(`${r.title} ${r.name}`)),
  })));
  rowsCache = { version, rows };
  // A failed read (e.g. a brief database outage) must not stick: the next search retries.
  rows.catch(() => { if (rowsCache?.rows === rows) rowsCache = null; });
  return rows;
}
registerCache("Search typo index", () => { rowsCache = null; });

/**
 * A database upgraded to migration 4 has an empty typo index until the next
 * stats run: fill it now (once) so typo search works straight away.
 */
let ensured: Promise<void> | null = null;
export function ensureSearchIndex(rebuild: () => Promise<void>): Promise<void> {
  ensured ??= (async () => {
    const [fz, ws] = await Promise.all([get<{ n: number }>("SELECT COUNT(*) n FROM search_fuzzy"), get<{ n: number }>("SELECT COUNT(*) n FROM search")]);
    if (!Number(fz?.n) && Number(ws?.n)) await rebuild();
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}
