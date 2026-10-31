// Light pages (docs/lite.md): plain HTML for one bar of signal. No images, no charts (tables instead), no
// scripts, system fonts, one small inline stylesheet. Numbers, dates and odds go through the same helpers as the
// rich pages (src/shared/format.ts), so the two versions of a page always read the same.
import { awardLabel, dateRange, int, matchTime, num, oddsPct, place, rankPct, seasonLabel } from "../../src/shared/format.js";
import { TIER_WORD } from "../../src/shared/tierWords.js";
import type { LiteCall, LiteEvent, LiteMatch, LiteMatchRow, LitePicks, LiteSide, LiteTeam } from "./trim.js";

export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The app's colours (src/index.css): dark by default, light when the device asks for it (no script to read the
// app's own theme setting).
const STYLE = `:root{color-scheme:dark light;--bg:#0a0a0b;--fg:#f4f4f5;--mut:#a1a1aa;--line:#ffffff1f;--acc:#ffc700;--red:#f87171;--blue:#60a5fa;--ok:#4ade80}`
  + `@media(prefers-color-scheme:light){:root{--bg:#fff;--fg:#09090b;--mut:#52525b;--line:#e4e4e7;--acc:#a16207;--red:#dc2626;--blue:#2563eb;--ok:#15803d}}`
  + `body{margin:0 auto;max-width:52rem;padding:0 16px 32px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}`
  + `a{color:inherit;text-underline-offset:2px}`
  + `.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}`
  + `.bar b{font-size:14px}.bar b i{font-style:normal;color:var(--acc)}`
  + `.full{padding:6px 12px;border:1px solid var(--acc);border-radius:8px;color:var(--acc);font-weight:600;font-size:14px;text-decoration:none;white-space:nowrap}`
  + `h1{margin:16px 0 2px;font-size:22px;line-height:1.2}h2{margin:24px 0 6px;font-size:17px}`
  + `p{margin:4px 0}.m{color:var(--mut)}.s{font-size:13px}`
  + `.k{display:flex;flex-wrap:wrap;gap:8px 20px;margin:12px 0}.k div{min-width:5.5rem}.k b{display:block;font-size:24px;line-height:1.1;color:var(--acc)}.k span{font-size:12px;color:var(--mut)}.k b.r{color:var(--red)}.k b.b{color:var(--blue)}`
  + `.t{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:14px}`
  + `th,td{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12px;font-weight:600;color:var(--mut)}`
  + `.n{text-align:right;white-space:nowrap}.r{color:var(--red)}.b{color:var(--blue)}.w{font-weight:700}.ok{color:var(--ok)}`
  + `.d1 td:first-child{padding-left:18px;color:var(--mut)}.nav{display:flex;justify-content:space-between;margin-top:20px}`
  + `footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--line);font-size:13px;color:var(--mut)}`;

export interface LitePage {
  title: string;
  /** The rich page this one stands in for: the "Full version" link, and the canonical URL. */
  full: string;
  body: string;
}

/** The whole document. `canonical`: the full page's absolute URL (search engines index that one, not this). */
export function liteDocument(p: LitePage, canonical: string | null): string {
  const full = `<a class="full" href="${esc(p.full)}">Full version</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(p.title)} · Control Scout light</title>${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}`
    + `<meta name="color-scheme" content="dark light"><style>${STYLE}</style></head><body>`
    + `<header class="bar"><b>Control Scout <i>light</i></b>${full}</header><main>${p.body}</main>`
    + `<footer><p>Light version: text only, for a weak signal. Same data as the full site.</p></footer></body></html>`;
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────────────────────

const wlt = (w: number | null, l: number | null, t: number | null) => (w == null || l == null ? "—" : `${w}-${l}-${t ?? 0}`);
const table = (head: string, rows: string[], empty: string) =>
  rows.length ? `<div class="t"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<p class="m">${esc(empty)}</p>`;
const stat = (value: string, label: string) => `<div><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

export const liteEventPath = (season: number, code: string) => `/lite/events/${season}/${encodeURIComponent(code)}`;
/** A team in the season of the page that links it (its record and OPR are that season's, as on the page). */
export const liteTeamPath = (team: number, season?: number) => `/lite/teams/${team}${season ? `?season=${season}` : ""}`;
export const liteMatchPath = (season: number, code: string, key: string) => `${liteEventPath(season, code)}/match/${key}`;

const KIND: Record<LiteCall["kind"], string> = { live: "logged before the match", backtest: "replay, not a live call", now: "from today's ratings" };

/** "Red 64%" (the favourite and its win odds) and the tier, as the rich pages say it. */
function callText(c: LiteCall, tier = true): string {
  const red = c.pRed >= 0.5;
  return `<span class="${red ? "r" : "b"}">${red ? "Red" : "Blue"} ${esc(oddsPct(red ? c.pRed : 1 - c.pRed))}</span>${tier ? ` <span class="m">${esc(TIER_WORD[c.tier] ?? c.tier)}</span>` : ""}`;
}

function result(m: LiteMatchRow): string {
  if (m.score) {
    const { red, blue } = m.score;
    return `<span class="r${red > blue ? " w" : ""}">${red}</span>–<span class="b${blue > red ? " w" : ""}">${blue}</span>`;
  }
  return m.call ? callText(m.call) : `<span class="m">—</span>`;
}

/** An alliance's teams; one listed but not on the field (a playoff alliance's fourth robot) in brackets, muted. */
const teamsCell = (teams: number[], off: number[], cls: string) =>
  `<td class="${cls}">${teams.map((t) => (off.includes(t) ? `<span class="m">(${t})</span>` : String(t))).join(" ")}</td>`;

function matchRows(matches: (LiteMatchRow & { code?: string })[], season: number, code: string | null, withEvent = false): string[] {
  return matches.map((m) => {
    const c = m.code ?? code!;
    return `<tr><td><a href="${liteMatchPath(season, c, m.key)}">${esc(m.label)}</a>${withEvent ? ` <span class="m s">${esc(c)}</span>` : ""}</td>`
      + `<td class="m s">${esc(matchTime(m.time))}</td>${teamsCell(m.red, m.off, "r")}${teamsCell(m.blue, m.off, "b")}<td class="n">${result(m)}</td></tr>`;
  });
}
/** The key to bracketed teams, under a table that has any. */
const offNote = (rows: LiteMatchRow[]) => (rows.some((m) => m.off.length) ? `<p class="s m">In brackets: on the alliance but not on the field.</p>` : "");
const MATCH_HEAD = `<th>Match</th><th>Time</th><th>Red</th><th>Blue</th><th class="n">Result</th>`;

// ── Pages ──────────────────────────────────────────────────────────────────────────────────────────────────

export function eventPage(e: LiteEvent, full: string): LitePage {
  const played = e.matches.filter((m) => m.played).length;
  const status = e.status === "live" ? "On now" : e.status === "finished" ? "Finished" : "Upcoming";
  const ranked = e.teams.some((t) => t.rank != null);
  const teamRows = e.teams.map((t) => `<tr><td class="n">${t.rank ?? "—"}</td><td><a href="${liteTeamPath(t.team, e.season)}">${t.team}</a></td><td>${esc(t.name ?? "")}</td>`
    + (ranked ? `<td class="n">${wlt(t.wins, t.losses, t.ties)}</td><td class="n">${num(t.rp, 2)}</td>` : "") + `<td class="n">${num(t.opr)}</td></tr>`);
  const teamHead = `<th class="n">Rank</th><th>Team</th><th>Name</th>${ranked ? `<th class="n">W-L-T</th><th class="n">RP</th>` : ""}<th class="n">OPR</th>`;
  const awardsByTeam = e.awards.map((a) => `<tr><td>${esc(awardLabel(a.type, a.placement))}</td><td><a href="${liteTeamPath(a.team, e.season)}">${a.team}</a></td></tr>`);
  const body = `<h1>${esc(e.name)}</h1>`
    + `<p class="m">${esc([e.typeLabel, dateRange(e.start, e.end), place(e.city, e.state, e.country)].filter(Boolean).join(" · "))}</p>`
    + `<div class="k">${stat(status, seasonLabel(e.season))}${stat(String(e.teams.length), "teams")}${stat(`${played}/${e.matches.length}`, "matches played")}</div>`
    + (e.checkedAt ? `<p class="s m">Results checked ${esc(matchTime(e.checkedAt))} (refresh the page for newer ones).</p>` : "")
    + `<h2>${ranked ? "Rankings" : e.registered ? "Registered teams" : "Teams"}</h2>`
    + (e.registered ? `<p class="s m">FIRST's registration list: it can still change before the event.</p>` : "")
    + table(teamHead, teamRows, "No team list published yet.")
    + (e.alliances.length ? `<h2>Alliances</h2>` + table(`<th class="n">#</th><th>Teams</th>`, e.alliances.map((a) => `<tr><td class="n">${a.number}</td><td>${a.teams.map((t) => `<a href="${liteTeamPath(t, e.season)}">${t}</a>`).join(" ")}</td></tr>`), "") : "")
    + `<h2>Matches</h2>` + table(MATCH_HEAD, matchRows(e.matches, e.season, e.code), "No schedule published yet.")
    + offNote(e.matches)
    + (e.matches.some((m) => !m.played && m.call) ? `<p class="s m">Unplayed matches show the favourite's win odds and how sure the call is.</p>` : "")
    + (awardsByTeam.length ? `<h2>Awards</h2>` + table(`<th>Award</th><th>Team</th>`, awardsByTeam, "") : "");
  return { title: e.name, full, body };
}

export function teamPage(t: LiteTeam, full: string): LitePage {
  const s = t.stats;
  const title = t.name ? `${t.number} ${t.name}` : `Team ${t.number}`;
  const top = s?.opr.npRank != null ? rankPct(s.opr.npRank, s.opr.of, true) : null;
  const eventRows = t.events.map((e) => `<tr><td><a href="${liteEventPath(t.season, e.code)}">${esc(e.name)}</a><div class="m s">${esc(dateRange(e.start, e.end))}`
    + `${e.awards.length ? ` · <span class="ok">${esc(e.awards.map((a) => awardLabel(a.type, a.placement)).join(", "))}</span>` : ""}</div></td>`
    + `<td class="n">${e.rank ?? "—"}</td><td class="n">${wlt(e.wins, e.losses, e.ties)}</td><td class="n">${num(e.opr)}</td></tr>`);
  const others = t.seasons.filter((x) => x !== t.season);
  const body = `<h1>${esc(title)}</h1>`
    + `<p class="m">${esc([t.school, place(t.city, t.state, t.country), t.rookieYear ? `rookie year ${t.rookieYear}` : null].filter(Boolean).join(" · "))}</p>`
    + `<p class="s">${esc(seasonLabel(t.season))}${others.length ? ` · other seasons: ${others.map((x) => `<a href="${liteTeamPath(t.number, x)}">${esc(seasonLabel(x))}</a>`).join(" ")}` : ""}</p>`
    + (s ? `<div class="k">${stat(num(s.opr.np), top ? `OPR · ${top}` : "OPR")}${stat(wlt(s.record.wins, s.record.losses, s.record.ties), `record, ${s.record.events} event${s.record.events === 1 ? "" : "s"}`)}`
      + `${stat(num(s.opr.auto), "auto")}${stat(num(s.opr.teleop), "TeleOp")}${stat(num(s.opr.endgame), "endgame")}${s.ratingRank != null ? stat(`#${int(s.ratingRank)}`, "rating rank") : ""}</div>`
      : `<p class="m">No ${esc(seasonLabel(t.season))} results yet.</p>`)
    + (t.next.length ? `<h2>Next matches</h2>` + table(MATCH_HEAD, matchRows(t.next, t.season, null, true), "") : "")
    + (t.recent.length ? `<h2>Latest results</h2>` + table(MATCH_HEAD, matchRows(t.recent, t.season, null, true), "") : "")
    + offNote([...t.next, ...t.recent])
    + `<h2>Events</h2>` + table(`<th>Event</th><th class="n">Rank</th><th class="n">W-L-T</th><th class="n">OPR</th>`, eventRows, "No events this season yet.");
  return { title, full, body };
}

function sideTable(name: "Red" | "Blue", side: LiteSide, season: number): string {
  const cls = name === "Red" ? "r" : "b";
  const rows = side.teams.map((t) => `<tr><td><a class="${cls}" href="${liteTeamPath(t.number, season)}">${t.number}</a>${t.surrogate ? ` <span class="m s">surrogate</span>` : ""}${t.dq ? ` <span class="m s">DQ</span>` : ""}${t.onField ? "" : ` <span class="m s">not on field</span>`}`
    + `<div class="m s">${esc(t.name ?? "")}</div></td><td class="n">${t.rank ?? "—"}</td><td class="n">${wlt(t.wins, t.losses, t.ties)}</td><td class="n">${num(t.opr)}</td><td class="n">${num(t.seasonOpr)}</td></tr>`);
  return `<h2 class="${cls}">${name}${side.score ? ` · ${side.score.total}` : ""}</h2>`
    + table(`<th>Team</th><th class="n">Rank</th><th class="n">W-L-T</th><th class="n">Event OPR</th><th class="n">${esc(seasonLabel(season))} OPR</th>`, rows, "No teams listed yet.");
}

export function matchPage(m: LiteMatch, full: string): LitePage {
  const title = `${m.label} · ${m.event}`;
  const c = m.call;
  const r = m.red.score, b = m.blue.score;
  const headline = r && b
    ? `<div class="k"><div><b class="r">${r.total}</b><span>Red${r.total > b.total ? " wins" : ""}</span></div><div><b class="b">${b.total}</b><span>Blue${b.total > r.total ? " wins" : ""}</span></div></div>`
    : c ? `<div class="k">${stat(oddsPct(c.pRed), "Red wins").replace("<b>", `<b class="r">`)}${stat(oddsPct(1 - c.pRed), "Blue wins").replace("<b>", `<b class="b">`)}`
      + (c.red != null && c.blue != null ? stat(`${int(c.red)}–${int(c.blue)}`, "predicted score") : "") + `</div>` : "";
  const callLine = c ? `<p class="s">${m.played ? "The call: " : "Favourite: "}${callText(c, false)} <span class="m">· confidence ${esc((TIER_WORD[c.tier] ?? c.tier).toLowerCase())}, ${esc(KIND[c.kind])}</span>`
    + (c.redRange && c.blueRange ? `<br><span class="m">Likely range: red ${c.redRange[0]}–${c.redRange[1]}, blue ${c.blueRange[0]}–${c.blueRange[1]}</span>` : "") + `</p>` : "";
  const sheet = m.sheet?.length
    ? `<h2>Score sheet</h2>` + table(`<th></th><th class="n r">Red</th><th class="n b">Blue</th>`,
      m.sheet.map((s) => `<tr${s.depth ? ` class="d1"` : ""}><td>${esc(s.label)}${s.count ? ` <span class="m s">count</span>` : ""}</td><td class="n">${s.red ?? "—"}</td><td class="n">${s.blue ?? "—"}</td></tr>`), "")
    : r && b ? `<h2>Score by phase</h2>` + table(`<th></th><th class="n r">Red</th><th class="n b">Blue</th>`,
      ([["Auto", "auto"], ["TeleOp", "teleop"], ["Endgame", "endgame"], ["Penalty points", "pen"]] as const).map(([l, k]) => `<tr><td>${l}</td><td class="n">${r[k]}</td><td class="n">${b[k]}</td></tr>`), "") : "";
  const step = (x: { key: string; label: string } | null, text: (label: string) => string) => (x ? `<a href="${liteMatchPath(m.season, m.code, x.key)}">${text(esc(x.label))}</a>` : "<span></span>");
  const body = `<p class="s"><a href="${liteEventPath(m.season, m.code)}">${esc(m.event)}</a></p>`
    + `<h1>${esc(m.description ?? m.label)}</h1>`
    + `<p class="m">${esc(matchTime(m.time) || "Time not published")}${m.played ? " · played" : ""}</p>`
    + headline + callLine
    + (m.reasons.length ? `<ul class="s">${m.reasons.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "")
    + sideTable("Red", m.red, m.season) + sideTable("Blue", m.blue, m.season) + sheet
    + `<p class="s nav">${step(m.prev, (l) => `← ${l}`)}${step(m.next, (l) => `${l} →`)}</p>`;
  return { title, full, body };
}

export function picklistPage(p: LitePicks, workspace: string, full: string): LitePage {
  const rows = p.picks.map((x) => `<tr><td class="n">${x.rank}</td><td><a href="${liteTeamPath(x.team, p.season)}">${x.team}</a><div class="m s">${esc(x.name ?? "")}</div></td>`
    + `<td class="n">${num(x.opr)}${x.oprRank != null ? `<div class="m s">#${x.oprRank}</div>` : ""}</td><td class="n">${esc(x.record ?? "—")}</td>`
    + `<td>${x.note ? `${esc(x.note)}${x.noteBy ? ` <span class="m s">· ${esc(x.noteBy)}</span>` : ""}` : `<span class="m">—</span>`}</td></tr>`);
  const body = `<h1>Pick list</h1><p class="m">${esc(workspace)} · ${esc(seasonLabel(p.season))} · ${p.picks.length} team${p.picks.length === 1 ? "" : "s"}</p>`
    + `<p class="s m">Read-only here. Reorder, add teams and edit notes in the full version.</p>`
    + table(`<th class="n">#</th><th>Team</th><th class="n">OPR</th><th class="n">Record</th><th>Note</th>`, rows, "The pick list is empty. Add teams in the full version.");
  return { title: `Pick list · ${workspace}`, full, body };
}

/** A short message page (not found, sign in first, no access): still with its way back to the full version. */
export function messagePage(title: string, text: string, full: string, extra = ""): LitePage {
  return { title, full, body: `<h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}` };
}
