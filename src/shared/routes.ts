// The app's routes as plain data, shared by the web app and the server.
// The server uses them to put the current page's code chunk in the first HTML
// (<link rel="modulepreload">) and to title the static first paint; the app
// uses them to load that chunk before its first render (src/main.tsx) and for
// the top bar's page name (Shell). Keep in step with the <Routes> in main.tsx.

/** A lazily loaded page module under src/pages (the file name without .tsx). */
export type PageModule =
  | "TeamPage" | "EventsPage" | "RecordsPage" | "RankingsPage" | "EventPage" | "PredictPage" | "ComparePage" | "MyTeamPage" | "MyTeamsPage"
  | "ShortlistPage" | "ScoutPage" | "DownloadPage" | "SettingsPage" | "MethodologyPage" | "PrivacyPage" | "TermsPage" | "ContactPage" | "FaqPage" | "MatchReportPage" | "PowerRankingsPage" | "EventDisplayPage" | "EventOverlayPage" | "NotFound";

// React Router matches case-insensitively, a trailing slash included: so do these.
const ROUTES: [RegExp, PageModule | null][] = [
  [/^\/$/, null], // Home is in the main bundle.
  [/^\/(teams|matches)\/?$/i, "RecordsPage"],
  [/^\/teams\/[^/]+\/?$/i, "TeamPage"],
  [/^\/rankings\/?$/i, "RankingsPage"],
  [/^\/events\/?$/i, "EventsPage"],
  [/^\/events\/[^/]+\/[^/]+\/?$/i, "EventPage"],
  [/^\/events\/[^/]+\/[^/]+\/match\/[^/]+\/?$/i, "MatchReportPage"],
  [/^\/events\/[^/]+\/[^/]+\/display\/?$/i, "EventDisplayPage"],
  [/^\/events\/[^/]+\/[^/]+\/overlay\/?$/i, "EventOverlayPage"],
  [/^\/predict\/?$/i, "PredictPage"],
  [/^\/predict\/accuracy\/?$/i, null], // a redirect to /methodology
  [/^\/compare\/?$/i, "ComparePage"],
  [/^\/my-team\/?$/i, "MyTeamPage"],
  [/^\/my-teams\/?$/i, "MyTeamsPage"],
  [/^\/shortlist\/?$/i, "ShortlistPage"],
  [/^\/scout\/?$/i, "ScoutPage"],
  [/^\/download\/?$/i, "DownloadPage"],
  [/^\/settings\/?$/i, "SettingsPage"],
  [/^\/(methodology|predict\/how-it-works)\/?$/i, "MethodologyPage"],
  [/^\/privacy\/?$/i, "PrivacyPage"],
  [/^\/terms\/?$/i, "TermsPage"],
  [/^\/contact\/?$/i, "ContactPage"],
  [/^\/faq\/?$/i, "FaqPage"],
  [/^\/power-rankings(\/[^/]+)?\/?$/i, "PowerRankingsPage"],
];

/** The lazy page module a path renders (null: Home or a redirect, nothing to load). */
export function pageModule(path: string): PageModule | null {
  for (const [re, mod] of ROUTES) if (re.test(path)) return mod;
  return "NotFound";
}

// Whole routes, so an unknown path under a real one (/teams/4215/extra) reads "Not found".
const TITLES: [RegExp, string][] = [
  [/^\/events\/[^/]+\/[^/]+\/match\/[^/]+$/, "Match report"],
  [/^\/events\/[^/]+\/[^/]+\/display$/, "Pit display"],
  [/^\/events\/[^/]+\/[^/]+\/overlay$/, "Stream overlay"],
  [/^\/teams\/[^/]+$/, "Team"], [/^\/teams$/, "Teams"], [/^\/rankings$/, "Rankings"], [/^\/matches$/, "Match records"], [/^\/events\/[^/]+\/[^/]+$/, "Event"], [/^\/events$/, "Events"], [/^\/predict\/how-it-works$/, "How it works"], [/^\/predict(\/accuracy)?$/, "Predict"],
  [/^\/compare$/, "Compare"], [/^\/my-team$/, "My team"], [/^\/my-teams$/, "My teams"], [/^\/shortlist$/, "Shortlist"], [/^\/scout$/, "Scout"], [/^\/download$/, "Download"],
  [/^\/settings$/, "Settings"], [/^\/methodology$/, "How it works"], [/^\/privacy$/, "Privacy"], [/^\/terms$/, "Terms"], [/^\/contact$/, "Contact"], [/^\/faq$/, "FAQ"],
  [/^\/power-rankings(\/[^/]+)?$/, "Power rankings"],
];

/** The page's short name in the top bar ("Control Scout / Events"); any other path is the not-found page.
 *  Matched without case and with a trailing slash dropped, as React Router does. */
export const pageTitle = (path: string) => {
  const p = path.toLowerCase().replace(/(.)\/+$/, "$1");
  return TITLES.find(([re]) => re.test(p))?.[1] ?? (p === "/" ? "Home" : "Not found");
};

/** Pages drawn without the site's chrome (no sidebar, top bar, footer or prompts): the pit display, a
 *  fullscreen screen for a pit TV, and the stream overlay. Matched as React Router does (any case, a trailing slash allowed). */
export const isBareRoute = (path: string) => /^\/events\/[^/]+\/[^/]+\/(display|overlay)\/?$/i.test(path);

/** The stream overlay (an OBS browser source over the video): bare, and see-through, so no page colour under it either. */
export const isOverlayRoute = (path: string) => /^\/events\/[^/]+\/[^/]+\/overlay\/?$/i.test(path);
