// A what-if matchup's prediction (/api/predict/match, and the first paint of /predict?mode=match: server/firstPaint.ts),
// built the one way, so the drawn page and the API can't differ. The view itself is src/shared/predictView.ts, which the
// device's offline prediction uses too.
import { all } from "../db.js";
import { isEnabled } from "../flags.js";
import { liveForecaster, recentRecords } from "../predict/engine.js";
import { matchView } from "../../src/shared/predictView.js";
import type { MatchExplanationView } from "../../src/shared/api.js";

/** The prediction for `red` vs `blue` in `season` (each side 1–3 teams, already checked), as a qualification or playoff
 *  match. Null while the season's ratings aren't ready. */
export async function matchExplanation(season: number, red: number[], blue: number[], level: "qual" | "playoff" = "qual"): Promise<MatchExplanationView | null> {
  const f = await liveForecaster(season);
  const x = f.explain(season, red, blue, level, undefined, await recentRecords(season, [...red, ...blue]));
  if (!x) return null;
  const names = new Map((await all<any>(`SELECT number, name FROM teams WHERE number IN (${[...red, ...blue].map(() => "?").join(",")})`, [...red, ...blue])).map((r) => [Number(r.number), r.name]));
  return matchView(season, red, blue, level, x, (t) => names.get(t) ?? null, await isEnabled("factorSheet"));
}
