// One event's forecast as the Predict page's Advancement view and the event page's Forecast show it (GET
// /api/predict/event), shared with search's advancement-odds answer so both print the same numbers: "current" is
// today's ratings and the results so far; "pre-event" is the forecast as it would have been made the day before the
// event (no hindsight), the Predict page's "Before the event" view. Kept for two minutes against the ratings in use;
// a finished event's pre-event forecast, which nothing moves once the season's ratings are settled, for a day.
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import type { ForecastView } from "../../src/shared/api.js";
import { FORECAST_RUNS } from "../../src/shared/projections.js";
import { seasonInfo } from "../data/seasons.js";
import { eventDetail, toEventInput } from "../api/events.js";
import { registerCache } from "../caches.js";
import { dataVersion, liveForecaster, liveVersion } from "./engine.js";

/** Why a forecast can't be made, with the HTTP status the route answers (404 no event, 422 unsupported, 503 not ready). */
export class ForecastUnavailable extends Error { constructor(readonly status: number, message: string) { super(message); } }

const TTL_MS = 120_000, FINISHED_TTL_MS = 24 * 3_600_000;
const kept = new Map<string, { at: number; ttl: number; v: Promise<ForecastView> }>();
registerCache("Event forecasts", () => kept.clear());

/** The forecast of `code` in `season` for `team` (its own odds, points and partner view; null for everyone's), in `mode`. */
export async function eventForecast(season: number, code: string, team: number | null, mode: ForecastView["mode"]): Promise<ForecastView> {
  // Keyed by the ratings in use too: while new ones build, results from the previous ones aren't kept as the new data's.
  const key = `${await dataVersion()}|${await liveVersion(season)}|${season}|${code}|${team ?? ""}|${mode}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  const v = make(season, code, team, mode);
  const entry = { at: Date.now(), ttl: TTL_MS, v };
  kept.set(key, entry);
  v.then((fc) => { if (mode === "pre-event" && fc.eventEnd && fc.eventEnd < new Date().toISOString().slice(0, 10)) entry.ttl = FINISHED_TTL_MS; }, () => kept.delete(key));
  if (kept.size > 500) kept.delete(kept.keys().next().value!);
  return v;
}

async function make(s: number, c: string, team: number | null, mode: ForecastView["mode"]): Promise<ForecastView> {
  const d = await eventDetail(s, c);
  if (!d) throw new ForecastUnavailable(404, `No event ${c} in ${s}`);
  if (d.forecastUnsupported) throw new ForecastUnavailable(422, d.forecastUnsupported);
  const f = await liveForecaster(s);
  const ev = toEventInput(d.event, d.field, d.matches, d.alliances);
  const fc = mode === "pre-event" ? f.preEventForecast(ev, team, FORECAST_RUNS) : f.forecast(ev, team, FORECAST_RUNS);
  if (!fc) throw new ForecastUnavailable(503, "Ratings for this season aren't ready yet.");
  const finished = d.event.status === "finished";
  // 2025+ games award bonus ranking points. The forecast says how its simulation drew them
  // (fc.bonusDraws: the bonus model it actually used, this event's recorded results, or none),
  // and the flag and any warning follow that one value, so they can't contradict the numbers
  // (a learned season model counts; a frozen "before the event" view with too little earlier
  // data doesn't). Official ranks (after quals) already include them.
  const bonusModelled = fc.bonusDraws !== "none";
  const explained = fc.assumptions.some((a) => /bonus ranking point/i.test(a));
  const assumptions = bonusModelled || explained ? fc.assumptions
    : [...fc.assumptions, `Bonus ranking points for ${seasonInfo(s).game} aren't modelled for this forecast (no bonus model from results so far), so simulated ranks count win/tie points only — real ranks and the odds that depend on them may differ.`];
  return {
    ...fc, assumptions, bonusModelled, eventName: d.event.name, eventStart: d.event.start, eventEnd: d.event.end, myTeam: team, engineVersion: ENGINE_VERSION, mode,
    hindsightNote: mode === "current" && finished ? "This event is over: these odds use ratings that already include its results. Switch to “Before the event” for the forecast made without hindsight." : null,
  };
}
