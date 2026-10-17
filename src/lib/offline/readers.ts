// The API, answered from saved season packs (SQLite) on this device. Each
// reader ports its server producer — server/api/teams.ts, events.ts,
// matches.ts, search.ts — and returns exactly the same shape, so pages render
// offline answers like any other. What a pack doesn't hold is left out
// honestly: no logged predictions (played matches show none), no advancement
// odds. Pure functions over a small database interface, so tests run them on
// a fixture.
import type { Database, SqlValue } from "sql.js";
import type { EventDetail, EventSummary, FieldRow, MatchPredictionView, MatchView, SearchHit, TeamEventRow, TeamInfo, TeamProfile, TeamSeasonStats } from "../../shared/api";
import { eventTypeLabel } from "../../shared/labels";
import { localToUtcMs } from "../../shared/time";
import { normalize, scoreWords, words } from "../../shared/fuzzy";
import { regionNames } from "../../shared/regions";

/** Rows as plain objects (column → value), like the server's `all`. */
export interface Db { all<T = any>(sql: string, params?: SqlValue[]): T[] }
/** One saved season's pack. */
export interface SeasonDb { season: number; db: Db }

export function wrap(db: Database): Db {
  return {
    all<T>(sql: string, params: SqlValue[] = []): T[] {
      const st = db.prepare(sql);
      try {
        st.bind(params);
        const out: T[] = [];
        while (st.step()) out.push(st.getAsObject() as T);
        return out;
      } finally { st.free(); }
    },
  };
}

const one = <T = any>(db: Db, sql: string, params: SqlValue[] = []): T | undefined => db.all<T>(sql, params)[0];

/** What the device can add from the lite pack (ratings as of its build). */
export interface ReadOpts {
  /** A prediction for an unplayed match (on-field lineups), or null. */
  predict?: (season: number, red: number[], blue: number[], level: "qual" | "playoff", event?: string) => MatchPredictionView | null;
  /** A team's current rating for the rankings table, or null. */
  rating?: (season: number, team: number) => FieldRow["rating"];
}

export const OFFLINE_FORECAST = "Advancement odds need a connection.";

// --- Teams (server/api/teams.ts) --------------------------------------------------

function teamInfo(db: Db, number: number): TeamInfo | null {
  const t = one(db, "SELECT * FROM teams WHERE number = ?", [number]);
  if (!t) return null;
  return {
    number: Number(t.number), name: t.name, fullName: t.full_name, school: t.school, sponsors: t.sponsors ? JSON.parse(t.sponsors) : [],
    city: t.city, state: t.state, country: t.country, rookieYear: t.rookie_year, website: t.website, homeRegion: t.home_region,
  };
}

/** A pack's teams table holds every team registered or entered that season (the server's team_seasons ∪ event_teams). */
const inSeason = (db: Db, number: number) => !!one(db,
  "SELECT 1 FROM teams WHERE number = ? UNION SELECT 1 FROM event_teams WHERE team = ? UNION SELECT 1 FROM team_season_stats WHERE team = ? LIMIT 1",
  [number, number, number]);

function seasonStats(db: Db, season: number, team: number): TeamSeasonStats | null {
  const s = one(db, "SELECT * FROM team_season_stats WHERE season = ? AND team = ?", [season, team]);
  if (!s) return null;
  const of = s.ranked_teams ?? null;
  const stat = (v: any, rank: any) => ({ value: v ?? null, rank: rank ?? null, of });
  return {
    opr: { np: stat(s.opr_np, s.rank_np), auto: stat(s.opr_auto, s.rank_auto), teleop: stat(s.opr_teleop, s.rank_teleop), endgame: stat(s.opr_endgame, s.rank_endgame), pen: s.opr_pen ?? null },
    rating: s.rating_np == null ? null : { np: s.rating_np, auto: s.rating_auto, teleop: s.rating_teleop, endgame: s.rating_endgame, pen: s.rating_pen, sd: s.rating_sd, matches: s.rating_matches, rank: s.rating_rank },
    record: { wins: s.wins, losses: s.losses, ties: s.ties, matches: s.matches, events: s.events },
    avg: { np: s.avg_np, score: s.avg_score, pen: s.avg_pen },
  };
}

function teamEvents(db: Db, season: number, team: number): TeamEventRow[] {
  const rows = db.all(
    `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country,
            et.rank, et.rp, et.wins, et.losses, et.ties, et.qual_played,
            s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, s.opr_pen, s.avg_score, s.avg_np, s.avg_pen
     FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
     LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
     WHERE et.season = ? AND et.team = ?
       -- League rosters list every league team at every meet: once an event has
       -- results, keep it only if this team was on the field in a played match.
       AND (NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = et.season AND m.code = et.code AND m.played = 1)
            OR EXISTS (SELECT 1 FROM match_teams x JOIN matches m
                         ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
                       WHERE x.season = et.season AND x.code = et.code AND x.team = et.team AND x.on_field = 1 AND m.played = 1))
     ORDER BY e.start, e.code`,
    [season, team],
  );
  const awards = db.all("SELECT code, type, placement, name FROM awards WHERE season = ? AND team = ?", [season, team]);
  const alliances = db.all("SELECT code, number, captain, pick1, pick2, backup FROM alliances WHERE season = ? AND (captain = ? OR pick1 = ? OR pick2 = ? OR backup = ?)", [season, team, team, team, team]);
  return rows.map((r) => {
    const al = alliances.find((a) => a.code === r.code);
    const seat = al ? (al.captain === team ? "captain" : al.pick1 === team ? "pick1" : al.pick2 === team ? "pick2" : "backup") : null;
    return {
      season, code: r.code, name: r.name, type: r.type, start: r.start, end: r.end, city: r.city, state: r.state, country: r.country,
      rank: r.rank, rp: r.rp, wins: r.wins, losses: r.losses, ties: r.ties, qualPlayed: r.qual_played,
      opr: { np: r.opr_np, auto: r.opr_auto, teleop: r.opr_teleop, endgame: r.opr_endgame, pen: r.opr_pen },
      avg: { score: r.avg_score, np: r.avg_np, pen: r.avg_pen },
      awards: awards.filter((a) => a.code === r.code).map((a) => ({ type: a.type, placement: a.placement, name: a.name })),
      alliance: al && seat ? { number: al.number, seat } : null,
    };
  });
}

/**
 * A team's profile from the saved seasons. Seasons = the saved ones the team
 * is in; with no season asked, the newest saved season stands in for the
 * server's current one. Null when the team isn't in any saved season, or the
 * season asked for isn't saved.
 */
export function readTeamProfile(dbs: SeasonDb[], number: number, season?: number): TeamProfile | null {
  const saved = [...dbs].sort((a, b) => b.season - a.season);
  const mine = saved.filter((s) => inSeason(s.db, number));
  const team = mine.map((s) => teamInfo(s.db, number)).find(Boolean) ?? null;
  // The same seasons the server lists (server/api/teams.ts teamSeasons), among those saved: ones the robot
  // played (matches, or a rank at a remote event); registration alone only counts for the newest saved season.
  const played = (x: SeasonDb) => !!one(x.db, "SELECT 1 FROM team_season_stats WHERE team = ? AND matches > 0", [number])
    || !!one(x.db, "SELECT 1 FROM event_teams WHERE team = ? AND qual_played > 0", [number])
    || !!one(x.db, "SELECT 1 FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE et.team = ? AND e.remote = 1 AND et.rank IS NOT NULL", [number]);
  const newest = saved[0];
  const entered = !!newest && !!one(newest.db, "SELECT 1 FROM event_teams WHERE team = ? LIMIT 1", [number]);
  const seasons = mine.filter((x) => played(x) || (x === newest && entered)).map((x) => x.season);
  if (!team && !seasons.length) return null;
  let s = season;
  // Default: the newest saved season when the team is entered in it, else the newest it played.
  if (!s) s = entered ? newest!.season : seasons.find((x) => x !== newest?.season) ?? seasons[0] ?? newest?.season;
  const at = saved.find((x) => x.season === s);
  if (!at || s == null) return null;
  // Awards across every saved season, newest first (each pack's own events give the names).
  const awardsAllTime = mine.flatMap((x) => x.db.all(
    "SELECT a.season, a.code, e.name event, a.type, a.placement, a.name FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.team = ? ORDER BY e.start DESC",
    [number],
  ));
  return {
    team: team ?? { number, name: null, fullName: null, school: null, sponsors: [], city: null, state: null, country: null, rookieYear: null, website: null, homeRegion: null },
    season: s, seasons, stats: seasonStats(at.db, s, number), events: teamEvents(at.db, s, number),
    awardsAllTime: awardsAllTime.map((a) => ({ season: a.season, code: a.code, event: a.event, type: a.type, placement: a.placement, name: a.name })),
  };
}

// --- Matches (server/api/matches.ts) ----------------------------------------------

const score = (r: any, p: "red" | "blue") => r[`${p}_np`] == null ? null : {
  total: Number(r[`${p}_total`]), np: Number(r[`${p}_np`]), auto: Number(r[`${p}_auto`] ?? 0),
  teleop: Number(r[`${p}_teleop`] ?? 0), endgame: Number(r[`${p}_endgame`] ?? 0), pen: Number(r[`${p}_pen`] ?? 0),
};

/** Matches with lineups. Played matches carry no prediction (the pack holds no
 *  pre-match log, and one made now would be hindsight); unplayed ones get
 *  `opts.predict`'s, when it has one. */
export function readMatchViews(sdb: SeasonDb, f: { code?: string; team?: number }, opts: ReadOpts = {}): MatchView[] {
  const { season, db } = sdb;
  const where: string[] = ["m.season = ?"];
  const args: SqlValue[] = [season];
  if (f.code) { where.push("m.code = ?"); args.push(f.code); }
  if (f.team) { where.push("(m.code, m.level, m.series, m.number) IN (SELECT code, level, series, number FROM match_teams WHERE team = ? AND season = ?)"); args.push(f.team, season); }
  const rows = db.all(`SELECT m.*, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE ${where.join(" AND ")} ORDER BY m.time, m.code, m.level DESC, m.series, m.number`, args);
  if (!rows.length) return [];
  const codes = [...new Set(rows.map((r) => r.code as string))];
  const lineups = db.all(`SELECT code, level, series, number, team, alliance, station, surrogate, dq, on_field FROM match_teams WHERE season = ? AND code IN (${codes.map(() => "?").join(",")}) ORDER BY station, team`, [season, ...codes]);
  const lu = new Map<string, { red: MatchView["red"]["teams"]; blue: MatchView["blue"]["teams"] }>();
  for (const t of lineups) {
    const k = `${t.code}|${t.level}:${t.series}:${t.number}`;
    let l = lu.get(k); if (!l) { l = { red: [], blue: [] }; lu.set(k, l); }
    (t.alliance === "red" ? l.red : l.blue).push({ number: Number(t.team), surrogate: !!t.surrogate, dq: !!t.dq, onField: !!t.on_field });
  }
  return rows.map((r) => {
    const key = `${r.level}:${r.series}:${r.number}`;
    const l = lu.get(`${r.code}|${key}`) ?? { red: [], blue: [] };
    let prediction: MatchPredictionView | null = null;
    if (!r.played && opts.predict) {
      const red = l.red.filter((t) => t.onField).map((t) => t.number), blue = l.blue.filter((t) => t.onField).map((t) => t.number);
      if (red.length === 2 && blue.length === 2) prediction = opts.predict(season, red, blue, r.level, r.code);
    }
    const startsAt = localToUtcMs(r.time, r.timezone);
    return {
      season, code: r.code, key, level: r.level, series: Number(r.series), number: Number(r.number), label: r.label, time: r.time,
      startsAt: startsAt == null ? null : new Date(startsAt).toISOString(), played: !!r.played,
      red: { teams: l.red, score: r.played ? score(r, "red") : null },
      blue: { teams: l.blue, score: r.played ? score(r, "blue") : null },
      video: r.video ?? null,
      prediction,
    };
  });
}

// --- Events (server/api/events.ts) ------------------------------------------------

function statusOf(start: string | null, end: string | null, played: number, total: number): EventSummary["status"] {
  const t = new Date().toISOString().slice(0, 10);
  if (start && start > t) return "upcoming";
  if ((end ?? start ?? "") < t) return "finished";
  return played && played >= total && total > 0 ? "finished" : "live";
}

function summary(r: any): EventSummary {
  const played = Number(r.played ?? 0), total = Number(r.total ?? 0);
  return {
    season: Number(r.season), code: r.code, name: r.name, type: r.type, typeLabel: eventTypeLabel(r.type), divisionCode: r.division_code ?? null,
    region: r.region, city: r.city, state: r.state, country: r.country, venue: r.venue ?? null, start: r.start, end: r.end, remote: !!r.remote,
    teams: Number(r.teams ?? 0), matchesPlayed: played, matchesTotal: total, status: statusOf(r.start, r.end, played, total),
  };
}

const SUMMARY_SQL = `SELECT e.*,
  (SELECT COUNT(*) FROM event_teams t WHERE t.season = e.season AND t.code = e.code) teams,
  (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) played,
  (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code) total
  FROM events e`;

export function readEventDetail(sdb: SeasonDb, code: string, opts: ReadOpts = {}): EventDetail | null {
  const { season, db } = sdb;
  const r = one(db, `${SUMMARY_SQL} WHERE e.season = ? AND e.code = ?`, [season, code]);
  if (!r) return null;
  const entries = db.all("SELECT et.*, t.name, t.city, t.state FROM event_teams et LEFT JOIN teams t ON t.number = et.team WHERE et.season = ? AND et.code = ?", [season, code]);
  const oprBy = new Map(db.all("SELECT * FROM team_event_stats WHERE season = ? AND code = ?", [season, code]).map((o) => [Number(o.team), o]));
  const alliances = db.all("SELECT * FROM alliances WHERE season = ? AND code = ? ORDER BY number", [season, code]);
  const awards = db.all("SELECT * FROM awards WHERE season = ? AND code = ? ORDER BY CASE type WHEN 'Inspire' THEN 0 WHEN 'Winner' THEN 1 WHEN 'Finalist' THEN 2 ELSE 3 END, type, placement", [season, code]);
  const adv = one(db, "SELECT * FROM advancement WHERE season = ? AND code = ?", [season, code]);
  const field: FieldRow[] = entries.map((e) => {
    const o = oprBy.get(Number(e.team));
    return {
      team: Number(e.team), name: e.name ?? null, city: e.city ?? null, state: e.state ?? null, rank: e.rank, rp: e.rp, tbp: e.tbp,
      wins: e.wins, losses: e.losses, ties: e.ties, qualPlayed: e.qual_played,
      opr: { np: o?.opr_np ?? null, auto: o?.opr_auto ?? null, teleop: o?.opr_teleop ?? null, endgame: o?.opr_endgame ?? null, pen: o?.opr_pen ?? null },
      avgNp: o?.avg_np ?? null,
      rating: opts.rating?.(season, Number(e.team)) ?? null,
    };
  }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.team - b.team);
  return {
    event: { ...summary(r), website: r.website ?? null, livestream: r.livestream ?? null, timezone: r.timezone ?? null, source: r.source },
    field,
    matches: readMatchViews(sdb, { code }, opts),
    alliances: alliances.map((a) => ({ number: a.number, name: a.name, captain: a.captain, pick1: a.pick1, pick2: a.pick2, backup: a.backup })),
    awards: awards.map((a) => ({ type: a.type, placement: a.placement, team: a.team, name: a.name })),
    advancement: adv ? { slots: adv.slots, advancesTo: adv.advances_to, rows: JSON.parse(adv.rows) } : null,
    live: null, // a saved season: no live checks, no Refresh results (that needs the server)
    forecastUnsupported: OFFLINE_FORECAST,
  };
}

// --- Search (server/api/search.ts) ------------------------------------------------
//
// The server ranks with full-text indexes the packs don't carry; offline every
// name is scanned in memory with the same two paths: word prefixes over
// everything its word index holds (number, name, school, place and state name;
// event code, name, place, start date), and typos over the names its typo index
// holds (team name + school, event name + city). Same fuzzy scoring after.

const MATCH_RE = /^(?:(20\d\d)\s+)?([a-z0-9]{3,16})\s+(q|qual|m|match|f|final)\s*-?\s*(\d{1,3})(?:-(\d))?$/i;

function matchHit(saved: SeasonDb[], q: string): SearchHit | null {
  const m = MATCH_RE.exec(q.trim());
  if (!m) return null;
  const code = m[2].toUpperCase();
  const at = saved.find((s) => (m[1] ? s.season === Number(m[1]) : true) && one(s.db, "SELECT 1 FROM events WHERE code = ?", [code]));
  if (!at) return null;
  const { season, db } = at;
  const kind = m[3].toLowerCase()[0];
  const n = Number(m[4]);
  const row = kind === "q"
    ? one(db, "SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'qual' AND number = ?", [season, code, n])
    : kind === "f"
      ? one(db, "SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND series = 0 AND number = ?", [season, code, n])
      : one(db, "SELECT level, series, number, label FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND series = ? AND number = ?", [season, code, n, Number(m[5] ?? 1)]);
  if (!row) return null;
  const ev = one(db, "SELECT name FROM events WHERE season = ? AND code = ?", [season, code]);
  return { kind: "match", ref: `${season}:${code}:${row.level}:${row.series}:${row.number}`, title: `${row.label} · ${ev?.name ?? code}`, subtitle: `${code} · ${season}`, season };
}

/** words: everything searchable (prefixes); typo/bigrams: the names typos may match; shown: title + subtitle. */
interface Row { kind: "team" | "event"; ref: string; season: number; weight: number; title: string; subtitle: string; words: string[]; typo: string[]; bigrams: Set<string>; shown: string[] }

const bigrams = (s: string) => { const out = new Set<string>(); for (const w of s.split(" ")) for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2)); return out; };
const rowsCache = new WeakMap<Db, { newest: number; rows: Row[] }>();

/** One pack's searchable rows, built once per opened pack (the newest saved season weighs more), like rebuildSearch (server/stats/job.ts). */
function rowsOf({ season, db }: SeasonDb, newest: number): Row[] {
  const hit = rowsCache.get(db);
  if (hit?.newest === newest) return hit.rows;
  const weight = season === newest ? 2 : 1;
  const row = (kind: Row["kind"], ref: string, title: string, subtitle: string, terms: string, name: string): Row => ({
    kind, ref, season, weight, title, subtitle, words: words(`${title} ${subtitle} ${terms}`),
    typo: words(`${title} ${name}`), bigrams: bigrams(normalize(`${title} ${name}`)), shown: words(`${title} ${subtitle}`),
  });
  const rows = [
    ...db.all("SELECT number, name, school, city, state, country FROM teams").map((t) => {
      const place = [t.city, t.state, t.country].filter(Boolean).join(", ");
      const title = `${t.number} ${t.name ?? ""}`.trim();
      return row("team", String(t.number), title, [t.school, place].filter(Boolean).join(" · "), `${t.number} ${t.name ?? ""} ${t.school ?? ""} ${place} ${regionNames(t.state, t.country)}`, `${t.name ?? ""} ${t.school ?? ""}`);
    }),
    ...db.all("SELECT code, name, city, state, country, start FROM events").map((e) => {
      const place = [e.city, e.state, e.country].filter(Boolean).join(", ");
      return row("event", `${season}:${e.code}`, e.name, [e.code, e.start, place].filter(Boolean).join(" · "), `${e.code} ${e.name} ${place} ${regionNames(e.state, e.country)}`, `${e.name} ${e.city ?? ""}`);
    }),
  ];
  rowsCache.set(db, { newest, rows });
  return rows;
}

/** Search the saved seasons: a match ("USNJQ1 Q12"), team numbers, then names. */
export function readSearch(dbs: SeasonDb[], q: string, limit = 15, prefer: ReadonlySet<string> = new Set()): SearchHit[] {
  const query = q.trim();
  if (!query) return [];
  const saved = [...dbs].sort((a, b) => b.season - a.season);
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => { const k = `${h.kind}:${h.ref}`; if (!seen.has(k)) { seen.add(k); out.push(h); } };

  const mh = matchHit(saved, query);
  if (mh) push(mh);

  // Team numbers: exact first, then prefix matches as you type ("163" → 16321…).
  if (/^[1-9]\d{0,5}$/.test(query)) {
    const p = Number(query);
    const ranges: [number, number][] = [];
    for (let m = 1; p * m < 1_000_000; m *= 10) ranges.push([p * m, (p + 1) * m - 1]);
    const teams = new Map<number, { t: any; season: number }>();
    for (const s of saved) {
      for (const t of s.db.all(`SELECT number, name, city, state, country FROM teams WHERE ${ranges.map(() => "number BETWEEN ? AND ?").join(" OR ")}`, ranges.flat())) {
        if (!teams.has(Number(t.number))) teams.set(Number(t.number), { t, season: s.season }); // newest season first
      }
    }
    const newest = saved[0]?.season;
    const ranked = [...teams.values()].sort((a, b) =>
      Number(b.t.number === p) - Number(a.t.number === p)
      || Number(prefer.has(`team:${b.t.number}`)) - Number(prefer.has(`team:${a.t.number}`))
      || Number(b.season === newest) - Number(a.season === newest)
      || a.t.number - b.t.number);
    for (const { t, season } of ranked.slice(0, query.length >= 4 ? Math.ceil(limit / 2) : limit)) {
      push({ kind: "team", ref: String(t.number), title: `${t.number} ${t.name ?? ""}`.trim(), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season });
    }
    if (out.length >= limit) return out.slice(0, limit);
  }
  // Short numbers would match every date ("16" → the 16th).
  if (/^\d+$/.test(query) && query.length < 4) return out;

  const qs = words(query);
  if (!qs.length) return out;
  const qb = bigrams(qs.join(" "));
  // Like the server, typos only count for words with letters: "4215" finds 42150 or a code with 4215 in it, never 4115.
  const typos = /\p{L}/u.test(query);
  const newest = saved[0]?.season ?? 0;
  const best = new Map<string, { r: Row; s: number }>();
  for (const sdb of saved) {
    for (const r of rowsOf(sdb, newest)) {
      // The word index: every query word starts a word of the row (a city, a year, a state's name…).
      const prefix = qs.every((q) => r.words.some((w) => w.startsWith(q)));
      // The typo index, with a cheap prefilter: a typo of a word still shares a 2-letter chunk with it.
      let typo = false;
      if (!prefix && typos) for (const b of qb) if (r.bigrams.has(b)) { typo = true; break; }
      if (!prefix && !typo) continue;
      let s = Math.max(scoreWords(qs, prefix ? r.words : r.typo), scoreWords(qs, r.shown) * 0.95);
      if (s < 0.6) continue;
      if (prefer.has(`${r.kind}:${r.ref}`)) s += 0.1;
      const k = `${r.kind}:${r.ref}`;
      if (!best.has(k)) best.set(k, { r, s }); // newest season's row wins for a team in several
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.s - a.s || b.r.weight - a.r.weight || b.r.season - a.r.season || a.r.title.localeCompare(b.r.title));
  for (const { r } of ranked) { if (out.length >= limit) break; push({ kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, season: r.season }); }
  return out.slice(0, limit);
}
