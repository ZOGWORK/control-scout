// Control Scout Lite's other pages (docs/lite.md): Home, Search, Predict, Compare, Rankings, Scouting and Settings.
// Each draws the answer its API route sends (server/lite/routes.ts calls the same functions), with the layout
// primitives in ./render.ts. Pure: data in, HTML out, so a test can hold each page to its API's numbers.
import { dateRange, int, num, oddsPct, place, rankPct, seasonLabel } from "../../src/shared/format.js";
import { TIER_WORD } from "../../src/shared/tierWords.js";
import { factorLabel } from "../../src/shared/factorLabel.js";
import { sharePct, sheetPull, type SheetFactor } from "../../src/shared/factorSheet.js";
import { hitHref } from "../../src/shared/search.js";
import { liteHref } from "../../src/shared/lite.js";
import { normalMatchKey } from "../../src/shared/matchReport.js";
import { regionLabel } from "../../src/shared/regions.js";
import { THEME_COOKIES, type TextSizeCookie, type ThemeCookie } from "../../src/shared/themeTokens.js";
import type { CompareView, EventListItem, MatchExplanationView, SearchAnswer, SearchCard, SearchHit } from "../../src/shared/api.js";
import type { StatAnswer, StatBlock } from "../../src/shared/searchStat.js";
import type { RankingsResponse } from "../../src/shared/rankings.js";
import { liteMatchRow } from "./trim.js";
import {
  button, card, cellLink, chips, esc, list, listRow, liteEventPath, liteMatchPath, liteTeamPath, matchList, note, offNote, section, stat, stats, table, title,
  type LitePage, type LiteView,
} from "./render.js";

// ── Links ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A site link as Lite opens it: its Lite twin when it has one (a match in an event's address opens the Lite match
 *  page), else the full page itself. Anchors are dropped (Lite pages have none). */
export function liteLink(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const noHash = href.split("#")[0];
  const q = noHash.indexOf("?");
  const path = q < 0 ? noHash : noHash.slice(0, q), search = q < 0 ? "" : noHash.slice(q);
  const ev = /^\/events\/(\d{4})\/([^/]+)\/?$/.exec(path);
  const key = ev ? normalMatchKey(new URLSearchParams(search).get("match") ?? "") : null;
  if (ev && key) return `/lite/events/${ev[1]}/${ev[2]}/match/${key}`;
  return liteHref(path, search) ?? noHash;
}

/** A Lite search for `q`. */
export const liteSearch = (q: string) => `/lite/search?q=${encodeURIComponent(q)}`;

/** A full page Lite sends someone to on purpose (scouting, the network settings): while Lite is on, asked for this
 *  once (?lite=0), or the server would bring them straight back here. */
export const fullOnce = (href: string, view: LiteView) => {
  if (!view.sticky) return href;
  const [base, hash] = href.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}lite=0${hash ? `#${hash}` : ""}`;
};

// ── Forms ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A text box (a number box: inputmode numeric, as tall as a tap target). */
const input = (name: string, label: string, value: string, opts: { numeric?: boolean; placeholder?: string; type?: string } = {}) =>
  `<label>${esc(label)}<input name="${name}" type="${opts.type ?? "text"}" value="${esc(value)}"${opts.numeric ? ` inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"` : ""}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""}></label>`;
const hidden = (name: string, value: string | number | null | undefined) => (value == null || value === "" ? "" : `<input type="hidden" name="${name}" value="${esc(value)}">`);
/** A plain GET form to a Lite page, its one button gold. */
const form = (action: string, fields: string, submit: string, cls = "card") =>
  `<form class="${cls}" action="${action}" method="get">${fields}<button class="btn p wide" type="submit">${esc(submit)}</button></form>`;

/** The search box: Home's one action, and the top of the search page. */
export const searchBox = (q = "", season: number | null = null) =>
  `<form class="srch" action="/lite/search" method="get" role="search">${input("q", "Search teams, events and questions", q, { type: "search", placeholder: "4215, Hypnotic, NJ events" })}${hidden("in", season)}`
  + `<button class="btn p" type="submit">Search</button></form>`;

// ── Home ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Events on now or starting by `to`, as the Home page's calendar orders them (on now first, then by start). */
export function calendar(events: EventListItem[]): EventListItem[] {
  const order = { live: 0, upcoming: 1, finished: 2 } as const;
  return events.filter((e) => e.status !== "finished")
    .sort((a, b) => order[a.status] - order[b.status] || (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name));
}
export const HOME_EVENTS = 8;

export function homePage(season: number, events: EventListItem[], to: string): LitePage {
  const shown = calendar(events);
  const rows = shown.slice(0, HOME_EVENTS).map((e) => listRow(liteEventPath(e.season, e.code),
    `<span><b>${esc(e.name)}</b><small>${esc([dateRange(e.start, e.end), place(e.city, e.state, e.country)].filter(Boolean).join(" · "))}</small></span>`
    + `<span class="res${e.status === "live" ? " ok" : " m"}">${e.status === "live" ? "On now" : "Soon"}</span>`, true));
  const more = (shown.length > HOME_EVENTS ? note(`${shown.length - HOME_EVENTS} more this week.`) : "") + `<p class="sec">${button("/events", "All events (full version)")}</p>`;
  const body = title("Control Scout Lite", "FTC teams, events, predictions and search, for a weak signal.")
    + `<div class="sec">${searchBox()}</div>`
    + section("On the calendar", list(rows, `No ${seasonLabel(season)} events on now or starting by ${to}.`) + more)
    + section("More", chips([
      { href: "/lite/predict", text: "Predict a match" }, { href: "/lite/compare", text: "Compare teams" }, { href: "/lite/rankings", text: "Rankings" },
      { href: "/lite/scout", text: "Scouting" }, { href: "/lite/settings", text: "Settings" },
    ]));
  return { title: "Home", full: "/", body };
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────────────────────

/** At most this many rows of any one list or table in an answer (the full page has the rest). */
export const SEARCH_ROWS = 15;
const more = (n: number, of: number) => (of > n ? note(`${of - n} more on the full version.`) : "");

function hitRow(h: SearchHit): string {
  const t = h.team;
  const right = t?.opr != null ? `<span class="res"><b>${esc(num(t.opr))}</b><small>OPR ${esc(seasonLabel(t.season))}</small></span>`
    : h.event ? `<span class="res m">${h.event.status === "live" ? "On now" : h.event.status === "upcoming" ? "Upcoming" : ""}</span>` : "";
  return listRow(liteLink(hitHref(h)), `<span><b>${esc(h.title)}</b><small>${esc(h.subtitle)}</small>`
    + (h.facts?.length ? `<small>${h.facts.map((f) => `${esc(f.label)}: ${esc(f.value)}`).join(" · ")}</small>` : "") + `</span>${right}`, true);
}

/** A link cell: Lite's twin of the link, or the text alone. */
const linkCell = (text: string, href?: string) => (href ? cellLink(liteLink(href), esc(text)) : esc(text));

function statBlock(b: StatBlock): string {
  switch (b.kind) {
    case "kpis": return stats(b.items.map((i) => stat(i.value, [i.label, i.sub].filter(Boolean).join(" · "))));
    case "record": return stats([stat(`${b.wins}-${b.losses}-${b.ties}`, b.title ?? "record (W-L-T)")]);
    case "matches": return section(esc(b.title), table(`<th>Match</th><th class="n">Score</th>`, b.rows.slice(0, SEARCH_ROWS).map((r) =>
      `<tr><td>${cellLink(liteLink(r.href), esc(r.label), esc([r.event.label, r.season, r.note].filter(Boolean).join(" · ")))}</td>`
      + `<td class="n"><span class="${r.alliance === "red" ? "r" : "b"}${r.own > r.opp ? " w" : ""}">${r.own}</span>–${r.opp}</td></tr>`), "No matches.") + more(SEARCH_ROWS, b.rows.length));
    case "videos": return section(esc(b.title), card(`<p class="m">Videos need the full version and a good signal.</p>`));
    case "table": return section(esc(b.title), table(b.columns.map((c) => `<th${c.num ? ` class="n"` : ""}>${esc(c.label)}</th>`).join(""),
      b.rows.slice(0, SEARCH_ROWS).map((r) => `<tr>${b.columns.map((c, i) => `<td${c.num ? ` class="n"` : ""}>${i === 0 ? linkCell(String(r.cells[c.key] ?? "—"), r.href) : esc(r.cells[c.key] ?? "—")}</td>`).join("")}</tr>`), "Nothing listed.")
      + more(SEARCH_ROWS, b.rows.length));
    case "series": return section(esc(b.title), table(`<th></th><th class="n">${esc(b.unit ?? "Value")}</th>`,
      b.points.slice(-SEARCH_ROWS).map((p) => `<tr><td>${linkCell(p.x, p.href)}</td><td class="n">${esc(num(p.y))}</td></tr>`), ""));
    case "bars": return section(esc(b.title), table(`<th></th><th></th><th class="n">${esc(b.unit ?? "")}</th>`,
      b.groups.flatMap((g) => g.items.map((i, k) => `<tr><td>${k ? "" : esc(g.label)}</td><td>${esc(i.label)}</td><td class="n">${esc(num(i.value))}</td></tr>`)), ""));
    case "leaderboard": return section(esc(b.title), table(`<th class="n">#</th><th>Team</th><th class="n">${esc(b.stat.label)}</th>`,
      b.rows.slice(0, SEARCH_ROWS).map((r) => `<tr><td class="n">${r.rank}</td><td>${cellLink(liteLink(r.team.href), esc(r.team.label), esc([r.location, r.record].filter(Boolean).join(" · ")))}</td><td class="n">${esc(r.display)}</td></tr>`), "")
      + note(esc(b.note)) + more(SEARCH_ROWS, b.rows.length));
    case "compare": return section(esc(b.title), table(`<th></th>${b.teams.map((t) => `<th class="n">${cellLink(liteLink(t.href), esc(t.label))}</th>`).join("")}`,
      b.rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.values.map((v, i) => `<td class="n${r.best === i ? " w" : ""}">${esc(v)}</td>`).join("")}</tr>`), ""));
    case "league": return section(esc(b.title), table(`<th class="n">#</th><th>Team</th><th class="n">W-L-T</th><th class="n">RS</th>`,
      b.rows.slice(0, SEARCH_ROWS).map((r) => `<tr><td class="n">${r.rank}</td><td>${cellLink(liteTeamPath(r.team, b.season), String(r.team), esc(r.name ?? ""))}</td><td class="n">${r.wins ?? "—"}-${r.losses ?? "—"}-${r.ties ?? 0}</td><td class="n">${esc(num(r.rs, 2))}</td></tr>`), "")
      + more(SEARCH_ROWS, b.rows.length));
    case "links": return section(esc(b.title), b.items.length ? chips(b.items.map((i) => ({ href: liteLink(i.href), text: i.label }))) : card(`<p class="m">${esc(b.none ?? "None.")}</p>`));
    case "related": return section(esc(b.title), chips(b.queries.map((q) => ({ href: liteSearch(q), text: q }))));
    case "chance": return section(esc(b.label), stats([stat(b.decided ? `${Math.round(b.p * 100)}%` : oddsPct(b.p), b.who)])
      + (b.note ? note(esc(b.note)) : "") + (b.action ? `<p class="sec">${button(liteLink(b.action.href), b.action.label)}</p>` : ""));
    default: return "";
  }
}

function statAnswer(s: StatAnswer): string {
  const head = s.headline ? stats([stat(s.headline.value, [s.headline.label, s.headline.sub].filter(Boolean).join(" · "))]) : "";
  return section(esc(s.heading ?? s.title), (s.scope.length ? `<p class="m s">${esc(s.scope.join(" · "))}</p>` : "") + head
    + (s.none ? card(`<p>${esc(s.none)}</p>`) : "") + s.blocks.map(statBlock).join("")
    + note(esc([s.definition, s.source].filter(Boolean).join(" ")))
    + (s.more ? `<p class="sec">${button(liteLink(s.more.href), s.more.label)}</p>` : ""));
}

function searchCard(c: SearchCard): string {
  const lines = c.lines.slice(0, SEARCH_ROWS).map((l) => {
    const text = `${l.tag ? `<small>${esc(l.tag)}</small>` : ""}<b>${esc(l.text)}</b>${l.detail ? `<small>${esc(l.detail)}</small>` : ""}${l.results?.length ? `<small>${esc(l.results.join(" · "))}</small>` : ""}`;
    return l.href ? listRow(liteLink(l.href), `<span>${text}</span>`, true) : `<div class="row one"><span>${text}</span></div>`;
  });
  const facts = [...(c.facts ?? []), ...(c.support ?? [])];
  return section(esc(c.title), (c.headline ? `<p class="w">${esc(c.headline)}</p>` : "")
    + (c.none ? card(`<p>${esc(c.none)}</p>`) : "")
    + (lines.length ? `<div class="list">${lines.join("")}</div>` + more(SEARCH_ROWS, c.lines.length) : "")
    + (facts.length ? `<div class="sec">${table(`<th></th><th></th>`, facts.map((f) => `<tr><td class="m">${esc(f.label)}</td><td>${esc(f.values.join(", ") || "—")}${f.detail ? ` <span class="m s">${esc(f.detail)}</span>` : ""}</td></tr>`), "")}</div>` : "")
    + (c.note ? note(esc(c.note)) : "")
    + (c.related?.length ? `<div class="sec">${chips(c.related.map((q) => ({ href: liteSearch(q), text: q })))}</div>` : ""));
}

/** The search page: the server's own answer for `q` (the one /api/search?answer=1 sends), as cards and lists. */
export function searchPage(q: string, season: number | null, a: SearchAnswer | null): LitePage {
  const query = q.trim();
  const full = `/search${query ? `?q=${encodeURIComponent(query)}${season ? `&in=${season}` : ""}` : ""}`;
  let body = title(query ? `Search: ${esc(query)}` : "Search") + `<div class="sec">${searchBox(query, season)}</div>`;
  if (!a || !query) {
    body += section("Try", chips(["4215", "NJ events this week", "highest score"].map((x) => ({ href: liteSearch(x), text: x }))))
      + note("A team number or name, an event, a place, or a question about them.");
    return { title: "Search", full, body };
  }
  if (a.understood?.label) body += `<p class="sub">${esc(a.understood.label)}</p>`;
  if (a.didYouMean) body += `<div class="sec">${chips([{ href: liteSearch(a.didYouMean), text: `Did you mean: ${a.didYouMean}` }])}</div>`;
  if (a.verdict) body += `<div class="sec">${stats([stat(a.verdict.answer, a.verdict.label)])}</div>`;
  if (a.sorry) body += section("Search can't answer that yet", card(`<p>Read as: ${esc(a.sorry.understood.join(" · "))}</p>`)
    + (a.sorry.suggest.length ? `<div class="sec">${chips(a.sorry.suggest.map((x) => ({ href: liteSearch(x), text: x })))}</div>` : ""));
  if (a.stat) body += statAnswer(a.stat);
  if (a.card) body += searchCard(a.card);
  if (a.intent && !a.intent.met && a.intent.gap) body += note(esc(a.intent.gap));
  const hits = a.hits.slice(0, SEARCH_ROWS);
  if (hits.length) body += section(a.stat || a.card ? "Results" : "Top results", list(hits.map(hitRow), "") + more(SEARCH_ROWS, a.hits.length));
  if (a.suggest?.length) body += section("Ask about it", chips(a.suggest.map((x) => ({ href: liteSearch(x), text: x }))));
  if (a.recovery) {
    const r = a.recovery;
    body += section("Nothing matched", card(`<p>${esc(r.understood.length ? `Read as: ${r.understood.join(" · ")}` : `No match for "${query}".`)}</p>`)
      + (r.closest.length ? `<div class="sec">${list(r.closest.slice(0, SEARCH_ROWS).map(hitRow), "")}</div>` : "")
      + (r.browse.length ? `<div class="sec">${chips(r.browse.map((p) => ({ href: liteLink(p.href), text: p.title })))}</div>` : ""));
  } else if (!hits.length && !a.stat && !a.card && !a.sorry && !a.verdict && !a.pages.length) {
    // (A search that names a page, "rankings", answers with that page alone: not "nothing matched".)
    body += section("Nothing matched", card(`<p>No match for "${esc(query)}". Try a team number, or fewer words.</p>`));
  }
  if (a.pages.length) body += section("Pages", chips(a.pages.map((p) => ({ href: liteLink(p.href), text: p.title }))));
  return { title: `Search: ${query}`, full, body };
}

// ── Predict ────────────────────────────────────────────────────────────────────────────────────────────────

const sideTeams = (v: string[]) => [v[0] ?? "", v[1] ?? ""];

function whyTable(rows: SheetFactor[], heading: string): string[] {
  if (!rows.length) return [];
  return [`<tr><th colspan="3">${esc(heading)}</th></tr>`, ...rows.map((f) => {
    const side = f.favors === "A" ? `<span class="r">Red</span>` : f.favors === "B" ? `<span class="b">Blue</span>` : `<span class="m">Even</span>`;
    return `<tr><td><b>${esc(f.name)}</b><br><span class="m s">${esc(factorLabel(f.label))}</span></td><td>${side}</td><td class="n">${esc(sharePct(f.weight))}</td></tr>`;
  })];
}

export interface PredictInput { season: number; red: string[]; blue: string[]; seasonAsked: boolean }

/** The Predict page: the matchup form, and when both sides are given, the same answer /api/predict/match sends. */
export function predictPage(i: PredictInput, x: MatchExplanationView | null, problem: string | null): LitePage {
  const [r1, r2] = sideTeams(i.red), [b1, b2] = sideTeams(i.blue);
  const fields = `<div class="pair">${input("red", "Red team 1", r1, { numeric: true })}${input("red", "Red team 2", r2, { numeric: true })}</div>`
    + `<div class="pair">${input("blue", "Blue team 1", b1, { numeric: true })}${input("blue", "Blue team 2", b2, { numeric: true })}</div>`
    + (i.seasonAsked ? hidden("season", i.season) : "");
  const params = new URLSearchParams();
  if (i.seasonAsked) params.set("season", String(i.season));
  if (i.red.length) params.set("red", i.red.join(","));
  if (i.blue.length) params.set("blue", i.blue.join(","));
  const fullQ = i.red.length || i.blue.length ? `?mode=match&${params.toString().replace(/%2C/g, ",")}` : "";
  let body = title("Predict a match", `${esc(seasonLabel(i.season))} · one or two teams a side`)
    + `<div class="sec">${form("/lite/predict", fields, x ? "Predict again" : "Predict")}</div>`;
  if (problem) body += `<div class="sec">${card(`<p>${esc(problem)}</p>`)}</div>`;
  if (x) {
    const lvl = x.rangeLevel ? `${Math.round(x.rangeLevel * 100)}% range` : "likely range";
    body += section("The call", stats([stat(oddsPct(x.winProbRed), `Red wins · ${x.red.join(" + ")}`, "r"), stat(oddsPct(x.winProbBlue), `Blue wins · ${x.blue.join(" + ")}`, "b"),
      stat(`${Math.round(x.predictedRed)}–${Math.round(x.predictedBlue)}`, "predicted score")])
      + card(`<p>Confidence: <b>${esc((TIER_WORD[x.confidence.tier] ?? x.confidence.tier).toLowerCase())}</b>. ${esc(x.confidence.reason)}</p>`
        + `<p class="m s">${esc(lvl)}: red ${x.rangeRed[0]}–${x.rangeRed[1]}, blue ${x.rangeBlue[0]}–${x.rangeBlue[1]}</p>`));
    if (x.factors.length || x.reasons?.length) {
      body += section("Why", card(`<ul class="why">${x.factors.slice(0, 3).map((f) => `<li>${esc(factorLabel(f.label))}</li>`).join("")}${(x.reasons ?? []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`));
    }
    const s = x.factorSheet;
    if (s) {
      const pull = sheetPull(s);
      body += section("Full why breakdown", (pull ? `<p><span class="r w">${esc(sharePct(pull.red))}</span> pulls for red · <span class="b w">${esc(sharePct(pull.blue))}</span> pulls for blue</p>` : "")
        + `<div class="sec">${table(`<th>Factor</th><th>Helps</th><th class="n">Share</th>`, [
          ...whyTable(s.phases, "Game phases"), ...whyTable(s.model, "What else the win model weighs"), ...whyTable(s.reasons, "Reasons that don't move the odds"),
        ], "")}</div>` + note("Each share is how much of the call that factor carries; the shares add up to 100%."));
    }
    const team = (t: MatchExplanationView["teamsRed"][number], cls: string) =>
      `<tr><td>${cellLink(liteTeamPath(t.team, x.season), `<span class="${cls}">${t.team}</span>`, esc(t.name ?? ""))}</td><td class="n">${esc(num(t.np))}</td><td class="n">${esc(num(t.sd, 0))}</td><td class="n">${t.matches}</td></tr>`;
    body += section("Teams", table(`<th>Team</th><th class="n">Points</th><th class="n">±</th><th class="n">Matches</th>`,
      [...x.teamsRed.map((t) => team(t, "r")), ...x.teamsBlue.map((t) => team(t, "b"))], "")
      + note("Points: what each robot is expected to add to its alliance's score, without penalties. ±: how unsure that is."))
      + `<div class="sec">${chips([{ href: `/lite/compare?teams=${[...x.red, ...x.blue].join(",")}&season=${x.season}`, text: "Compare these teams" }])}</div>`;
  }
  return { title: x ? `Predict ${x.red.join(" + ")} vs ${x.blue.join(" + ")}` : "Predict", full: `/predict${fullQ}`, body };
}

// ── Compare ────────────────────────────────────────────────────────────────────────────────────────────────

/** A bar of text, `value` of `max` in `width` blocks (a chart without a chart). */
export function textBar(value: number | null, max: number, width = 10): string {
  if (value == null || !(max > 0)) return "";
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return `${"█".repeat(n)}${"░".repeat(width - n)}`;
}

export const COMPARE_MEETINGS = 20;

export function comparePage(teams: string[], season: number | null, v: CompareView | null): LitePage {
  const boxes = [0, 1, 2, 3].map((k) => input("teams", `Team ${k + 1}`, teams[k] ?? "", { numeric: true }));
  const fields = `<div class="pair">${boxes[0]}${boxes[1]}</div><div class="pair">${boxes[2]}${boxes[3]}</div>` + hidden("season", season);
  const fullQ = teams.length ? `?teams=${teams.join(",")}${season ? `&season=${season}` : ""}` : "";
  let body = title("Compare teams", v ? `${esc(seasonLabel(v.season))} season` : "Up to four teams side by side")
    + `<div class="sec">${form("/lite/compare", fields, v ? "Compare again" : "Compare")}</div>`;
  if (v && v.teams.length) {
    const t = v.teams;
    const head = `<th></th>${t.map((x) => `<th class="n">${cellLink(liteTeamPath(x.team.number, v.season), String(x.team.number))}</th>`).join("")}`;
    const row = (label: string, cell: (x: (typeof t)[number]) => string) => `<tr><td>${label}</td>${t.map((x) => `<td class="n">${cell(x)}</td>`).join("")}</tr>`;
    const s = (x: (typeof t)[number]) => x.stats;
    body += section("Side by side", table(head, [
      row("Name", (x) => `<span class="s">${esc(x.team.name ?? "—")}</span>`),
      row("OPR", (x) => `<b>${esc(num(s(x)?.opr.np.value))}</b>${s(x)?.opr.np.rank != null ? `<br><span class="m s">${esc(rankPct(s(x)!.opr.np.rank, s(x)!.opr.np.of) ?? "")}</span>` : ""}`),
      row("Auto", (x) => esc(num(s(x)?.opr.auto.value))),
      row("TeleOp", (x) => esc(num(s(x)?.opr.teleop.value))),
      row("Endgame", (x) => esc(num(s(x)?.opr.endgame.value))),
      row("Rating", (x) => (s(x)?.rating ? `${esc(num(s(x)!.rating!.np))}${s(x)!.rating!.sd != null ? ` <span class="m s">±${esc(num(s(x)!.rating!.sd, 0))}</span>` : ""}${s(x)!.rating!.rank ? `<br><span class="m s">#${esc(int(s(x)!.rating!.rank))}</span>` : ""}` : "—")),
      row("Record", (x) => (s(x) ? `${s(x)!.record.wins}-${s(x)!.record.losses}-${s(x)!.record.ties}` : "—")),
      row("Events", (x) => (s(x) ? String(s(x)!.record.events) : "—")),
    ], "") + note("OPR: points a robot adds to its alliance's score, without penalties, from its best event. Rating: the prediction engine's estimate."));
    const max = Math.max(0, ...t.map((x) => s(x)?.opr.np.value ?? 0));
    if (max > 0) body += section("OPR", `<div class="tbl"><table><tbody>${t.map((x) => `<tr><td>${cellLink(liteTeamPath(x.team.number, v.season), String(x.team.number))}</td>`
      + `<td><span class="bar" aria-hidden="true">${textBar(s(x)?.opr.np.value ?? null, max)}</span></td><td class="n">${esc(num(s(x)?.opr.np.value))}</td></tr>`).join("")}</tbody></table></div>`);
    const meet = (rel: "opponents" | "partners") => v.meetings.filter((m) => m.relation === rel);
    for (const [rel, heading] of [["opponents", "Against each other"], ["partners", "As partners"]] as const) {
      const ms = meet(rel);
      if (!ms.length) continue;
      const rows = ms.slice(0, COMPARE_MEETINGS).map((m) => ({ ...liteMatchRow(m), code: m.code }));
      body += section(heading, matchList(rows, v.season, null, "", true) + offNote(rows) + more(COMPARE_MEETINGS, ms.length));
    }
    if (t.length > 1 && !v.meetings.length) body += section("Head to head", card(`<p class="m">These teams haven't played together or against each other in ${esc(seasonLabel(v.season))}.</p>`));
    // Two teams (one a side) or four (two a side): Predict takes the same number each side.
    if (t.length === 2 || t.length === 4) {
      const half = Math.ceil(t.length / 2), red = t.slice(0, half).map((x) => x.team.number), blue = t.slice(half).map((x) => x.team.number);
      body += `<div class="sec">${chips([{ href: `/lite/predict?season=${v.season}&red=${red.join(",")}&blue=${blue.join(",")}`, text: `Predict ${red.join(" + ")} vs ${blue.join(" + ")}` }])}</div>`;
    }
  }
  return { title: v?.teams.length ? `Compare ${v.teams.map((x) => x.team.number).join(" vs ")}` : "Compare", full: `/compare${fullQ}`, body };
}

// ── Rankings ───────────────────────────────────────────────────────────────────────────────────────────────

const moveText = (m: RankingsResponse["rows"][number]["move"]) => (m === "new" ? "new" : m == null || m === 0 ? "—" : m > 0 ? `▲${m}` : `▼${-m}`);
const placeName = (key: string) => (key.includes(":") ? regionLabel(key) || key : key);

export function rankingsPage(r: RankingsResponse): LitePage {
  const q = (page: number) => {
    const p = new URLSearchParams();
    p.set("season", String(r.season));
    if (r.places.length) p.set("region", r.places.join(","));
    if (page > 1) p.set("page", String(page));
    return p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
  };
  const rows = r.rows.map((x) => `<tr><td class="n">${x.rank}</td><td>${cellLink(liteTeamPath(x.team, r.season), String(x.team), esc([x.name, place(null, x.state, x.country)].filter(Boolean).join(" · ")))}</td>`
    + `<td class="n">${esc(x.rating.toFixed(1))}</td><td class="n${typeof x.move === "number" && x.move > 0 ? " ok" : ""}">${esc(moveText(x.move))}</td></tr>`);
  const where = r.places.length ? r.places.map(placeName).join(", ") : "the world";
  const body = title("Rankings", `${esc(seasonLabel(r.season))} · ${int(r.total)} rated teams in ${esc(where)}`)
    + (r.places.length ? `<div class="sec">${chips([{ href: `/lite/rankings?season=${r.season}`, text: "Show the whole world" }])}</div>` : "")
    + `<div class="sec">${table(`<th class="n">#</th><th>Team</th><th class="n">Rating</th><th class="n" title="Places moved since last week">Move</th>`, rows, "No rated teams yet this season.")}</div>`
    + note("Rating: the prediction engine's estimate of the points a robot adds to its alliance, without penalties. Move: places since last week.")
    + `<div class="nav">${r.page > 1 ? button(`/lite/rankings?${q(r.page - 1)}`, "← Previous") : "<span></span>"}<span class="m s">Page ${r.page} of ${r.pages}</span>`
    + `${r.page < r.pages ? button(`/lite/rankings?${q(r.page + 1)}`, "Next page →", true) : "<span></span>"}</div>`;
  return { title: `Rankings ${seasonLabel(r.season)}`, full: `/rankings?${q(r.page)}`, body };
}

// ── Scouting ───────────────────────────────────────────────────────────────────────────────────────────────

export function scoutPage(full: string, view: LiteView, signedIn: boolean): LitePage {
  const body = title("Scouting", "Match and pit scouting for your team")
    + `<div class="sec">${card(`<p>Scouting needs the full app: its forms run on your phone, save without a signal, and send when you're back online. Lite pages can't run forms.</p>`
      + `<p>${button(fullOnce(full, view), "Open scouting (full app)", true)}</p>`)}</div>`
    + (signedIn ? section("Your pick list", card(`<p>Read your workspace's pick list here, light and read-only.</p><p>${button("/lite/picklist", "Pick list")}</p>`))
      : note("Signed in on the full version? Your workspace's pick list then opens here too, read-only."));
  return { title: "Scouting", full, body };
}

// ── Settings ───────────────────────────────────────────────────────────────────────────────────────────────

const THEME_NAMES: Record<ThemeCookie, string> = { light: "Light", dim: "Dim", dark: "Dark", midnight: "Midnight", system: "System" };
export const TEXT_SIZE_NAMES: [TextSizeCookie | "m", string][] = [["s", "Smaller"], ["m", "Default"], ["l", "Larger"], ["xl", "Largest"]];

/** A setting's choices: links that set it (a cookie) and come back here; the current one gold. */
const choices = (items: { href: string; text: string; cur: boolean }[]) =>
  `<ul class="chips">${items.map((x) => `<li><a class="chip${x.cur ? " cur" : ""}" href="${esc(x.href)}"${x.cur ? ` aria-current="true"` : ""}>${esc(x.text)}</a></li>`).join("")}</ul>`;

export function settingsPage(view: LiteView): LitePage {
  const back = encodeURIComponent("/lite/settings");
  const body = title("Settings", "The same settings as the full version, on this device.")
    + section("Theme", choices(THEME_COOKIES.map((t) => ({ href: `/lite/theme?set=${t}&next=${back}`, text: THEME_NAMES[t], cur: view.theme === t })))
      + note("System follows your phone's light or dark mode."))
    + section("Text size", choices(TEXT_SIZE_NAMES.map(([k, name]) => ({ href: `/lite/size?set=${k}&next=${back}`, text: name, cur: (view.textSize ?? "m") === k }))))
    + section("Control Scout Lite", card(view.sticky
      ? `<p>Lite is on: pages with a Lite version open in Lite, on this device, until you turn it off.</p><p>${button(`/lite/off?next=${encodeURIComponent("/settings")}`, "Turn off Lite")}</p>`
      : `<p>Lite is off: Lite pages open only when you ask for them. Turn it on to open them every time on this device.</p><p>${button(`/lite/on?next=${back}`, "Always open Lite")}</p>`))
    + section("Network and offline", card(`<p>Your connection, downloaded event packs and how much data they use are in the full version's settings.</p>`
      + `<p>${button(fullOnce("/settings#network", view), "Network & offline settings")}</p>`));
  return { title: "Settings", full: "/settings", body };
}
