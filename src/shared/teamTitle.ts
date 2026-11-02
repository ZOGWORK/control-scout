// A team page's title and heading, the same in the server's first HTML (server/seoMeta.ts) and in the app
// (src/pages/TeamPage.tsx), so a search engine that runs the page reads the title the first response had.
// The number and name lead: they're what people search for ("4215 hypnotic robotics").

/** "4215 Hypnotic Robotics": the team's heading. */
export const teamHeading = (n: number, name?: string | null) => (name?.trim() ? `${n} ${name.trim()}` : `FTC team ${n}`);

/** "4215 Hypnotic Robotics | FTC Team Stats, OPR & Rankings": number and name, then what the page is (the site name
 *  is added after it by siteTitle). */
export const teamTitle = (n: number, name?: string | null) => `${teamHeading(n, name)} | FTC Team Stats, OPR & Rankings`;

/** A page title with the site's name: "… | Control Scout" after a title already in "|" parts (a team's), else
 *  "… · Control Scout". */
export const siteTitle = (title: string) => `${title}${title.includes(" | ") ? " | " : " · "}Control Scout`;

/** A team's name without its own number repeated at either end ("Simply Complex 18061" → "Simply Complex"; FIRST
 *  stores some names that way), so a title never shows the number twice. Null when the name is only its number. */
export function cleanTeamName(n: number, name?: string | null): string | null {
  const num = String(n);
  const ws = (name ?? "").trim().split(/\s+/).filter(Boolean);
  while (ws.length && ws[0].replace(/^#/, "") === num) ws.shift();
  while (ws.length && ws[ws.length - 1].replace(/^#/, "") === num) ws.pop();
  return ws.length ? ws.join(" ") : null;
}

/** "18061 | Simply Complex": a team as search lists it (server, app and offline search alike), number and name each
 *  once. Only the number when there's no name. */
export const searchTeamTitle = (n: number, name?: string | null) => { const c = cleanTeamName(n, name); return c ? `${n} | ${c}` : String(n); };

/** The name part of a search title ("18061 | Simply Complex" → "Simply Complex"; an older "4215 Hypnotic Robotics"
 *  reads the same way): the title when it has no leading number. */
export const teamNameOf = (title: string) => title.replace(/^\d+\s*(?:\|\s*)?/, "").trim();

/** A search title as words in a sentence ("18061 | Simply Complex" → "18061 Simply Complex"). */
export const teamWords = (title: string) => title.replace(/^(\d+)\s*\|\s*/, "$1 ");
