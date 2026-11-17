// An event's days, for matching its videos: FIRST's listed dates, widened to every day it played a match. FIRST's
// dates are wrong for some events: Kazakhstan Central Asia FTC Regional Championship 2022 (KZCMP) is listed
// 2023-02-23 to 02-25 and played its last 8 qualifications and its playoffs on 02-26, so its day-2 recordings fitted no
// event. On 17 Nov, 145 events had 2,619 played matches outside their listed dates. A played match's time is the
// venue's own (FIRST's actual start), the same clock as the listed dates.

/** SQL for a played match's first or last venue-local day of the events row aliased `e`; NULL when none was played. */
const playedDay = (fn: "MIN" | "MAX") =>
  `(SELECT substr(${fn}(m.time), 1, 10) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1 AND m.time IS NOT NULL)`;

/** The event's first day (YYYY-MM-DD) over an events row aliased `e`: its listed start, or an earlier played day. */
export const EVENT_FIRST_DAY = `MIN(substr(e.start, 1, 10), COALESCE(${playedDay("MIN")}, substr(e.start, 1, 10)))`;
/** Its last day: its listed end (its start when it has none), or a later played day. */
export const EVENT_LAST_DAY = `MAX(substr(COALESCE(e.end, e.start), 1, 10), COALESCE(${playedDay("MAX")}, substr(COALESCE(e.end, e.start), 1, 10)))`;

/** The venue-local days it played a match, comma-separated in any order (NULL: none yet): a title's "day 2" is the second
 *  of these as well as the second of its listed dates (RONR4LT 2023 is listed 7 to 9 March 2024 and played on the 9th
 *  and 10th; its "DAY 2" broadcast is on the 10th). */
export const EVENT_PLAYED_DAYS = `(SELECT group_concat(DISTINCT substr(m.time, 1, 10)) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1 AND m.time IS NOT NULL)`;

/** EVENT_PLAYED_DAYS as read: the days in order, or undefined when none. */
export const playedDays = (v: unknown): string[] | undefined => (v ? String(v).split(",").filter(Boolean).sort() : undefined);
