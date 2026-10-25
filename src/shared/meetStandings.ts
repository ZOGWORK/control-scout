// A league meet's own qualification standing, from its played matches alone. FIRST ranks a league meet by the
// league's running totals (its ranking score averages every meet's matches so far), which reads wrong on the
// meet's own page: a 4-1 team at the meet can show 1.6. This ranks the meet the way a one-day event is ranked,
// with the engine's season rules (rankingPoints, tiebreakKeys): the official league rank stays as FIRST gives it.
import { rankingPoints, tiebreakKeys } from "@control-scout/predict-engine";

export interface MeetSide {
  /** Teams listed on the alliance. `counts` false: a surrogate (the match isn't on its record). `noShow`: 0 ranking
   *  points, the alliance's score in its averages. `dq`: the match counts with zeros for it, ranking points and
   *  tiebreakers alike (T601, as the engine's simulation tallies it). Either way the result stays on its record. */
  teams: { team: number; counts: boolean; noShow?: boolean; dq?: boolean }[];
  total: number; np: number; auto: number; endgame: number;
  tips?: number | null;
  bonus?: { movement: boolean; goal: boolean; pattern: boolean } | null;
}
export interface MeetMatch { red: MeetSide; blue: MeetSide }

export interface MeetStanding {
  rank: number; team: number;
  /** Ranking score: average ranking points per counted match. */
  rs: number;
  /** The season's sort keys after the ranking score (2026: average non-foul points, TIPS, auto). */
  tb: number[];
  wins: number; losses: number; ties: number; played: number;
}

/** The meet's standing, best first. A team with no counted match isn't ranked. */
export function meetStandings(season: number, matches: MeetMatch[]): MeetStanding[] {
  const acc = new Map<number, { rp: number; np: number; auto: number; endgame: number; tips: number; w: number; l: number; t: number; n: number }>();
  for (const m of matches) {
    for (const [own, opp] of [[m.red, m.blue], [m.blue, m.red]] as const) {
      const rp = rankingPoints(season, { total: own.total, bonus: own.bonus ?? undefined }, { total: opp.total });
      for (const t of own.teams) {
        if (!t.counts) continue;
        const a = acc.get(t.team) ?? { rp: 0, np: 0, auto: 0, endgame: 0, tips: 0, w: 0, l: 0, t: 0, n: 0 };
        if (!t.dq) {
          a.rp += t.noShow ? 0 : rp;
          a.np += own.np; a.auto += own.auto; a.endgame += own.endgame; a.tips += own.tips ?? 0;
        }
        if (own.total > opp.total) a.w++; else if (own.total < opp.total) a.l++; else a.t++;
        a.n++;
        acc.set(t.team, a);
      }
    }
  }
  const rows = [...acc].map(([team, a]) => ({
    team, rs: a.rp / a.n, wins: a.w, losses: a.l, ties: a.t, played: a.n,
    tb: tiebreakKeys(season, { np: a.np / a.n, auto: a.auto / a.n, endgame: a.endgame / a.n, tips: a.tips / a.n }),
  }));
  // Rounded as FIRST shows them, so two teams level on screen are level here too; then team number (FIRST draws at random).
  const r2 = (x: number) => Math.round(x * 100) / 100;
  rows.sort((a, b) => r2(b.rs) - r2(a.rs) || a.tb.map((x, i) => r2(b.tb[i]) - r2(x)).find((d) => d !== 0) || a.team - b.team);
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
