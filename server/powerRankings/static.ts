// A power-rankings week as plain HTML, for the first HTML response (server/bootShell.ts): crawlers
// and link previews that don't run the app still read every team, blurb and number, and a visitor
// sees the list before the app has loaded. The app's first render replaces it.
// Blurbs and the intro are already safe HTML (./markdown.ts); everything else is escaped here.
import { longDate, movementText, weekLabel, type PowerRankingsResponse } from "../../src/shared/powerRankings.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const one = (x: number | null) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));

export function staticRankingsHtml(r: PowerRankingsResponse): string {
  const w = r.week;
  const parts: string[] = [];
  if (w) {
    parts.push(`<p class="csb-pr-when">${esc(weekLabel(w.week))} · Published ${esc(longDate(w.published))}</p>`);
    if (w.sample) parts.push(`<p class="csb-pr-when"><b>SAMPLE</b>: development content, not real rankings.</p>`);
    parts.push(`<div class="csb-pr-intro">${w.introHtml}</div>`);
    parts.push(`<ol class="csb-pr">${w.entries.map((e) => {
      const s = e.stats;
      const nums = s ? `Rating ${one(s.rating)}${s.ratingRank ? ` (#${s.ratingRank.toLocaleString("en-US")} worldwide)` : ""} · OPR ${one(s.opr)} · ${s.wins}-${s.losses}-${s.ties}` : "No matches this season yet";
      const move = movementText(e.movement);
      return `<li><h2><span>${e.rank}.</span> <a href="/teams/${e.team}">${e.team}${e.name ? ` ${esc(e.name)}` : ""}</a>${move ? ` <small>${esc(move)}</small>` : ""}</h2>`
        + `${e.place ? `<p>${esc(e.place)}</p>` : ""}<div>${e.blurbHtml}</div><p>${esc(nums)}</p></li>`;
    }).join("")}</ol>`);
  } else {
    parts.push(`<p class="csb-pr-when">No power rankings are published yet. The first week will show here.</p>`);
  }
  parts.push(`<p><a href="/rankings">See every team in the world rankings</a></p>`);
  if (r.archive.length) {
    parts.push(`<h2>All weeks</h2><ul class="csb-pr-arch">${r.archive.map((a) =>
      `<li><a href="/power-rankings/${esc(a.week)}">${esc(a.title)}</a> · ${esc(longDate(a.published))}</li>`).join("")}</ul>`);
  }
  return parts.join("");
}
