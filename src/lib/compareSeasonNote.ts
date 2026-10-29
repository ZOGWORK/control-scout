// Compare without ?season= asks the server for the latest season any of the chosen teams has results in, so
// adding or removing a team can move the page to another season. This says so, in one line, whenever the
// season shown isn't the current one or some of the teams have nothing in it.
import { seasonLabel } from "./format";

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The one-line note, or null when there's nothing to explain (a season picked by hand, or every team has results in the current one). */
export function compareSeasonNote(o: { asked: boolean; season: number; current: number; teams: { number: number; hasResults: boolean }[] }): string | null {
  if (o.asked || !o.teams.length) return null;
  const none = o.teams.filter((t) => !t.hasResults).map((t) => String(t.number));
  const older = o.season < o.current;
  if (!older && !none.length) return null;
  const why = `${seasonLabel(o.season)} is the latest season ${o.teams.length === 1 ? "this team has" : "any of these teams has"} results in`;
  const head = older ? `No ${seasonLabel(o.current)} results yet, so this compares ${seasonLabel(o.season)}: ${why}.` : `Showing ${seasonLabel(o.season)}: ${why}.`;
  const gap = none.length ? ` ${list(none)} ${none.length === 1 ? "has" : "have"} none in ${seasonLabel(o.season)}; pick another season above to compare ${none.length === 1 ? "it" : "them"} there.` : "";
  return head + gap;
}
