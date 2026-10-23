// A team page's title and heading, the same in the server's first HTML (server/seoMeta.ts) and in the app
// (src/pages/TeamPage.tsx), so a search engine that runs the page reads the title the first response had.
// The number and name lead: they're what people search for ("4215 hypnotic robotics").

/** "4215 Hypnotic Robotics": the team's heading. */
export const teamHeading = (n: number, name?: string | null) => (name?.trim() ? `${n} ${name.trim()}` : `FTC team ${n}`);

/** "4215 Hypnotic Robotics — FTC team stats, OPR & predictions" (the site name is added after it). */
export const teamTitle = (n: number, name?: string | null) =>
  name?.trim() ? `${teamHeading(n, name)} — FTC team stats, OPR & predictions` : `${teamHeading(n)} — stats, OPR & predictions`;
