// Control Scout Lite pages (docs/lite.md): plain HTML for one bar of signal. No images, no charts (tables instead),
// no scripts, system fonts, one small inline stylesheet. Numbers, dates and odds go through the same helpers as the
// rich pages (src/shared/format.ts), so the two versions of a page always read the same.
//
// Layout primitives (documented in docs/lite.md, reused by every Lite page): header, stickyNote, section, card,
// table + cellLink, list + listRow, stats + stat, button, chips. Every link is one of them, and each one is at least
// 44px tall (LITE_TAP_CLASSES; lite.test.ts holds the stylesheet to it).
import { awardLabel, dateRange, int, matchTime, num, oddsPct, place, rankPct, seasonLabel } from "../../src/shared/format.js";
import { TIER_WORD } from "../../src/shared/tierWords.js";
import { THEME_TOKENS, type Palette, type TextSizeCookie, type ThemeCookie, type Token } from "../../src/shared/themeTokens.js";
import type { LiteCall, LiteEvent, LiteMatch, LiteMatchRow, LitePicks, LiteSide, LiteTeam } from "./trim.js";

export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Stylesheet ─────────────────────────────────────────────────────────────────────────────────────────────

const VAR: Record<Token, string> = { bg: "bg", fg: "fg", card: "card", muted: "mu", mutedFg: "mf", line: "line", acc: "acc", accText: "at", accInk: "ink", red: "red", blue: "blue", ok: "ok" };
const vars = (p: Palette) => (Object.keys(VAR) as Token[]).map((k) => `--${VAR[k]}:${THEME_TOKENS[p][k]}`).join(";");

/** The classes a link may carry; each is a tap target at least 44px tall. */
export const LITE_TAP_CLASSES = ["btn", "cell", "row", "chip"] as const;

// The app's five themes (src/shared/themeTokens.ts, the values of src/index.css): dark on :root, the others on
// html's class as in the app, System following the device. Text size as the app's (index.css): rem sizes, the root
// font 14px on phones and 16px wider, times this device's choice. Tap targets are in px, so they stay 44px at any size.
export const LITE_STYLE = `:root{color-scheme:dark;${vars("dark")}}`
  + `html.light{color-scheme:light;${vars("light")}}html.dim{${vars("dim")}}html.midnight{${vars("midnight")}}`
  + `html.sys{color-scheme:dark light}@media(prefers-color-scheme:light){html.sys{${vars("light")}}}`
  + `html{--b:1;--s:1;font-size:calc(100% * var(--b) * var(--s))}@media(max-width:767px){html{--b:.875}}`
  + `html[data-text-size=s]{--s:.9}html[data-text-size=l]{--s:1.125}html[data-text-size=xl]{--s:1.25}`
  + `*{box-sizing:border-box}.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`
  + `body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%;overflow-wrap:break-word}`
  + `.in{max-width:52rem;margin:0 auto;padding:0 16px}main.in{padding-bottom:24px}`
  + `.top{border-bottom:1px solid var(--line);background:var(--card)}.top .in{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px;padding-top:10px;padding-bottom:10px}`
  + `.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.0625rem;line-height:1.2}.brand svg{width:32px;height:32px;flex:none}.brand i{font-style:normal;color:var(--at)}`
  + `a{color:inherit}`
  + `.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:10px;background:var(--mu);color:var(--fg);font-weight:600;text-decoration:none;white-space:nowrap;text-align:center}`
  + `.btn.p{border-color:var(--acc);background:var(--acc);color:var(--ink)}button.btn{font:inherit;cursor:pointer}.btn.wide{width:100%}`
  // Forms (a plain GET to a Lite page: no script). Boxes as tall as a tap target, on the page colour inside a card.
  + `label{display:block;font-size:.875rem;font-weight:600}input{display:block;width:100%;min-height:44px;margin-top:6px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit;font-size:max(1rem,16px)}`
  + `input:focus,.btn:focus-visible,.chip:focus-visible,.cell:focus-visible,.row:focus-visible{outline:2px solid var(--acc);outline-offset:2px}`
  + `.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.srch{display:flex;gap:8px;align-items:flex-end}.srch label{flex:1;min-width:0}`
  + `.chip.cur{border-color:var(--acc);background:var(--acc);color:var(--ink)}.bar{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--at);white-space:nowrap}`
  + `.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}`
  + `.chip{display:inline-flex;align-items:center;min-height:44px;min-width:44px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--mu);color:var(--fg);font-weight:600;text-decoration:none;font-variant-numeric:tabular-nums}`
  + `.on{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-top:16px}.on p{margin:0;flex:1 1 14rem}`
  + `h1{margin:24px 0 4px;font-size:1.5rem;line-height:1.25}h2{margin:0 0 12px;font-size:1.125rem;line-height:1.3}`
  + `p{margin:0}.sub{margin-top:4px;color:var(--mf)}.note{margin-top:10px;font-size:.875rem;color:var(--mf)}.m{color:var(--mf)}.s{font-size:.8125rem}`
  + `.sec{margin-top:24px}.card{padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}.card>*+*{margin-top:10px}`
  + `.stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}@media(min-width:640px){.stats{grid-template-columns:repeat(3,minmax(0,1fr))}}`
  + `.stat{padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card)}.stat b{display:block;font-size:1.5rem;line-height:1.25;color:var(--at);font-variant-numeric:tabular-nums}.stat span{display:block;margin-top:2px;font-size:.8125rem;color:var(--mf)}.stat b.r{color:var(--red)}.stat b.b{color:var(--blue)}`
  + `.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--card)}`
  + `table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}`
  + `th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th:first-child,td:first-child{padding-left:16px}th:last-child,td:last-child{padding-right:16px}tbody tr:last-child td{border-bottom:0}th.n:first-child,td.n:first-child{width:1%}`
  + `th{font-size:.8125rem;font-weight:600;line-height:1.3;color:var(--mf)}`
  + `.cell{display:flex;flex-direction:column;justify-content:center;min-height:44px;margin:-10px -12px;padding:10px 12px;text-decoration:none}td:first-child>.cell{margin-left:-16px;padding-left:16px}`
  + `.cell b,.row b{color:var(--at)}.cell small,.row small{display:block;font-size:.8125rem;color:var(--mf);font-weight:400}`
  + `.n{text-align:right;white-space:nowrap}.r{color:var(--red)}.b{color:var(--blue)}.w{font-weight:700}.ok{color:var(--ok)}.d1 td:first-child{padding-left:32px;color:var(--mf)}`
  + `.list{border:1px solid var(--line);border-radius:12px;background:var(--card);overflow:hidden}`
  + `.row{display:grid;grid-template-columns:5.5rem minmax(0,1fr) auto;gap:4px 12px;align-items:center;min-height:56px;padding:10px 16px;border-top:1px solid var(--line);text-decoration:none;font-variant-numeric:tabular-nums}.list>.row:first-child{border-top:0}`
  + `.row.one{grid-template-columns:minmax(0,1fr) auto}.row>.res{text-align:right;white-space:nowrap}.row .ev{grid-column:1/-1;font-size:.8125rem;color:var(--mf)}`
  + `.back{margin-top:16px}.nav{display:flex;justify-content:space-between;gap:12px;margin-top:24px}`
  + `ul.why{margin:0;padding-left:20px}ul.why li+li{margin-top:6px}`
  + `footer{margin-top:40px;padding:24px 0 32px;border-top:1px solid var(--line);font-size:.875rem;color:var(--mf)}footer .in>*+*{margin-top:12px}`;

// The C-mark (public/mark.png, traced; on the app icon's black tile, as the app's top bar shows it).
const MARK = `<svg viewBox="0 0 256 256" aria-hidden="true"><rect width="256" height="256" rx="60" fill="#0a0a0b"/>`
  + `<path fill="#ffc700" transform="translate(32 32) scale(.75)" d="M185.5 45.3A110 110 0 1 0 222.8 166.2L173.8 135.1A55.6 55.6 0 1 1 137.2 80ZM248 16 160 83 201 127Z"/></svg>`;

// ── Document ───────────────────────────────────────────────────────────────────────────────────────────────

export interface LitePage {
  title: string;
  /** The rich page this one stands in for: the "Full version" link, and the canonical URL. */
  full: string;
  body: string;
}

export interface LiteView {
  /** The app's theme choice, from the cs-theme cookie (dark when absent). */
  theme: ThemeCookie;
  /** The app's text size, from cs-text-size (null: Default). */
  textSize: TextSizeCookie | null;
  /** Lite is on (the cs-lite cookie): pages with a Lite version open here until it's turned off. */
  sticky: boolean;
  /** This page's own address (path and query), for "Always open Lite". */
  here: string;
}
export const DEFAULT_VIEW: LiteView = { theme: "dark", textSize: null, sticky: false, here: "/lite" };

const THEME_COLOR: Record<Palette, string> = { dark: THEME_TOKENS.dark.bg, light: THEME_TOKENS.light.bg, dim: THEME_TOKENS.dim.bg, midnight: THEME_TOKENS.midnight.bg };

/** A link that is a button: `primary` is the page's one main action (gold). */
export const button = (href: string, text: string, primary = false, cls = "") =>
  `<a class="btn${primary ? " p" : ""}${cls ? ` ${cls}` : ""}" href="${esc(href)}">${esc(text)}</a>`;

/** "?a=b" + one more parameter. */
const withParam = (href: string, kv: string) => `${href}${href.includes("?") ? "&" : "?"}${kv}`;

/** The bar on every page: the C-mark and name, and the one way back to the full version. While Lite is on, that
 *  opens the full page this once (?lite=0: the server doesn't send it back here). */
export function header(full: string, view: LiteView): string {
  return `<header class="top"><div class="in"><div class="brand">${MARK}<span>Control Scout <i>Lite</i></span></div>`
    + button(view.sticky ? withParam(full, "lite=0") : full, "Full version", true, "full") + `</div></header>`;
}

/** While Lite is on: what that means, and the way to turn it off (back to this page's full version). */
export const stickyNote = (full: string) =>
  `<div class="on card"><p>Lite is on: pages with a Lite version open here until you turn it off.</p>${button(`/lite/off?next=${encodeURIComponent(full)}`, "Turn off Lite")}</div>`;

/** The whole document. `canonical`: the full page's absolute URL (search engines index that one, not this). */
export function liteDocument(p: LitePage, canonical: string | null, view: LiteView = DEFAULT_VIEW): string {
  const cls = view.theme === "system" ? "sys" : view.theme === "dark" ? "" : view.theme;
  const scheme = view.theme === "system" ? "dark light" : view.theme === "light" ? "light" : "dark";
  const color = view.theme === "system"
    ? `<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)">`
    : `<meta name="theme-color" content="${THEME_COLOR[view.theme]}">`;
  const keep = view.sticky ? ""
    : `<p>${button(`/lite/on?next=${encodeURIComponent(view.here)}`, "Always open Lite")}</p><p>Pages with a Lite version then open in Lite every time, until you turn it off.</p>`;
  return `<!doctype html><html lang="en"${cls ? ` class="${cls}"` : ""}${view.textSize ? ` data-text-size="${view.textSize}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(p.title)} · Control Scout Lite</title>${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}`
    + `<meta name="color-scheme" content="${scheme}">${color}<style>${LITE_STYLE}</style></head><body>`
    + header(p.full, view) + `<main class="in">${view.sticky ? stickyNote(p.full) : ""}${p.body}</main>`
    + `<footer><div class="in"><p>Control Scout Lite: text only, for a weak signal. The same data and predictions as the full version.</p>${keep}</div></footer></body></html>`;
}

// ── Primitives ─────────────────────────────────────────────────────────────────────────────────────────────

/** A titled block of the page, 24px from the one before. */
export const section = (title: string, inner: string, cls = "") => `<section class="sec"><h2${cls ? ` class="${cls}"` : ""}>${title}</h2>${inner}</section>`;
/** A padded box on the card colour. */
export const card = (inner: string) => `<div class="card">${inner}</div>`;
/** A small line of explanation under a block. */
export const note = (text: string) => `<p class="note">${text}</p>`;
/** A table in its card; `empty` when there are no rows. */
export const table = (head: string, rows: string[], empty: string) =>
  rows.length ? `<div class="tbl"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : card(`<p class="m">${esc(empty)}</p>`);
/** A link that fills its table cell (44px tall at least): `main` bold gold, `sub` small and muted under it. */
export const cellLink = (href: string, main: string, sub = "") => `<a class="cell" href="${esc(href)}"><b>${main}</b>${sub ? `<small>${sub}</small>` : ""}</a>`;
/** Rows that are links, stacked in one card. */
export const list = (rows: string[], empty: string) => (rows.length ? `<div class="list">${rows.join("")}</div>` : card(`<p class="m">${esc(empty)}</p>`));
/** One row of a list: the whole row is the link (56px tall at least). `cells` are its grid columns. */
export const listRow = (href: string, cells: string, one = false) => `<a class="row${one ? " one" : ""}" href="${esc(href)}">${cells}</a>`;
/** Number tiles, two a row on a phone. */
export const stats = (tiles: string[]) => `<div class="stats">${tiles.join("")}</div>`;
export const stat = (value: string, label: string, cls = "") => `<div class="stat"><b${cls ? ` class="${cls}"` : ""}>${esc(value)}</b><span>${esc(label)}</span></div>`;
/** Small linked buttons in a wrapping row (teams of an alliance, other seasons). */
export const chips = (items: { href: string; text: string; cls?: string }[]) =>
  `<ul class="chips">${items.map((x) => `<li><a class="chip${x.cls ? ` ${x.cls}` : ""}" href="${esc(x.href)}">${esc(x.text)}</a></li>`).join("")}</ul>`;
/** The page's title and the line under it. */
export const title = (h1: string, sub = "") => `<h1>${h1}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}`;

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────────────────────

const wlt = (w: number | null, l: number | null, t: number | null) => (w == null || l == null ? "—" : `${w}-${l}-${t ?? 0}`);

export const liteEventPath = (season: number, code: string) => `/lite/events/${season}/${encodeURIComponent(code)}`;
/** A team in the season of the page that links it (its record and OPR are that season's, as on the page). */
export const liteTeamPath = (team: number, season?: number) => `/lite/teams/${team}${season ? `?season=${season}` : ""}`;
export const liteMatchPath = (season: number, code: string, key: string) => `${liteEventPath(season, code)}/match/${key}`;

const KIND: Record<LiteCall["kind"], string> = { live: "logged before the match", backtest: "replay, not a live call", now: "from today's ratings" };

/** "Red 64%" (the favourite and its win odds) and the tier, as the rich pages say it. */
function callText(c: LiteCall, tier = true): string {
  const red = c.pRed >= 0.5;
  return `<span class="${red ? "r" : "b"}">${red ? "Red" : "Blue"} ${esc(oddsPct(red ? c.pRed : 1 - c.pRed))}</span>${tier ? `<small>${esc(TIER_WORD[c.tier] ?? c.tier)}</small>` : ""}`;
}

function result(m: LiteMatchRow): string {
  if (m.score) {
    const { red, blue } = m.score;
    return `<span class="r${red > blue ? " w" : ""}">${red}</span>–<span class="b${blue > red ? " w" : ""}">${blue}</span>`;
  }
  return m.call ? callText(m.call) : `<span class="m">—</span>`;
}

/** An alliance's teams, named for screen readers (the colour alone doesn't say which); one listed but not on the field (a playoff alliance's fourth robot) in brackets, muted. */
const teamsLine = (teams: number[], off: number[], cls: string) =>
  `<span class="${cls}"><span class="vh">${cls === "r" ? "Red" : "Blue"}: </span>${teams.map((t) => (off.includes(t) ? `<span class="m">(${t})</span>` : String(t))).join(" ")}</span>`;

/** Matches as a list: each row opens the match. Label and time, both alliances, then the score or the call. */
export function matchList(matches: (LiteMatchRow & { code?: string })[], season: number, code: string | null, empty: string, withEvent = false): string {
  return list(matches.map((m) => {
    const c = m.code ?? code!;
    return listRow(liteMatchPath(season, c, m.key),
      `<span><b>${esc(m.label)}</b><small>${esc(matchTime(m.time) || "—")}</small></span>`
      + `<span>${teamsLine(m.red, m.off, "r")}<br>${teamsLine(m.blue, m.off, "b")}</span><span class="res">${result(m)}</span>`
      + (withEvent ? `<span class="ev">${esc(c)}</span>` : ""));
  }), empty);
}
/** The key to bracketed teams, under a list that has any. */
export const offNote = (rows: LiteMatchRow[]) => (rows.some((m) => m.off.length) ? note("In brackets: on the alliance but not on the field.") : "");

// ── Pages ──────────────────────────────────────────────────────────────────────────────────────────────────

export function eventPage(e: LiteEvent, full: string): LitePage {
  const played = e.matches.filter((m) => m.played).length;
  const status = e.status === "live" ? "On now" : e.status === "finished" ? "Finished" : "Upcoming";
  const ranked = e.teams.some((t) => t.rank != null);
  const teamRows = e.teams.map((t) => `<tr><td class="n">${t.rank ?? "—"}</td><td>${cellLink(liteTeamPath(t.team, e.season), String(t.team), esc(t.name ?? ""))}</td>`
    + (ranked ? `<td class="n">${wlt(t.wins, t.losses, t.ties)}</td><td class="n">${num(t.rs, 2)}</td>` : "") + `<td class="n">${num(t.opr)}</td></tr>`);
  const teamHead = `<th class="n">#</th><th>Team</th>${ranked ? `<th class="n">W-L-T</th><th class="n" title="Ranking score: average ranking points a match">RS</th>` : ""}<th class="n">OPR</th>`;
  const awards = e.awards.map((a) => `<tr><td>${esc(awardLabel(a.type, a.placement))}</td><td class="n">${cellLink(liteTeamPath(a.team, e.season), String(a.team))}</td></tr>`);
  const rankNote = ranked && e.meet ? "This meet's own standing, from its matches alone. RS: ranking score, the average ranking points a match. The league's running standing is on the full page."
    : ranked ? "RS: ranking score, the average ranking points a match." : "";
  const body = title(esc(e.name), esc([e.typeLabel, dateRange(e.start, e.end), place(e.city, e.state, e.country)].filter(Boolean).join(" · ")))
    + stats([stat(status, seasonLabel(e.season)), stat(String(e.teams.length), "teams"), stat(`${played}/${e.matches.length}`, "matches played")])
    + (e.checkedAt ? note(`Results checked ${esc(matchTime(e.checkedAt))}. Reload the page for newer ones.`) : "")
    + section(ranked ? "Rankings" : e.registered ? "Registered teams" : "Teams", table(teamHead, teamRows, "No team list published yet.")
      + (e.registered ? note("FIRST's registration list: it can still change before the event.") : "") + (rankNote ? note(rankNote) : ""))
    + (e.alliances.length ? section("Alliances", table(`<th class="n">#</th><th>Teams</th>`,
      e.alliances.map((a) => `<tr><td class="n">${a.number}</td><td>${chips(a.teams.map((t) => ({ href: liteTeamPath(t, e.season), text: String(t) })))}</td></tr>`), "")) : "")
    + section("Matches", matchList(e.matches, e.season, e.code, "No schedule published yet.") + offNote(e.matches)
      + (e.matches.some((m) => !m.played && m.call) ? note("Matches not yet played show the favourite's win odds and how sure the call is.") : ""))
    + (awards.length ? section("Awards", table(`<th>Award</th><th class="n">Team</th>`, awards, "")) : "");
  return { title: e.name, full, body };
}

export function teamPage(t: LiteTeam, full: string): LitePage {
  const s = t.stats;
  const name = t.name ? `${t.number} ${t.name}` : `Team ${t.number}`;
  const top = s?.opr.npRank != null ? rankPct(s.opr.npRank, s.opr.of, true) : null;
  const eventRows = t.events.map((e) => `<tr><td>${cellLink(liteEventPath(t.season, e.code), esc(e.name), esc(dateRange(e.start, e.end))
    + (e.awards.length ? ` · <span class="ok">${esc(e.awards.map((a) => awardLabel(a.type, a.placement)).join(", "))}</span>` : ""))}</td>`
    + `<td class="n">${e.rank ?? "—"}</td><td class="n">${wlt(e.wins, e.losses, e.ties)}</td><td class="n">${num(e.opr)}</td></tr>`);
  const others = t.seasons.filter((x) => x !== t.season);
  const body = title(esc(name), esc([t.school, place(t.city, t.state, t.country), t.rookieYear ? `rookie year ${t.rookieYear}` : null].filter(Boolean).join(" · ")))
    + `<p class="sub">${esc(seasonLabel(t.season))} season</p>`
    + (s ? stats([stat(num(s.opr.np), top ? `OPR · ${top}` : "OPR"), stat(wlt(s.record.wins, s.record.losses, s.record.ties), `record, ${s.record.events} event${s.record.events === 1 ? "" : "s"}`),
      stat(num(s.opr.auto), "auto"), stat(num(s.opr.teleop), "TeleOp"), stat(num(s.opr.endgame), "endgame"), ...(s.ratingRank != null ? [stat(`#${int(s.ratingRank)}`, "rating rank")] : [])])
      : `<div class="sec">${card(`<p class="m">No ${esc(seasonLabel(t.season))} results yet.</p>`)}</div>`)
    + (t.next.length ? section("Next matches", matchList(t.next, t.season, null, "", true)) : "")
    + (t.recent.length ? section("Latest results", matchList(t.recent, t.season, null, "", true)) : "")
    + offNote([...t.next, ...t.recent])
    + section("Events", table(`<th>Event</th><th class="n">Rank</th><th class="n">W-L-T</th><th class="n">OPR</th>`, eventRows, "No events this season yet."))
    + (others.length ? section("Other seasons", chips(others.map((x) => ({ href: liteTeamPath(t.number, x), text: seasonLabel(x) })))) : "");
  return { title: name, full, body };
}

function sideTable(name: "Red" | "Blue", side: LiteSide, season: number): string {
  const cls = name === "Red" ? "r" : "b";
  const rows = side.teams.map((t) => {
    const marks = [t.surrogate ? "surrogate" : "", t.dq ? "DQ" : "", t.onField ? "" : "not on field"].filter(Boolean).join(" · ");
    return `<tr><td>${cellLink(liteTeamPath(t.number, season), String(t.number), esc([t.name ?? "", marks].filter(Boolean).join(" · ")))}</td>`
      + `<td class="n">${t.rank ?? "—"}</td><td class="n">${wlt(t.wins, t.losses, t.ties)}</td><td class="n">${num(t.opr)}</td><td class="n">${num(t.seasonOpr)}</td></tr>`;
  });
  return section(`${name}${side.score ? ` · ${side.score.total}` : ""}`,
    table(`<th>Team</th><th class="n">Rank</th><th class="n">W-L-T</th><th class="n">OPR here</th><th class="n">Season OPR</th>`, rows, "No teams listed yet."), cls);
}

export function matchPage(m: LiteMatch, full: string): LitePage {
  const name = `${m.label} · ${m.event}`;
  const c = m.call;
  const r = m.red.score, b = m.blue.score;
  const headline = r && b
    ? stats([stat(String(r.total), `Red${r.total > b.total ? " wins" : ""}`, "r"), stat(String(b.total), `Blue${b.total > r.total ? " wins" : ""}`, "b")])
    : c ? stats([stat(oddsPct(c.pRed), "Red wins", "r"), stat(oddsPct(1 - c.pRed), "Blue wins", "b"), ...(c.red != null && c.blue != null ? [stat(`${int(c.red)}–${int(c.blue)}`, "predicted score")] : [])]) : "";
  const call = c ? section(m.played ? "The call" : "Favourite", card(`<p>${callText(c, false)} <span class="m">· confidence ${esc((TIER_WORD[c.tier] ?? c.tier).toLowerCase())}, ${esc(KIND[c.kind])}</span></p>`
    + (c.redRange && c.blueRange ? `<p class="m s">Likely range: red ${c.redRange[0]}–${c.redRange[1]}, blue ${c.blueRange[0]}–${c.blueRange[1]}</p>` : "")
    + (m.reasons.length ? `<ul class="why">${m.reasons.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""))) : "";
  const sheet = m.sheet?.length
    ? section("Score sheet", table(`<th></th><th class="n r">Red</th><th class="n b">Blue</th>`,
      m.sheet.map((s) => `<tr${s.depth ? ` class="d1"` : ""}><td>${esc(s.label)}${s.count ? ` <span class="m s">count</span>` : ""}</td><td class="n">${s.red ?? "—"}</td><td class="n">${s.blue ?? "—"}</td></tr>`), ""))
    : r && b ? section("Score by phase", table(`<th></th><th class="n r">Red</th><th class="n b">Blue</th>`,
      ([["Auto", "auto"], ["TeleOp", "teleop"], ["Endgame", "endgame"], ["Penalty points", "pen"]] as const).map(([l, k]) => `<tr><td>${l}</td><td class="n">${r[k]}</td><td class="n">${b[k]}</td></tr>`), "")) : "";
  const step = (x: { key: string; label: string } | null, text: string) => (x ? button(liteMatchPath(m.season, m.code, x.key), text) : "<span></span>");
  const body = `<div class="back">${chips([{ href: liteEventPath(m.season, m.code), text: `← ${m.event}` }])}</div>`
    + title(esc(m.description ?? m.label), esc(`${matchTime(m.time) || "Time not published"}${m.played ? " · played" : ""}`))
    + headline + call
    + sideTable("Red", m.red, m.season) + sideTable("Blue", m.blue, m.season) + sheet
    + `<div class="nav">${step(m.prev, m.prev ? `← ${m.prev.label}` : "")}${step(m.next, m.next ? `${m.next.label} →` : "")}</div>`;
  return { title: name, full, body };
}

export function picklistPage(p: LitePicks, workspace: string, full: string): LitePage {
  const rows = p.picks.map((x) => `<tr><td class="n">${x.rank}</td><td>${cellLink(liteTeamPath(x.team, p.season), String(x.team),
    esc(x.name ?? "") + (x.note ? `<br><span>${esc(x.note)}${x.noteBy ? ` · ${esc(x.noteBy)}` : ""}</span>` : ""))}</td>`
    + `<td class="n">${num(x.opr)}${x.oprRank != null ? `<br><span class="m s">#${x.oprRank}</span>` : ""}</td><td class="n">${esc(x.record ?? "—")}</td></tr>`);
  const body = title("Pick list", `${esc(workspace)} · ${esc(seasonLabel(p.season))} · ${p.picks.length} team${p.picks.length === 1 ? "" : "s"}`)
    + note("Read-only here. Reorder, add teams and edit notes in the full version.")
    + `<div class="sec">${table(`<th class="n">#</th><th>Team</th><th class="n">OPR</th><th class="n">Record</th>`, rows, "The pick list is empty. Add teams in the full version.")}</div>`;
  return { title: `Pick list · ${workspace}`, full, body };
}

/** A short message page (not found, sign in first, no access): still with its way back to the full version. */
export function messagePage(heading: string, text: string, full: string, extra = ""): LitePage {
  return { title: heading, full, body: title(esc(heading)) + `<div class="sec">${card(`<p>${esc(text)}</p>`)}</div>${extra ? `<div class="sec">${extra}</div>` : ""}` };
}
