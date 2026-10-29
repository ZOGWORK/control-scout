// Which team numbers have a public team page: one rule for the server (team page and API 404s, the
// sitemap, rankings, search, the team directory and records) and the web app (whether a team number
// in a match or event list is a link).
//
// Two kinds of number in FIRST's data aren't a team anyone can look up:
//  - Numbers past 999999. FTC team numbers have at most six digits. FIRST's 2023 team list also holds
//    registrations still waiting for a number, under a stand-in of the season and a sequence
//    (202300005, 202302334, …); a few even played league meets under it. They never get a page.
//  - Placeholder registrations. Off-season events enter teams that aren't registered for the season as
//    "Off-Season Demo Team" (FIRST keeps a block of them, 99900 to 100000); one test registration is
//    named just "Demo Team"; and staff and coaches trying out registration leave "Test Team" entries
//    ("FIRSTIL TEST TEAM", "Test Team 1", "Test_Team", "Dave's test team"). An off-season placeholder's
//    matches are real, but the "team" is a different robot at every event; a test entry never plays.
//    A page, a world rank or a search hit for either would mean nothing.
// Placeholders are told by name, not by a list of numbers: the block's numbers are FIRST's habit, not a
// rule (100000 sits outside it), and a name catches a new one the day it's synced. The rows stay in
// the database and their matches stay on event pages, unlinked.
//
// The name test, the same in TypeScript and SQL: trim spaces, lowercase, "_" → " ", drop trailing digits
// and spaces ("Test Team 271" → "test team"); then it's a placeholder when it is exactly one of
// PLACEHOLDER_TEAM_NAMES or ends in " test team" (a word of its own: "2024 FTC Pitsco Test Team"). So
// "Test Team Tech", "Testing Team", "Test Pilots", "Contest Crew" and "Greatest Team" are teams.
export const TEAM_NUMBER_MAX = 999_999;

/** Placeholder names, as the name test normalises them. */
export const PLACEHOLDER_TEAM_NAMES: readonly string[] = ["off-season demo team", "demo team", "test team", "testteam"];
/** A normalised name ending in this (after a space) is a test registration too. */
const TEST_TEAM_SUFFIX = " test team";

/** The name test's normalisation (exactly what placeholderNameSql does in SQL). */
const normalName = (name: string) => name.replace(/^ +| +$/g, "").toLowerCase().replace(/_/g, " ").replace(/[0-9 ]+$/, "");

/** Whether a team name is a placeholder's (see above). */
export const isPlaceholderTeamName = (name: string | null | undefined): boolean => {
  if (name == null) return false;
  const n = normalName(name);
  return PLACEHOLDER_TEAM_NAMES.includes(n) || n.endsWith(TEST_TEAM_SUFFIX);
};

/** A number an FTC team can have: a whole number from 1 to 999999. */
export const isTeamNumber = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= TEAM_NUMBER_MAX;

/** Whether team `number` (named `name`, when known) has a public page. */
export const hasTeamPage = (number: number, name?: string | null): boolean => isTeamNumber(number) && !isPlaceholderTeamName(name);

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL: true when the name in column `nameCol` is a placeholder's (a null name isn't). Constants only. */
export const placeholderNameSql = (nameCol: string): string => {
  const n = `rtrim(replace(lower(trim(${nameCol})), '_', ' '), '0123456789 ')`;
  return `(${nameCol} IS NOT NULL AND (${n} IN (${PLACEHOLDER_TEAM_NAMES.map(sqlText).join(", ")}) OR ${n} LIKE ${sqlText(`%${TEST_TEAM_SUFFIX}`)}))`;
};

/**
 * The same rule in SQL, for the team number in column `col`: true when that team has a public page.
 * `nameCol`: the team's name where the query already joins its teams row (a LEFT JOIN's null name passes);
 * without it the name is looked up. A team we hold no row for passes (its name is unknown, as hasTeamPage
 * without a name). Only constants go into the text, never input.
 */
export const teamPageSql = (col: string, nameCol?: string): string =>
  `(${col} BETWEEN 1 AND ${TEAM_NUMBER_MAX} AND ${nameCol
    ? `NOT ${placeholderNameSql(nameCol)}`
    : `${col} NOT IN (SELECT number FROM teams WHERE ${placeholderNameSql("name")})`})`;
