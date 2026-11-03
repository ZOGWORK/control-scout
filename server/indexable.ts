// Which team and event pages search engines should index: one rule for the page's robots tag (server/seoMeta.ts),
// the sitemap (server/sitemap.ts) and IndexNow (server/indexNow.ts), so they can never disagree.
//
// A page with nothing on it but a name (a team that has never played, an event with no teams and no matches) is
// what Google calls a soft 404: indexing it costs the site, it doesn't gain a page. Such a page stays up (a team
// looking itself up still finds it) but says noindex and stays out of the sitemap, until its first data arrives: then
// the same rule, read on every request and every sitemap build, lets it in. Nothing is flipped by hand.
//
// An event page also has to be reachable at all: the app (and the API) look an event up by its code in upper case,
// within [A-Z0-9_-]{2,24} (server/app.ts code()). FIRST's older seasons hold codes outside that ("2019INMeet10",
// "USVTM(KO", "63693260770.2649"); their address answers 404, so it's never listed.
import { CURRENT_SEASON, SEASON_NUMBERS } from "./data/seasons.js";
import { teamPageSql } from "../src/shared/teamPages.js";

/** Whether `code` (as stored) is an event code the page and the API can look up. */
export const isReachableEventCode = (code: string): boolean => /^[A-Z0-9_-]{2,24}$/.test(code);

/** SQL, for the event in `e` (an events alias): it has teams (a roster, or FIRST's registrations while it has none,
 *  as the page counts them: data/registrations.ts ROSTER) or a played match. Constants only. */
export const eventHasDataSql = (e: string): string =>
  `(EXISTS (SELECT 1 FROM event_teams t WHERE t.season = ${e}.season AND t.code = ${e}.code)
    OR EXISTS (SELECT 1 FROM event_registrations r WHERE r.season = ${e}.season AND r.code = ${e}.code AND r.shared = 0)
    OR EXISTS (SELECT 1 FROM matches m WHERE m.season = ${e}.season AND m.code = ${e}.code AND m.played = 1))`;

/**
 * SQL, for the team number in column `col`: its page shows something besides its name. Any of, as the team page
 * (server/api/teams.ts teamProfile) reads them:
 *  - a season with results (teamSeasons: a stats row with matches, qualification matches played, a remote ranking;
 *    the stats row by its key, season by season, so a sitemap build over every team stays quick);
 *  - a match it was on the field for;
 *  - an award;
 *  - an event of the current season on its page: the page's rule (src/shared/teamEventRows.ts keepEvent) for an
 *    event without results, upcoming or under way (any type) or finished (any but a league meet, which lists
 *    every league team at every meet). Events with results count through the matches above.
 * Constants only.
 */
export const teamHasDataSql = (col: string): string =>
  `(EXISTS (SELECT 1 FROM team_season_stats s WHERE s.season IN (${SEASON_NUMBERS.join(", ")}) AND s.team = ${col} AND s.matches > 0)
    OR EXISTS (SELECT 1 FROM event_teams q WHERE q.team = ${col} AND (q.qual_played > 0
      OR EXISTS (SELECT 1 FROM events re WHERE re.season = q.season AND re.code = q.code AND re.remote = 1 AND q.rank IS NOT NULL)))
    OR EXISTS (SELECT 1 FROM match_teams x JOIN matches m
      ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
      WHERE x.team = ${col} AND x.on_field = 1 AND m.played = 1)
    OR EXISTS (SELECT 1 FROM awards a JOIN events ae ON ae.season = a.season AND ae.code = a.code WHERE a.team = ${col})
    OR EXISTS (SELECT 1 FROM event_teams u JOIN events ue ON ue.season = u.season AND ue.code = u.code
      WHERE u.team = ${col} AND u.season = ${CURRENT_SEASON}
        AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.season = u.season AND m.code = u.code AND m.played = 1)
        AND (COALESCE(ue.end, ue.start, '9999') >= date('now') OR COALESCE(ue.type, '') <> 'LeagueMeet')))`;

/** SQL, for the team number in `col` (its teams row's name in `nameCol`, when joined): it has a page worth indexing. */
export const teamIndexableSql = (col: string, nameCol?: string): string => `(${teamPageSql(col, nameCol)} AND ${teamHasDataSql(col)})`;
