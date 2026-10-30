// Schedule difficulty: how hard a team's qualification schedule is, next to the rest of the field.
//
// FTC quals are random 2v2 draws, so one team can meet the strongest robots twice while another plays beside
// them. Per team, from the engine's ratings (non-penalty points per robot; a team with no result yet this
// season is rated from its last-season prior, as everywhere else) and the posted schedule:
//
//   opponents = mean rating of its scheduled opponents − the field's mean rating (the field without itself)
//   partners  = mean rating of its scheduled partners  − the same field mean
//   difficulty = opponents − partners          (points; > 0 = harder than a random draw would give on average)
//
// The field without the team itself is the baseline because a random draw never pairs a team with itself:
// a strong team's opponents are on average a little weaker than the whole field, a weak team's a little
// stronger. Against that baseline every team's expected difficulty under a random schedule is 0.
//
// Then normalised across the field: `rank` (1 = hardest of `of` teams) and `z` (standard deviations from the
// field's mean difficulty). A surrogate appearance doesn't count toward the team's rank, so it is left out of
// that team's schedule (its opponents and partners there still count the match).
//
// Two views: `full` over every qualification match, and `remaining` over the unplayed ones once quals are
// under way (null before the first result and after the last). Pure: the server (event detail, team pages,
// offline packs), the device and later features (disagreements, "matches that matter") all call this.

export interface ScheduleMatch {
  red: number[];
  blue: number[];
  /** A result is in. */
  played: boolean;
  /** Surrogates: they play, but the match doesn't count toward their rank. */
  noRank?: number[];
}

export interface ScheduleSide {
  /** Mean opponent rating minus the field's mean (points; + = stronger opponents than the field's average). */
  opponents: number;
  /** Mean partner rating minus the field's mean (points; + = stronger partners). */
  partners: number;
  /** opponents − partners (points; + = harder). */
  difficulty: number;
  /** Matches counted. */
  matches: number;
  /** 1 = hardest schedule among the `of` teams with a counted match. Ties share the better rank. */
  rank: number;
  of: number;
  /** Standard deviations from the field's mean difficulty (0 when the field has no spread). */
  z: number;
}

export interface ScheduleDifficultyTeam {
  team: number;
  /** Every qualification match on the schedule; null when the team has none. */
  full: ScheduleSide | null;
  /** Only the matches still to play, while quals are under way; null before the first result and after the last. */
  remaining: ScheduleSide | null;
}

export interface ScheduleDifficulty {
  /** The field's mean rating (points per robot) the deltas are measured from. */
  fieldMean: number;
  /** Qualification matches on the schedule, and how many have a result. */
  scheduled: number;
  played: number;
  teams: ScheduleDifficultyTeam[];
}

/** Fewer teams than this and a rank says nothing: the event gets no figure. */
export const MIN_SCHEDULE_TEAMS = 6;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Raw { team: number; opp: number[]; part: number[]; n: number }

function sides(raw: Raw[], rating: Map<number, number>, total: number, n: number): Map<number, ScheduleSide> {
  const rows = raw.filter((r) => r.opp.length).map((r) => {
    const self = rating.get(r.team);
    // The field without this team (a team that isn't on the field list is measured against the whole field).
    const base = self == null || n < 2 ? total / Math.max(1, n) : (total - self) / (n - 1);
    const opponents = mean(r.opp) - base, partners = r.part.length ? mean(r.part) - base : 0;
    return { team: r.team, opponents, partners, difficulty: opponents - partners, matches: r.n };
  });
  const out = new Map<number, ScheduleSide>();
  if (!rows.length) return out;
  const m = mean(rows.map((r) => r.difficulty));
  const sd = Math.sqrt(mean(rows.map((r) => (r.difficulty - m) ** 2)));
  for (const r of rows) {
    const rank = 1 + rows.filter((o) => o.difficulty > r.difficulty + 1e-9).length;
    out.set(r.team, {
      opponents: r1(r.opponents), partners: r1(r.partners), difficulty: r1(r.difficulty), matches: r.matches,
      rank, of: rows.length, z: sd > 1e-9 ? r2((r.difficulty - m) / sd) : 0,
    });
  }
  return out;
}

function collect(field: number[], matches: ScheduleMatch[], rating: Map<number, number>): Raw[] {
  const by = new Map<number, Raw>(field.map((t) => [t, { team: t, opp: [], part: [], n: 0 }]));
  for (const m of matches) {
    for (const [mine, theirs] of [[m.red, m.blue], [m.blue, m.red]] as const) {
      for (const t of mine) {
        if (m.noRank?.includes(t)) continue;
        const row = by.get(t);
        const opp = theirs.map((o) => rating.get(o)), part = mine.filter((p) => p !== t).map((p) => rating.get(p));
        // A lineup with a robot the field doesn't list has no rating to read: left out rather than guessed.
        if (!row || opp.length === 0 || opp.some((x) => x == null) || part.some((x) => x == null)) continue;
        row.opp.push(...(opp as number[]));
        row.part.push(...(part as number[]));
        row.n++;
      }
    }
  }
  return [...by.values()];
}

/**
 * Schedule difficulty for every team of an event.
 * `rating`: each field team's rating (non-penalty points per robot), priors included; the field is its keys.
 * Null when there's nothing to rank: no qualification schedule, or a field under MIN_SCHEDULE_TEAMS.
 */
export function scheduleDifficulty(rating: Map<number, number>, quals: ScheduleMatch[]): ScheduleDifficulty | null {
  const field = [...rating.keys()];
  if (!quals.length || field.length < MIN_SCHEDULE_TEAMS) return null;
  const total = [...rating.values()].reduce((a, b) => a + b, 0), n = field.length;
  const played = quals.filter((m) => m.played).length;
  const full = sides(collect(field, quals, rating), rating, total, n);
  const open = played > 0 && played < quals.length;
  const remaining = open ? sides(collect(field, quals.filter((m) => !m.played), rating), rating, total, n) : new Map<number, ScheduleSide>();
  if (!full.size) return null;
  return {
    fieldMean: r1(total / n), scheduled: quals.length, played,
    teams: field.map((team) => ({ team, full: full.get(team) ?? null, remaining: remaining.get(team) ?? null }))
      .sort((a, b) => (a.full?.rank ?? 1e9) - (b.full?.rank ?? 1e9) || a.team - b.team),
  };
}

const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(Math.round(x))}`;
const ordinal = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };

/** "3rd-hardest of 24" / "easiest of 24" / "hardest of 24": where a schedule sits in its field. */
export function scheduleRankText(s: Pick<ScheduleSide, "rank" | "of">): string {
  if (s.rank === 1) return `hardest of ${s.of}`;
  // Counted from the easy end when that reads shorter ("2nd-easiest of 24" rather than "23rd-hardest").
  const fromEasy = s.of - s.rank + 1;
  if (fromEasy === 1) return `easiest of ${s.of}`;
  return fromEasy < s.rank ? `${ordinal(fromEasy)}-easiest of ${s.of}` : `${ordinal(s.rank)}-hardest of ${s.of}`;
}

/** A word for a schedule from its z: what a reader should take from it at a glance. */
export function scheduleWord(z: number): "Hard" | "Tough" | "Average" | "Kind" | "Easy" {
  return z >= 1 ? "Hard" : z >= 0.4 ? "Tough" : z > -0.4 ? "Average" : z > -1 ? "Kind" : "Easy";
}

/** The one plain line: "Opponents average +38 over the field's, partners −12." Never just a number. */
export function scheduleLine(s: Pick<ScheduleSide, "opponents" | "partners">, who: "your" | "its" | "" = ""): string {
  const o = who ? `${who[0].toUpperCase()}${who.slice(1)} opponents` : "Opponents";
  const p = who ? `${who} partners` : "partners";
  return `${o} average ${signed(s.opponents)} over the field's, ${p} ${signed(s.partners)}.`;
}
