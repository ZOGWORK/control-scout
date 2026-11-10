// How sure an advancement forecast is: the stated rules Predict's Advancement view and search's advancement card
// both show (AGENTS.md rule 9), one copy for the browser and the server.
import type { ConfidenceTier, ForecastView } from "./api";
import type { ProjectionRun } from "./projections";

/** How sure an advancement forecast is (a stated rule, shown on the page). */
export function forecastTier(fc: ForecastView, team: number | null): { tier: ConfidenceTier; reason: string } {
  const base = forecastTierBase(fc, team);
  if (!fc.bonusModelled && fc.stage !== "selected" && base.tier === "confident") return { tier: "moderate", reason: `${base.reason} Bonus ranking points aren't modelled for this forecast.` };
  return base;
}

function forecastTierBase(fc: ForecastView, team: number | null): { tier: ConfidenceTier; reason: string } {
  const t = team ? fc.teams.find((x) => x.team === team) : null;
  const n = t?.strength.matches ?? Math.min(...fc.teams.map((x) => x.strength.matches));
  if (fc.stage === "selected") return { tier: "confident", reason: "Alliances are set; only the playoffs (and awards) are left to simulate." };
  if (fc.stage === "quals") return n >= 3 ? { tier: "confident", reason: "Quals are over: ranks are known, only alliance selection, playoffs and awards are simulated." } : { tier: "moderate", reason: "Quals are over, but this team has few matches on record." };
  if (n < 3) return { tier: "provisional", reason: `${team ? `Team ${team} has` : "Some teams have"} under 3 matches this season, so the forecast leans on last season.` };
  return { tier: fc.stage === "live" ? "moderate" : n >= 8 ? "moderate" : "provisional", reason: fc.stage === "live" ? "Quals are under way; most of the event is still simulated." : `Before the event, every match is simulated (${n} matches on record for the team).` };
}

/** How sure a projection is: the stage of the event and how much of it is still to simulate (shown on the page). */
export function projectionTier(run: ProjectionRun): { tier: ConfidenceTier; reason: string } {
  if (run.stage === "selected") return { tier: "confident", reason: "Alliances are set: seeds are final and only the playoffs are simulated." };
  if (run.stage === "quals") return { tier: "confident", reason: "Quals are over: seeds are official; alliance selection and playoffs are simulated." };
  const left = run.scheduled ? 1 - run.played / run.scheduled : 1;
  if (run.played === 0) return { tier: "provisional", reason: "Before the first match every result is simulated from ratings." };
  if (left > 0.5) return { tier: "provisional", reason: `${run.played} of ${run.scheduled} qualification matches played: most of the event is still simulated.` };
  return { tier: "moderate", reason: `${run.played} of ${run.scheduled} qualification matches played; the rest are simulated.` };
}
