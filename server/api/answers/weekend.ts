// Search's direct answers for this weekend (docs/weekend.md): a window's FTC events ("what FTC events are happening
// this weekend", "meets this weekend in New Jersey", "tomorrow") and a team's next match ("4215 next match"). Both are
// worked out by server/api/weekend.ts, the same reading the "This weekend" page and the team page show.
import type { SearchCard, SearchCardLine } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { eventClock, weekendEventLine, type NextMatchAnswer, type WeekendEvent } from "../../../src/shared/weekend.js";
import { oddsPct, seasonLabel } from "../../../src/shared/format.js";

/** A window's events as a direct answer: each event with its kind, place, dates and teams, linked to its page ("Live
 *  now" while it's under way there), and the recordings on record. None: said plainly, never an empty list. */
export function eventsStat(o: { title: string; label: string; season: number; region: string | null; events: WeekendEvent[]; none: string; page?: { title: string; href: string } }): StatAnswer {
  const recorded = o.events.filter((e) => e.recording);
  const live = o.events.filter((e) => e.status === "live").length;
  return {
    family: "event", intent: "weekend-events", title: o.title, scope: [seasonLabel(o.season), o.label, ...(o.region ? [o.region] : [])],
    ...(o.events.length ? { headline: { value: `${o.events.length} event${o.events.length === 1 ? "" : "s"}`, label: o.label, ...(live ? { sub: `${live} live now` } : {}) } } : {}),
    blocks: [
      ...(o.events.length ? [{ kind: "links" as const, title: "Events", items: o.events.map((e) => ({ label: e.name, sub: weekendEventLine(e), href: e.href })) }] : []),
      ...(recorded.length ? [{ kind: "links" as const, title: "Recordings", items: recorded.map((e) => ({ label: e.name, sub: e.dates ?? undefined, href: e.recording! })) }] : []),
      ...(o.page ? [{ kind: "links" as const, title: "More", items: [{ label: o.page.title, href: o.page.href }] }] : []),
    ],
    ...(o.events.length ? {} : { none: o.none }),
    definition: `FTC events of the ${seasonLabel(o.season)} season with a day in the window, each read on its own calendar (its time zone), so an event under way where it is counts. Volunteer sign-ups aren't events.`,
    source: "From FIRST's event list",
  };
}

/** A team's next match as the search card shows it: the match (event, time on the event's clock, alliance, partners,
 *  opponents, the call), or what the team has instead, with the event linked. */
export function nextMatchCard(a: NextMatchAnswer, card: SearchCard): SearchCard {
  const names = (ts: { number: number }[]) => ts.map((t) => t.number).join(" + ") || "—";
  const line = (m: NonNullable<NextMatchAnswer["match"]>): SearchCardLine => ({
    text: `${m.label} at ${m.event}`,
    detail: [
      m.played ? (m.score ? `${m.score.result === "W" ? "Won" : m.score.result === "L" ? "Lost" : "Tied"} ${m.score.own}–${m.score.opp}` : "Played") : eventClock(m.startsAt, m.timezone) || "time not posted yet",
      `${m.alliance === "red" ? "Red" : "Blue"}${m.partners.length ? ` with ${names(m.partners)}` : ""}`,
      `vs ${names(m.opponents)}`,
      m.prediction ? `${oddsPct(m.prediction.chance)} to win (${m.prediction.tier} confidence)` : null,
      m.video ? "video" : null,
    ].filter(Boolean).join(" · "),
    href: m.href,
  });
  if (a.kind === "match" && a.match) return { ...card, lines: [line(a.match), ...a.played.map(line)] };
  return {
    ...card, lines: a.played.map(line), none: a.line,
    ...(a.event ? { closest: [{ text: a.event.name, detail: [a.event.dates, a.event.place].filter(Boolean).join(" · "), href: a.event.href }] } : {}),
  };
}
