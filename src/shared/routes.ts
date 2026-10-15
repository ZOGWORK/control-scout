// The app's routes as plain data, shared by the web app and the server.
// The server uses them to put the current page's code chunk in the first HTML
// (<link rel="modulepreload">) and to title the static first paint; the app
// uses them to load that chunk before its first render (src/main.tsx) and for
// the top bar's page name (Shell). Keep in step with the <Routes> in main.tsx.

/** A lazily loaded page module under src/pages (the file name without .tsx). */
export type PageModule =
  | "TeamPage" | "EventsPage" | "RecordsPage" | "EventPage" | "PredictPage" | "ComparePage" | "MyTeamPage"
  | "ShortlistPage" | "ScoutPage" | "DownloadPage" | "SettingsPage" | "MethodologyPage" | "NotFound";

// React Router matches case-insensitively, a trailing slash included: so do these.
const ROUTES: [RegExp, PageModule | null][] = [
  [/^\/$/, null], // Home is in the main bundle.
  [/^\/(teams|matches)\/?$/i, "RecordsPage"],
  [/^\/teams\/[^/]+\/?$/i, "TeamPage"],
  [/^\/events\/?$/i, "EventsPage"],
  [/^\/events\/[^/]+\/[^/]+\/?$/i, "EventPage"],
  [/^\/predict\/?$/i, "PredictPage"],
  [/^\/predict\/accuracy\/?$/i, null], // a redirect to /methodology
  [/^\/compare\/?$/i, "ComparePage"],
  [/^\/my-team\/?$/i, "MyTeamPage"],
  [/^\/shortlist\/?$/i, "ShortlistPage"],
  [/^\/scout\/?$/i, "ScoutPage"],
  [/^\/download\/?$/i, "DownloadPage"],
  [/^\/settings\/?$/i, "SettingsPage"],
  [/^\/(methodology|predict\/how-it-works)\/?$/i, "MethodologyPage"],
];

/** The lazy page module a path renders (null: Home or a redirect, nothing to load). */
export function pageModule(path: string): PageModule | null {
  for (const [re, mod] of ROUTES) if (re.test(path)) return mod;
  return "NotFound";
}

const TITLES: [RegExp, string][] = [
  [/^\/teams\//, "Team"], [/^\/teams$/, "Teams"], [/^\/matches$/, "Match records"], [/^\/events\/\d/, "Event"], [/^\/events/, "Events"], [/^\/predict\/how-it-works/, "How it works"], [/^\/predict/, "Predict"],
  [/^\/compare/, "Compare"], [/^\/my-team/, "My team"], [/^\/shortlist/, "Shortlist"], [/^\/scout/, "Scout"], [/^\/download/, "Download"],
  [/^\/settings/, "Settings"], [/^\/methodology/, "How it works"],
];

/** The page's short name in the top bar ("Control Scout / Events"). */
export const pageTitle = (path: string) => TITLES.find(([re]) => re.test(path))?.[1] ?? "Home";
