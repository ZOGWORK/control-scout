// "When is <event>" (search audit, "when/where asks"): "when is the new jersey championship", "when is worlds". An
// answer that lists an event's editions, one a season, leads with the date of the one the question means: the edition
// on now or next, else the most recent; the other seasons' under it. Read from the answer's own event rows: nothing
// here names an event, a place or a season.
import type { SearchAnswer, SearchCard, SearchHit } from "../../../src/shared/api.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { askOf } from "../../../src/shared/query/whenWhere.js";

type Edition = SearchHit & { event: NonNullable<SearchHit["event"]> & { start: string } };

/** Where an edition was held, as its row says it: its venue and its town ("Kean University, Union, NJ, USA"). */
const whereOf = (h: Edition) => [h.event.venue, h.subtitle.split(" · ").pop()].filter((x) => x && !/^\d{4}-\d\d-\d\d$/.test(x)).join(", ");
/** An edition's link: its event page. */
const hrefOf = (h: Edition) => { const [season, code] = h.ref.split(":"); return `/events/${season}/${encodeURIComponent(code)}`; };
/** An edition's event code, from its ref ("2025:USNJCMP"): the same in every season the event is held. */
const codeOf = (h: Edition) => h.ref.split(":")[1];
/** An edition's season, from its ref ("2025:USNJCMP"). */
const seasonOf = (h: Edition) => Number(h.ref.split(":")[0]);

/** The edition a "when is" question means: the one on or still to come that starts first, else the one that started
 *  last. `today`: YYYY-MM-DD. */
export function editionFor(editions: Edition[], today: string): Edition {
  const ahead = editions.filter((h) => (h.event.end ?? h.event.start) >= today).sort((a, b) => a.event.start.localeCompare(b.event.start));
  return ahead[0] ?? [...editions].sort((a, b) => b.event.start.localeCompare(a.event.start))[0];
}

/** `a` with the date of the edition asked about leading, for "when …" asked of an event's editions (`raw`: the query
 *  as typed); else `a` as it is. Editions: the answer's event rows, divisions left out, each of its own season, at
 *  least one with dates; an answer of a card or a stat already answers on its own. */
export function whenEventAnswer(raw: string, a: SearchAnswer, now: number): SearchAnswer {
  if (askOf(raw) !== "when" || a.stat || a.card || a.step !== "deterministic") return a;
  const editions = a.hits.filter((h): h is Edition => h.kind === "event" && !h.parent && !!h.event?.start);
  // One event's editions, one a season: its code the same each season (its name may change), a set of different
  // events ("when are the meets in <place>"), even one a season, is a list.
  if (!editions.length || new Set(editions.map(seasonOf)).size !== editions.length || new Set(editions.map(codeOf)).size !== 1) return a;
  const today = new Date(now).toISOString().slice(0, 10);
  const lead = editionFor(editions, today);
  const on = lead.event.start <= today && (lead.event.end ?? lead.event.start) >= today;
  const when = dateRange(lead.event.start, lead.event.end);
  const said = on ? "on now" : lead.event.start > today ? "upcoming" : "the most recent";
  // The place asked, said when the event's own name doesn't ("when is the <state> championship": "Chesapeake
  // Championship (Virginia)").
  const place = a.understood?.place?.name;
  const name = place && !lead.title.toLowerCase().includes(place.toLowerCase()) ? `${lead.title} (${place})` : lead.title;
  const others = editions.filter((h) => h !== lead).sort((x, y) => y.event.start.localeCompare(x.event.start));
  const card: SearchCard = {
    kind: "info", title: `When: ${name}`,
    headline: `${when} · ${seasonLabel(seasonOf(lead))}, ${said}${whereOf(lead) ? ` · ${whereOf(lead)}` : ""}`,
    lines: [
      { text: when, detail: [seasonLabel(seasonOf(lead)), whereOf(lead)].filter(Boolean).join(" · "), href: hrefOf(lead), ...(lead.game ? { game: lead.game } : {}), tag: said.replace(/^./, (c) => c.toUpperCase()) },
      ...others.map((h) => ({ text: dateRange(h.event.start, h.event.end), detail: [seasonLabel(seasonOf(h)), whereOf(h)].filter(Boolean).join(" · "), href: hrefOf(h), ...(h.game ? { game: h.game } : {}) })),
    ],
  };
  return { ...a, card, understood: { ...(a.understood ?? { kind: "events" }), label: `When: ${name}, ${when} (${said})${others.length ? `; ${others.length} other season${others.length === 1 ? "" : "s"} below` : ""}` } };
}
