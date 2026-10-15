// Form validation for team-number fields (My team, Compare, the Predict lab, Scout).
// The name lookup is passed in so this stays a pure, testable function.

/** A team's name: a string (maybe "") when we know the team, null when we don't, undefined when the lookup couldn't run (offline). */
export type TeamLookup = (n: number) => Promise<string | null | undefined>;

/**
 * The error to show for a team-number field, or null when it's fine.
 * A failed lookup (no connection) lets the number through: forms must keep
 * working at a venue with no signal, and the number may well be right.
 */
export async function teamError(value: string, lookup: TeamLookup): Promise<string | null> {
  const v = value.trim();
  if (!v) return "Enter a team number.";
  if (!/^\d{1,6}$/.test(v) || Number(v) < 1) return "A team number is 1 to 6 digits.";
  const name = await lookup(Number(v));
  if (name === null) return `There's no FTC team ${v} on record. Check the number.`;
  return null;
}

/**
 * Errors for a set of team fields that must all be different (the Predict lab's four).
 * Each field gets its own message; a repeat names the field it repeats.
 */
export async function teamsErrors(values: string[], labels: string[], lookup: TeamLookup): Promise<(string | null)[]> {
  const own = await Promise.all(values.map((v) => teamError(v, lookup)));
  return own.map((e, i) => {
    if (e) return e;
    const first = values.findIndex((x) => Number(x.trim()) === Number(values[i].trim()));
    return first < i ? `${Number(values[i].trim())} is already ${labels[first]}. Pick four different teams.` : null;
  });
}
