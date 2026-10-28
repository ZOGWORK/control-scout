// The weekly digest email (docs/digest.md): subject, plain text and HTML from one DigestData.
//
// Text first, links second: every number reads with images blocked (the logo is the only image, and the
// name sits next to it in text). Old-school email HTML: one centred 600px column of tables, inline styles,
// single column at every width, links as tall rows so they're easy to tap on a phone.
//
// Light by design, with a real dark version: Apple Mail, iOS Mail and Outlook.com pick up the
// prefers-color-scheme / [data-ogsc] rules; clients that invert colours themselves (Gmail) get solid,
// high-contrast colours with no grey-on-white text to vanish. No tracking pixel, no UTM tags: every link
// is the plain page it names.
import { MAX_RESULTS, type DigestData, type RankingRow, type TeamWeek, type Upcoming } from "./build.js";
import type { Movement } from "../../src/shared/powerRankings.js";

/** Bumped whenever the email's layout or wording changes in a way worth telling apart in the send log. */
export const TEMPLATE_VERSION = 1;

export interface Links {
  /** The public site, no trailing slash. */
  site: string;
  /** This account's one-click unsubscribe URL. */
  unsubscribe: string;
  email: string;
}

const L = {
  page: "#f3f2ee", card: "#ffffff", line: "#e6e4dd", text: "#18181b", body: "#3f3f46", muted: "#52525b",
  link: "#8a5a00", gold: "#ffc700", chip: "#f4f2ea", up: "#15803d", down: "#b91c1c", flat: "#52525b",
};
const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const parts = (d: string) => { const t = new Date(`${d}T12:00:00Z`); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), w: t.getUTCDay() }; };

/** "October 19 to 25, 2026" (or across months / years). */
export function weekLabel(from: string, to: string): string {
  const a = parts(from), b = parts(to);
  if (a.y !== b.y) return `${MONTHS_LONG[a.m]} ${a.d}, ${a.y} to ${MONTHS_LONG[b.m]} ${b.d}, ${b.y}`;
  if (a.m !== b.m) return `${MONTHS_LONG[a.m]} ${a.d} to ${MONTHS_LONG[b.m]} ${b.d}, ${b.y}`;
  return `${MONTHS_LONG[a.m]} ${a.d} to ${b.d}, ${b.y}`;
}

/** An event's dates: "Sat, Nov 15", "Nov 15–16", "Nov 30 – Dec 1". */
export function eventDates(start: string, end: string | null): string {
  const a = parts(start);
  if (!end || end === start) return `${DAYS[a.w].slice(0, 3)}, ${MONTHS[a.m]} ${a.d}`;
  const b = parts(end);
  return a.m === b.m ? `${MONTHS[a.m]} ${a.d}–${b.d}` : `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}`;
}

export const countdown = (days: number) => (days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
export const ordinal = (k: number) => { const s = ["th", "st", "nd", "rd"], v = k % 100; return `${k}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
const pct = (c: { calls: number; right: number }) => `${Math.round((c.right / c.calls) * 100)}%`;
const record = (r: NonNullable<TeamWeek["record"]>) => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
const teamLabel = (t: { team: number; teamName: string | null }) => (t.teamName ? `${t.team} ${t.teamName}` : String(t.team));
const SEAT: Record<string, string> = { captain: "captain", pick1: "first pick", pick2: "second pick", backup: "backup" };

/** "Won the event", "Finalist", "Alliance 3 captain". */
export function playoffText(p: TeamWeek["playoff"]): string | null {
  if (!p) return null;
  if (p.kind !== "alliance") return p.kind === "winner" ? "Won the event" : "Finalist";
  return `Alliance ${p.number} ${SEAT[p.seat]}`;
}

export type Trend = "up" | "down" | "flat";
export function oprTrend(t: TeamWeek, flat = 1): { trend: Trend; text: string } | null {
  if (t.opr == null) return null;
  if (t.oprBefore == null) return { trend: "flat", text: `OPR ${t.opr.toFixed(1)}, first event this season` };
  const d = t.opr - t.oprBefore;
  const trend: Trend = Math.abs(d) < flat ? "flat" : d > 0 ? "up" : "down";
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  return { trend, text: `OPR ${t.opr.toFixed(1)} ${arrow} from ${t.oprBefore.toFixed(1)}` };
}

/** "↑3", "↓2", "—", "New". */
export const moveText = (m: Movement | null) => (!m ? "—" : m.kind === "up" ? `↑${m.by}` : m.kind === "down" ? `↓${m.by}` : m.kind === "new" ? "New" : "—");

/** Short event name for a subject line: "NJ Qualifier" stays, a long name is cut at a word. */
const shortName = (s: string, max = 40) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")}…`);

/** The subject's headline, by priority: a finish, the week's record, a perfect week of calls, the next event, the rankings. */
export function headline(d: DigestData): string {
  const done = d.results.filter((r) => r.finished);
  const win = done.find((r) => r.playoff?.kind === "winner");
  if (win) return `${win.team} wins ${shortName(win.event)}`;
  const fin = done.find((r) => r.playoff?.kind === "finalist");
  if (fin) return `${fin.team} reaches the final at ${shortName(fin.event)}`;
  const seeded = done.filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank! || a.team - b.team)[0];
  if (seeded && seeded.rank! <= 4) return `${seeded.team} is the ${ordinal(seeded.rank!)} seed at ${shortName(seeded.event)}`;
  const recs = d.results.map((r) => r.record).filter((r): r is NonNullable<TeamWeek["record"]> => !!r);
  if (recs.length) {
    const sum = recs.reduce((a, r) => ({ wins: a.wins + r.wins, losses: a.losses + r.losses, ties: a.ties + r.ties }), { wins: 0, losses: 0, ties: 0 });
    if (sum.wins + sum.losses + sum.ties > 0) return d.results.length === 1 && new Set(d.results.map((r) => r.team)).size === 1
      ? `${d.results[0].team} goes ${record(sum)} at ${shortName(d.results[0].event)}`
      : `Your teams went ${record(sum)}`;
  }
  if (d.predictions && d.predictions.week.calls >= 3 && d.predictions.week.right === d.predictions.week.calls) return `a perfect week of calls, ${d.predictions.week.right} of ${d.predictions.week.calls}`;
  const next = d.upcoming[0];
  if (next) return `${shortName(next.event)} starts ${next.inDays <= 0 ? "today" : next.inDays === 1 ? "tomorrow" : next.inDays < 7 ? DAYS[parts(next.start).w] : `${MONTHS[parts(next.start).m]} ${parts(next.start).d}`}`;
  const ranked = d.rankings && !d.rankings.fallback ? d.rankings.rows[0] : null;
  if (ranked) return `${ranked.team} is #${ranked.rank} in the power rankings`;
  if (d.predictions) return `${d.predictions.week.right} of ${d.predictions.week.calls} calls right`;
  return "the power rankings moved";
}

export const subjectOf = (d: DigestData) => `Your Control Scout week: ${headline(d)}`;

/** The line under the greeting: what this email holds, in one sentence. */
export function intro(d: DigestData): string {
  const teams = [...new Set(d.results.map((r) => r.team))];
  const bits: string[] = [];
  if (teams.length) bits.push(`${teams.length === 1 ? teams[0] : `${teams.length} of your teams`} played last week`);
  const events = new Set(d.upcoming.map((u) => `${u.season}:${u.code}`)).size + (d.moreUpcoming ? 1 : 0);
  if (events) bits.push(`${events === 1 ? "one event is" : `${events}${d.moreUpcoming ? "+" : ""} events are`} coming up in the next two weeks`);
  if (bits.length) return `${bits.join(", and ").replace(/^./, (c) => c.toUpperCase())}. Here's the rundown.`;
  return "Here's how the predictions and power rankings went for your teams.";
}

/** The check-in's verdict, plain about a bad week. */
export function callsVerdict(c: { calls: number; right: number }): string {
  const r = c.right / c.calls;
  if (r === 1) return "Every call right.";
  if (r >= 0.75) return "A strong week for the model.";
  if (r >= 0.6) return "About as expected.";
  if (r >= 0.5) return "A below-par week for the model.";
  return "A rough week for the model: more calls wrong than usual.";
}

const url = (site: string, path: string) => `${site}${path}`;
const eventPath = (season: number, code: string) => `/events/${season}/${encodeURIComponent(code)}`;

// ---------------------------------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------------------------------

export function renderText(d: DigestData, k: Links): string {
  const out: string[] = [];
  out.push(`Hi ${d.name ?? "there"},`, "", intro(d), `Week of ${weekLabel(d.from, d.to)} (Monday to Sunday).`, "");
  if (d.results.length) {
    out.push("YOUR TEAMS' WEEK", "");
    for (const r of d.results.slice(0, MAX_RESULTS)) {
      const facts = [r.record && record(r.record), r.rank != null && (r.finished ? `${ordinal(r.rank)} seed` : `ranked ${ordinal(r.rank)} so far`), playoffText(r.playoff), oprTrend(r)?.text].filter(Boolean);
      out.push(`${teamLabel(r)} at ${r.event}`, `  ${facts.join(" · ") || "Results posted"}`, `  ${url(k.site, eventPath(r.season, r.code))}`, "");
    }
    const more = d.results.length - MAX_RESULTS;
    if (more > 0) out.push(`${more} more played last week: ${url(k.site, "/my-team")}`, "");
  }
  if (d.predictions) {
    const w = d.predictions.week, s = d.predictions.season;
    out.push("PREDICTION CHECK-IN", "", `This week: ${w.right} of ${w.calls} calls right (${pct(w)}). ${callsVerdict(w)}`,
      `Season: ${s.right} of ${s.calls} calls right (${pct(s)}) on your teams' matches.`, `How the predictions work: ${url(k.site, "/methodology#accuracy")}`, "");
  }
  if (d.upcoming.length) {
    out.push("COMING UP", "");
    for (const u of d.upcoming) {
      out.push(`${eventDates(u.start, u.end)} (${countdown(u.inDays)}): ${u.event}${u.city || u.state ? `, ${[u.city, u.state].filter(Boolean).join(", ")}` : ""}`,
        `  ${teamLabel(u)}${u.scheduled ? "" : " · schedule not posted yet"}`, `  ${url(k.site, eventPath(u.season, u.code))}`, "");
    }
    if (d.moreUpcoming) out.push(`${d.moreUpcoming} more: ${url(k.site, "/my-team")}`, "");
  }
  if (d.rankings) {
    out.push("POWER RANKINGS", "");
    if (d.rankings.fallback) out.push("None of your teams are in this week's top 25. The biggest movers:");
    for (const r of d.rankings.rows) out.push(`#${r.rank} ${teamLabel(r)} (${moveText(r.movement)} from last week)`);
    out.push(`Full list: ${url(k.site, `/power-rankings/${d.rankings.week}`)}`, "");
  }
  out.push("See you at the next event,", "The Control Scout team", "", "---",
    `You're getting this because you turned on the weekly digest for ${k.email}.`,
    `Unsubscribe: ${k.unsubscribe}`, `Manage email preferences: ${url(k.site, "/settings?section=notifications")}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------

const a = (href: string, text: string, style = "") => `<a href="${esc(href)}" class="cs-link" style="color:${L.link};text-decoration:none;font-weight:600;${style}">${text}</a>`;
const chip = (text: string) => `<span class="cs-chip" style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border-radius:999px;background:${L.chip};color:${L.text};font-size:13px;line-height:18px;font-weight:600;white-space:nowrap">${esc(text)}</span>`;
const trendColor = (t: Trend) => (t === "up" ? L.up : t === "down" ? L.down : L.flat);
const trendClass = (t: Trend) => `cs-${t}`;

function h2(title: string, note?: string): string {
  return `<tr><td style="padding:32px 32px 4px" class="cs-pad">
    <h2 class="cs-text" style="margin:0;font-family:${DISPLAY};font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.2px;color:${L.text}">${esc(title)}</h2>
    ${note ? `<p class="cs-muted" style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:${L.muted}">${note}</p>` : ""}
  </td></tr>`;
}

/** One item row: a hairline above, then its lines. */
function item(inner: string): string {
  return `<tr><td style="padding:0 32px" class="cs-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td class="cs-line" style="padding:16px 0;border-top:1px solid ${L.line};font-family:${FONT}">${inner}</td></tr></table></td></tr>`;
}

const teamLine = (t: { team: number; teamName: string | null }, site: string) =>
  `<div style="font-size:16px;line-height:24px"><a href="${esc(url(site, `/teams/${t.team}`))}" class="cs-text" style="color:${L.text};text-decoration:none;font-weight:700">${t.team}</a>${t.teamName ? `<span class="cs-muted" style="color:${L.muted}"> ${esc(t.teamName)}</span>` : ""}</div>`;

function resultItem(r: TeamWeek, site: string): string {
  const chips = [r.record && `${record(r.record)} record`, r.rank != null && (r.finished ? `${ordinal(r.rank)} seed` : `${ordinal(r.rank)} so far`), playoffText(r.playoff)]
    .filter((x): x is string => !!x).map(chip).join("");
  const t = oprTrend(r);
  return item(`${teamLine(r, site)}
    <div style="margin-top:2px;font-size:15px;line-height:22px">${a(url(site, eventPath(r.season, r.code)), esc(r.event))}${r.finished ? "" : `<span class="cs-muted" style="color:${L.muted};font-weight:400"> · still going</span>`}</div>
    ${chips ? `<div style="margin-top:10px;font-size:0;line-height:0">${chips}</div>` : ""}
    ${t ? `<div class="${trendClass(t.trend)}" style="margin-top:${chips ? 2 : 10}px;font-size:14px;line-height:20px;font-weight:600;color:${trendColor(t.trend)}">${esc(t.text)}</div>` : ""}`);
}

function upcomingItem(u: Upcoming, site: string): string {
  const place = [u.city, u.state].filter(Boolean).join(", ");
  return item(`<div class="cs-muted" style="font-size:13px;line-height:18px;font-weight:600;letter-spacing:0.2px;color:${L.muted}">${esc(eventDates(u.start, u.end))} · <span class="cs-text" style="color:${L.text}">${esc(countdown(u.inDays))}</span></div>
    <div style="margin-top:4px;font-size:16px;line-height:24px">${a(url(site, eventPath(u.season, u.code)), esc(u.event))}</div>
    <div class="cs-muted" style="margin-top:2px;font-size:14px;line-height:21px;color:${L.muted}">${esc(teamLabel(u))}${place ? ` · ${esc(place)}` : ""}${u.scheduled ? "" : " · schedule not posted yet"}</div>`);
}

function rankingItem(r: RankingRow, site: string): string {
  const m = r.movement;
  const tone = m?.kind === "up" ? "up" : m?.kind === "down" ? "down" : "flat";
  return item(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="56" valign="top" class="cs-text" style="font-family:${DISPLAY};font-size:22px;line-height:26px;font-weight:700;color:${L.text}">#${r.rank}</td>
    <td valign="top" style="font-family:${FONT}">${teamLine(r, site)}</td>
    <td width="64" align="right" valign="top" class="cs-${tone}" style="font-family:${FONT};font-size:15px;line-height:24px;font-weight:700;color:${trendColor(tone)};white-space:nowrap">${esc(moveText(m))}</td>
  </tr></table>`);
}

function moreLink(text: string, href: string): string {
  return `<tr><td style="padding:4px 32px 0" class="cs-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td class="cs-line" style="padding:14px 0 0;border-top:1px solid ${L.line};font-family:${FONT};font-size:15px;line-height:22px">${a(href, `${esc(text)} &rarr;`, "display:inline-block;padding:4px 0")}</td></tr></table></td></tr>`;
}

function statBlock(big: string, label: string): string {
  return `<tr><td style="padding:12px 32px 0" class="cs-pad"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td class="cs-panel" style="padding:18px 20px;border-radius:12px;background:${L.chip};font-family:${FONT}">
      <div class="cs-text" style="font-family:${DISPLAY};font-size:30px;line-height:36px;font-weight:700;letter-spacing:-0.5px;color:${L.text}">${big}</div>
      <div class="cs-body" style="margin-top:4px;font-size:15px;line-height:22px;color:${L.body}">${label}</div>
    </td></tr></table></td></tr>`;
}

export function renderHtml(d: DigestData, k: Links): string {
  const site = k.site;
  const subject = subjectOf(d);
  const preheader = [
    d.results[0] && `${d.results[0].team}${d.results[0].record ? ` went ${record(d.results[0].record)}` : " played"} at ${d.results[0].event}`,
    d.predictions && `${d.predictions.week.right} of ${d.predictions.week.calls} calls right`,
    d.upcoming[0] && `${d.upcoming[0].event} ${countdown(d.upcoming[0].inDays)}`,
  ].filter(Boolean).join(" · ");
  const rows: string[] = [];

  if (d.results.length) {
    rows.push(h2("Your teams' week", "Record, seed and OPR at each event they played."));
    for (const r of d.results.slice(0, MAX_RESULTS)) rows.push(resultItem(r, site));
    const more = d.results.length - MAX_RESULTS;
    rows.push(moreLink(more > 0 ? `${more} more played last week: see them all` : "See all your teams", url(site, "/my-team")));
  }
  if (d.predictions) {
    const w = d.predictions.week, s = d.predictions.season;
    rows.push(h2("Prediction check-in", "Our pre-match calls on your teams' matches, straight from the public ledger."));
    rows.push(statBlock(`${w.right} of ${w.calls} <span class="cs-muted" style="font-size:18px;font-weight:600;color:${L.muted}">calls right · ${pct(w)}</span>`, esc(callsVerdict(w))));
    rows.push(`<tr><td style="padding:12px 32px 0;font-family:${FONT};font-size:15px;line-height:22px" class="cs-pad cs-body"><span class="cs-body" style="color:${L.body}">Season so far: <strong class="cs-text" style="color:${L.text}">${s.right} of ${s.calls}</strong> right (${pct(s)}).</span></td></tr>`);
    rows.push(moreLink("How the predictions work", url(site, "/methodology#accuracy")));
  }
  if (d.upcoming.length) {
    rows.push(h2("Coming up", "Your teams' events in the next two weeks."));
    for (const u of d.upcoming) rows.push(upcomingItem(u, site));
    rows.push(moreLink(d.moreUpcoming ? `${d.moreUpcoming} more coming up: see them all` : "See your teams' schedule", url(site, "/my-team")));
  }
  if (d.rankings) {
    rows.push(h2("Power rankings", d.rankings.fallback ? "None of your teams are in this week's top 25. The biggest movers:" : `Where your teams stand in ${esc(d.rankings.title)}.`));
    for (const r of d.rankings.rows) rows.push(rankingItem(r, site));
    rows.push(moreLink("See the full power rankings", url(site, `/power-rankings/${d.rankings.week}`)));
  }

  const host = site.replace(/^https?:\/\//, "");
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
a{text-decoration:none}
@media (max-width:620px){.cs-pad{padding-left:20px!important;padding-right:20px!important}.cs-h1{font-size:26px!important;line-height:32px!important}}
@media (prefers-color-scheme:dark){
  .cs-page{background:#0b0b0c!important}.cs-card{background:#151517!important;border-color:#2a2a2f!important}
  .cs-text{color:#f4f4f5!important}.cs-body{color:#d4d4d8!important}.cs-muted{color:#a1a1aa!important}
  .cs-link{color:#ffc700!important}.cs-line{border-color:#2a2a2f!important}.cs-chip,.cs-panel{background:#222226!important;color:#f4f4f5!important}
  .cs-up{color:#4ade80!important}.cs-down{color:#f87171!important}.cs-flat{color:#a1a1aa!important}
}
[data-ogsc] .cs-page{background:#0b0b0c!important}[data-ogsc] .cs-card{background:#151517!important}[data-ogsc] .cs-text{color:#f4f4f5!important}
[data-ogsc] .cs-body{color:#d4d4d8!important}[data-ogsc] .cs-muted{color:#a1a1aa!important}[data-ogsc] .cs-link{color:#ffc700!important}
</style></head>
<body class="cs-page" style="margin:0;padding:0;background:${L.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}${"&#8204;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cs-page" style="background:${L.page}"><tr><td align="center" style="padding:32px 12px 40px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
    <tr><td align="center" style="padding:0 0 24px">
      <a href="${esc(site)}" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:30px;height:30px;line-height:0;background:${L.gold};border-radius:8px"><img src="${esc(site)}/logo.png" width="30" height="30" alt="" style="display:block;width:30px;height:30px;border:0;border-radius:8px"></td>
        <td class="cs-text" style="padding-left:10px;font-family:${DISPLAY};font-size:19px;font-weight:700;letter-spacing:-0.3px;color:${L.text}">Control Scout</td>
        <td class="cs-line" style="padding-left:12px;border-right:1px solid ${L.line};font-size:0">&nbsp;</td>
        <td class="cs-muted" style="padding-left:12px;font-family:${FONT};font-size:17px;color:${L.muted}">Weekly</td>
      </tr></table></a>
    </td></tr>
    <tr><td class="cs-card" style="background:${L.card};border:1px solid ${L.line};border-radius:18px;overflow:hidden">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="height:4px;background:${L.gold};font-size:0;line-height:0;border-radius:18px 18px 0 0">&nbsp;</td></tr>
        <tr><td style="padding:36px 32px 0" class="cs-pad">
          <h1 class="cs-text cs-h1" style="margin:0;font-family:${DISPLAY};font-size:30px;line-height:36px;font-weight:700;letter-spacing:-0.6px;color:${L.text}">Your week in Control Scout</h1>
          <p class="cs-muted" style="margin:6px 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${L.muted}">${esc(weekLabel(d.from, d.to))}</p>
          <p class="cs-text" style="margin:24px 0 0;font-family:${FONT};font-size:17px;line-height:26px;color:${L.text}">Hi ${d.name ? `<strong>${esc(d.name)}</strong>` : "there"},</p>
          <p class="cs-body" style="margin:8px 0 0;font-family:${FONT};font-size:17px;line-height:27px;color:${L.body}">${esc(intro(d))}</p>
        </td></tr>
        ${rows.join("\n")}
        <tr><td style="padding:36px 32px 0" class="cs-pad">
          <p class="cs-body" style="margin:0;font-family:${FONT};font-size:17px;line-height:26px;color:${L.body}">See you at the next event,</p>
          <p class="cs-text" style="margin:2px 0 0;font-family:${FONT};font-size:17px;line-height:26px;font-weight:700;color:${L.text}">The Control Scout team</p>
        </td></tr>
        <tr><td style="padding:24px 32px 36px" class="cs-pad">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${L.gold}">
            <a href="${esc(site)}" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:#18181b;text-decoration:none;border-radius:10px">Open Control Scout &rarr;</a>
          </td></tr></table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:24px 16px 0;font-family:${FONT}">
      <p class="cs-muted" style="margin:0;font-size:13px;line-height:20px;color:${L.muted}">You're getting this because you turned on the weekly digest for <span class="cs-text" style="color:${L.text}">${esc(k.email)}</span>.<br>It only comes when there's something to report.</p>
      <p style="margin:12px 0 0;font-size:13px;line-height:20px">
        <a href="${esc(k.unsubscribe)}" class="cs-muted" style="display:inline-block;padding:6px 8px;color:${L.muted};text-decoration:underline">Unsubscribe</a>
        <span class="cs-muted" style="color:${L.muted}">·</span>
        <a href="${esc(url(site, "/settings?section=notifications"))}" class="cs-muted" style="display:inline-block;padding:6px 8px;color:${L.muted};text-decoration:underline">Manage email preferences</a>
      </p>
      <p class="cs-muted" style="margin:10px 0 0;font-size:12px;line-height:18px;color:${L.muted}">Control Scout · Free FTC scouting and match predictions · <a href="${esc(site)}" class="cs-muted" style="color:${L.muted};text-decoration:none">${esc(host)}</a></p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function renderDigest(d: DigestData, k: Links): { subject: string; text: string; html: string } {
  return { subject: subjectOf(d), text: renderText(d, k), html: renderHtml(d, k) };
}
