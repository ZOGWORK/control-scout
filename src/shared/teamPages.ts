// Which team numbers have a public team page: one rule for the server (team page and API 404s, the
// sitemap, rankings, search, the team directory and records) and the web app (whether a team number
// in a match or event list is a link).
//
// Two kinds of number in FIRST's data aren't a team anyone can look up:
//  - Numbers past 999999. FTC team numbers have at most six digits. FIRST's 2023 team list also holds
//    registrations still waiting for a number, under a stand-in of the season and a sequence
//    (202300005, 202302334, …); a few even played league meets under it. They never get a page.
//  - FIRST's placeholder registrations. Off-season events enter teams that aren't registered for the
//    season as "Off-Season Demo Team" (FIRST keeps a block of them, 99900 to 100000), and one test
//    registration is named just "Demo Team". Their matches are real, but the "team" is a different
//    robot at every event, so a page, a world rank or a search hit for it would mean nothing.
// The placeholders are told by FIRST's own name for them, not by a list of numbers: the block's
// numbers are FIRST's habit, not a rule (100000 sits outside it), and a name catches a new one the
// day it's synced. The rows stay in the database and their matches stay on event pages, unlinked.
export const TEAM_NUMBER_MAX = 999_999;

/** FIRST's names for placeholder registrations, lowercased (compared trimmed and case-blind). */
export const PLACEHOLDER_TEAM_NAMES: readonly string[] = ["off-season demo team", "demo team"];

/** Whether a team name is one of FIRST's placeholder names. */
export const isPlaceholderTeamName = (name: string | null | undefined): boolean =>
  name != null && PLACEHOLDER_TEAM_NAMES.includes(name.trim().toLowerCase());

/** A number an FTC team can have: a whole number from 1 to 999999. */
export const isTeamNumber = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= TEAM_NUMBER_MAX;

/** Whether team `number` (named `name`, when known) has a public page. */
export const hasTeamPage = (number: number, name?: string | null): boolean => isTeamNumber(number) && !isPlaceholderTeamName(name);

const NAMES_SQL = PLACEHOLDER_TEAM_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(", ");

/**
 * The same rule in SQL, for the team number in column `col`: true when that team has a public page.
 * `nameCol`: the team's name where the query already joins its teams row (a LEFT JOIN's null name passes);
 * without it the name is looked up. A team we hold no row for passes (its name is unknown, as hasTeamPage
 * without a name). Only constants go into the text, never input.
 */
export const teamPageSql = (col: string, nameCol?: string): string =>
  `(${col} BETWEEN 1 AND ${TEAM_NUMBER_MAX} AND ${nameCol
    ? `lower(trim(COALESCE(${nameCol}, ''))) NOT IN (${NAMES_SQL})`
    : `${col} NOT IN (SELECT number FROM teams WHERE lower(trim(name)) IN (${NAMES_SQL}))`})`;
