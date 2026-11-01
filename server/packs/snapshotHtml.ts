// Frozen match-day snapshots (docs/event-bundle.md): the "Know your match" reports and the workspace pick list,
// rendered here at bundle-build time to self-contained static HTML. No scripts, no links to load, no data
// fetches: the page reads the same with the phone in airplane mode. The app shows it in a sandboxed frame under
// a "Snapshot from 07:12, may be stale" banner; the time is also printed inside the page itself, so a snapshot
// is never mistaken for live data wherever it ends up.
//
// Kept plain on purpose: the essentials of each report (the call and its confidence, each team's standing,
// OPR split, flags and the workspace's scouting), in the app's colours, light or dark as the device is.
import type { EventDetail } from "../../src/shared/api.js";
import type { TeamConsensus } from "../../src/shared/consensus.js";
import type { MatchReport, MatchReportWorkspace, OprSplit, ReportTeam } from "../../src/shared/matchReport.js";
import type { PickList } from "../../src/shared/picklist.js";
import { oddsPct } from "../../src/shared/share.js";
import { TIER_WORD } from "../../src/shared/tierWords.js";
import type { SeasonReference } from "../../src/shared/rules/types.js";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text for HTML: every value from data goes through this. */
export const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const num = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "–" : x.toFixed(d));

/** "7:12 AM" in the event's own time zone (the device's clock may differ; the zone is named when known). */
export function clockIn(iso: string, timezone: string | null): string {
  const d = new Date(iso);
  try {
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...(timezone ? { timeZone: timezone, timeZoneName: "short" } : { timeZone: "UTC", timeZoneName: "short" }) });
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timezone ? { timeZone: timezone } : { timeZone: "UTC" }) });
    return `${day}, ${t}`;
  } catch { return d.toISOString().slice(0, 16).replace("T", " ") + " UTC"; }
}

// The app's own tokens (src/index.css), dark first like the app, light when the device asks for it.
const CSS = `
:root{color-scheme:dark light;--bg:#0b0b0d;--card:#141417;--fg:#f4f4f5;--mut:#a1a1aa;--line:#27272a;--acc:#ffc700;--red:#f43f5e;--blue:#38bdf8;--ok:#34d399;--warn:#fb923c;--bad:#fb7185}
@media (prefers-color-scheme:light){:root{--bg:#fafafa;--card:#fff;--fg:#18181b;--mut:#52525b;--line:#e4e4e7;--acc:#a16207;--red:#e11d48;--blue:#0369a1;--ok:#047857;--warn:#c2410c;--bad:#be123c}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;padding:12px;background:var(--bg);color:var(--fg);font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
h1{font-size:20px;margin:2px 0 4px;letter-spacing:-.01em}h2{font-size:15px;margin:0 0 8px}
.mut{color:var(--mut)}.sm{font-size:12px}.num{font-variant-numeric:tabular-nums}
.stamp{display:inline-block;border:1px solid var(--warn);color:var(--warn);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;margin-bottom:6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:10px 0}
.red{color:var(--red)}.blue{color:var(--blue)}
.bar{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--line);margin:6px 0}
.bar i{display:block;height:100%}
.grid{display:grid;gap:10px}@media (min-width:720px){.grid{grid-template-columns:1fr 1fr}}
.team{border-left:3px solid var(--line);padding:6px 0 6px 10px;margin:8px 0}
.team.side-red{border-color:var(--red)}.team.side-blue{border-color:var(--blue)}
.team b{color:var(--fg)}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{border:1px solid var(--line);border-radius:999px;padding:0 7px;font-size:11px;color:var(--mut)}
.chip.flag{border-color:var(--warn);color:var(--warn)}.chip.pick{border-color:var(--acc);color:var(--acc)}
.chip.good{border-color:var(--ok);color:var(--ok)}.chip.bad{border-color:var(--bad);color:var(--bad)}
table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:11px;color:var(--mut);font-weight:500}
`;

function page(title: string, stamp: string, body: string): string {
  // No <script>, no external resources: a strict CSP says so to anything that opens the file on its own.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<title>${esc(title)}</title><style>${CSS}</style></head><body>`
    + `<span class="stamp">${esc(stamp)}</span>${body}</body></html>`;
}

const stampText = (asOf: string, tz: string | null) => `Snapshot from ${clockIn(asOf, tz)} · may be stale`;

function split(o: OprSplit | null | undefined): string {
  if (!o || o.np == null) return `<span class="mut">No OPR yet</span>`;
  return `<span class="num"><b>${num(o.np)}</b> OPR</span> <span class="mut sm num">(auto ${num(o.auto)} · driver ${num(o.teleop)} · endgame ${num(o.endgame)}${o.pen != null && o.pen > 0 ? ` · gives away ${num(o.pen)}` : ""})</span>`;
}

function consensusLines(c: TeamConsensus | undefined): string {
  if (!c || !c.entries) return `<div class="mut sm">No scouting entries on this team yet.</div>`;
  const nums = [...c.ratings, ...c.counters].slice(0, 4)
    .map((n) => `${esc(n.label)} <b class="num">${num(n.avg)}${n.max ? `/${n.max}` : ""}</b>`).join(" · ");
  const tags = (xs: { label: string; count: number }[], cls: string) => xs.slice(0, 4).map((t) => `<span class="chip ${cls}">${esc(t.label)} ×${t.count}</span>`).join("");
  return `<div class="sm"><span class="mut">Scouting (${c.entries} ${c.entries === 1 ? "entry" : "entries"}, ${c.scouts} ${c.scouts === 1 ? "scout" : "scouts"}):</span> ${nums || ""}</div>`
    + (c.strengths.length || c.weaknesses.length ? `<div class="chips">${tags(c.strengths, "good")}${tags(c.weaknesses, "bad")}</div>` : "");
}

function teamBlock(side: "red" | "blue", t: ReportTeam | undefined, number: number, ws: MatchReportWorkspace | null, mine: number | null): string {
  const c = ws?.teams.find((x) => x.team === number);
  const chips = [
    ...(mine === number ? [`<span class="chip pick">Your team</span>`] : []),
    ...(ws?.picklist.includes(number) ? [`<span class="chip pick">On your pick list</span>`] : []),
    ...(t?.flags ?? []).map((f) => `<span class="chip flag" title="${esc(f.detail)}">${esc(f.label)}</span>`),
  ].join("");
  const ev = t?.event;
  const standing = ev && ev.rank != null
    ? `Rank <b class="num">${ev.rank}</b> here · <span class="num">${ev.wins ?? 0}-${ev.losses ?? 0}-${ev.ties ?? 0}</span>`
    : `<span class="mut">No standing here yet</span>`;
  const season = t?.season ? ` · season <span class="num">${t.season.wins}-${t.season.losses}-${t.season.ties}</span>${t.season.rank ? `, world #${t.season.rank}${t.season.of ? ` of ${t.season.of}` : ""}` : ""}` : "";
  return `<div class="team side-${side}"><div><b class="num">${number}</b> ${esc(t?.name ?? "")}${t?.city ? ` <span class="mut sm">${esc([t.city, t.state].filter(Boolean).join(", "))}</span>` : ""}</div>`
    + `<div class="sm">${standing}${season}</div>`
    + `<div class="sm">${split(ev?.opr?.np != null ? ev.opr : t?.season?.opr)}</div>`
    + (chips ? `<div class="chips">${chips}</div>` : "")
    + (ws ? consensusLines(c) : "")
    + `</div>`;
}

/** A "Know your match" report, frozen. `ws`: the workspace half (null: OPR only). `mine`: your team. */
export function matchReportHtml(r: MatchReport, ws: MatchReportWorkspace | null, opts: { asOf: string; timezone: string | null; mine: number | null; workspaceName: string | null }): string {
  const m = r.match;
  const byTeam = new Map(r.teams.map((t) => [t.team, t]));
  const p = m.prediction;
  const scored = m.played && m.red.score && m.blue.score ? `<p class="num" style="font-size:22px;font-weight:700;margin:0 0 6px"><span class="red">${m.red.score.total}</span> – <span class="blue">${m.blue.score.total}</span> <span class="mut sm">final</span></p>` : "";
  const call = p
    ? `<div class="sm mut">${p.kind === "live" ? "Called before the match" : "Prediction from the ratings at the time"} · confidence: ${esc(TIER_WORD[p.tier] ?? p.tier)}</div>`
      + `<div class="num" style="display:flex;justify-content:space-between;font-weight:600"><span class="red">Red ${oddsPct(p.pRed)}</span><span class="blue">${oddsPct(1 - p.pRed)} Blue</span></div>`
      + `<div class="bar"><i style="width:${(p.pRed * 100).toFixed(1)}%;background:var(--red)"></i><i style="flex:1;background:var(--blue)"></i></div>`
      + (p.noScoreBasis ? "" : `<div class="sm mut num">Predicted score ${Math.round(p.redMean)}${p.redRange ? ` (${p.redRange[0]}–${p.redRange[1]})` : ""} – ${Math.round(p.blueMean)}${p.blueRange ? ` (${p.blueRange[0]}–${p.blueRange[1]})` : ""}</div>`)
      + (p.factors?.length ? `<div class="sm" style="margin-top:6px">${p.factors.slice(0, 3).map((f) => esc(f.label)).filter(Boolean).join(" · ")}</div>` : "")
    : `<div class="sm mut">No prediction for this match.</div>`;
  const sides = (["red", "blue"] as const).map((side) => {
    const teams = m[side].teams.filter((t) => t.onField || !m.played);
    return `<div class="card"><h2 class="${side}">${side === "red" ? "Red" : "Blue"} alliance</h2>${teams.map((t) => teamBlock(side, byTeam.get(t.number), t.number, ws, opts.mine)).join("")}</div>`;
  }).join("");
  const who = ws ? `Scouting from ${esc(opts.workspaceName ?? "your workspace")} (members only).` : "OPR and data flags only.";
  return page(`${m.label} · ${r.event.name}`, stampText(opts.asOf, opts.timezone),
    `<div class="mut sm">Know your match · ${esc(r.event.name)}</div>`
    + `<h1>${esc(r.description ?? m.label)}${m.time ? ` <span class="mut sm">${esc(m.time.slice(11, 16))}</span>` : ""}</h1>`
    + `<div class="card">${scored}${call}</div>`
    + `<p class="sm mut">${who}</p>`
    + `<div class="grid">${sides}</div>`
    + `<p class="sm mut">Frozen when the bundle was built. Results, rankings and scouting since then aren't in it: open the live report when you have signal.</p>`);
}

/** The workspace pick list, frozen, with each team's standing at this event as of the bundle. */
export function picklistHtml(list: PickList, ev: EventDetail, opts: { asOf: string; workspaceName: string }): string {
  const field = new Map(ev.field.map((f) => [f.team, f]));
  const rows = list.picks.map((p) => {
    const f = field.get(p.team);
    const here = f ? `${f.rank != null ? `#${f.rank}` : "–"}${f.opr.np != null ? ` · ${num(f.opr.np)} OPR` : ""}` : `<span class="mut">not here</span>`;
    const note = p.note ? `<div class="sm">${esc(p.note)}${p.noteBy?.name ? ` <span class="mut">– ${esc(p.noteBy.name)}</span>` : ""}</div>` : "";
    return `<tr><td class="num"><b>${p.rank}</b></td><td><b class="num">${p.team}</b> ${esc(f?.name ?? "")}${note}</td><td class="num sm">${here}</td></tr>`;
  }).join("");
  return page(`Pick list · ${ev.event.name}`, stampText(opts.asOf, ev.event.timezone),
    `<div class="mut sm">Pick list · ${esc(opts.workspaceName)} · version ${list.version}</div>`
    + `<h1>${esc(ev.event.name)}</h1>`
    + `<p class="sm" style="color:var(--warn)">This is the list as it was when the bundle was built. Your team may have changed it since: check the live list before you pick.</p>`
    + (list.picks.length
      ? `<div class="card"><table><thead><tr><th>#</th><th>Team</th><th>Here (as of the snapshot)</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="card mut">The pick list was empty when the bundle was built.</div>`));
}

/** The question-box rules reference (src/shared/rules), frozen: every rule summary and Q&A ruling, in our own words,
 *  always pointing at the official manual. Static like the rest; it isn't data that goes stale during an event, so
 *  it carries its manual revision instead of a snapshot time. */
export function rulesHtml(ref: SeasonReference): string {
  const bySection = ref.sections.map((sec) => {
    const rules = ref.rules.filter((r) => r.section === sec.id);
    if (!rules.length) return "";
    return `<div class="card"><h2>${esc(sec.id)} ${esc(sec.title)}</h2>${rules.map((r) =>
      `<div class="team"><div><b>${esc(r.id)}</b> ${esc(r.title)}${r.penalty ? ` <span class="chip flag">${esc(r.penalty)}</span>` : ""}</div><div class="sm">${esc(r.summary)}</div></div>`).join("")}</div>`;
  }).join("");
  const rulings = ref.rulings.length
    ? `<div class="card"><h2>Q&amp;A rulings (unofficial summaries)</h2>${ref.rulings.map((q) =>
      `<div class="team"><div><b>Q${q.n}</b> ${esc(q.title)} <span class="mut sm">${esc(q.rules.join(", "))} · ${esc(q.answered)}</span></div><div class="sm">${esc(q.summary)}</div></div>`).join("")}</div>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<title>${esc(ref.game)} rules reference</title><style>${CSS}</style></head><body>`
    + `<span class="stamp">Manual ${esc(ref.manual.revision)} (${esc(ref.manual.date)}) · Q&amp;A read ${esc(ref.qa.readOn)}</span>`
    + `<h1>${esc(ref.game)} rules, quick reference</h1>`
    + `<p class="sm" style="color:var(--warn)">Summaries in our own words, not the official text. Check the official game manual (${esc(ref.manual.url)}) before you rely on a ruling.</p>`
    + bySection + rulings + `</body></html>`;
}
