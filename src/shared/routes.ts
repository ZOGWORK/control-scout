// The app's routes as plain data, shared by the web app and the server.
// The server uses them to put the current page's code chunk in the first HTML
// (<link rel="modulepreload">) and to title the static first paint; the app
// uses them to load that chunk before its first render (src/main.tsx) and for
// the top bar's page name (Shell). Keep in step with the <Routes> in main.tsx.

/** A lazily loaded page module under src/pages (the file name without .tsx). */
export type PageModule =
  | "TeamPage" | "EventsPage" | "RecordsPage" | "RankingsPage" | "EventPage" | "PredictPage" | "ComparePage" | "MyTeamPage" | "MyTeamsPage"
  | "ShortlistPage" | "ScoutPage" | "DownloadPage" | "SettingsPage" | "MethodologyPage" | "SearchDocsPage" | "PrivacyPage" | "TermsPage" | "ContactPage" | "DonatePage" | "StatusPage" | "SupportersPage" | "FaqPage" | "RulesPage" | "MatchReportPage" | "PowerRankingsPage" | "EventDisplayPage" | "EventCodeRedirect" | "DigestUnsubscribedPage" | "BundlePage" | "SearchPage" | "RelatedSearchesPage" | "LeaguePage" | "TeamHighlightsPage" | "TeamRecordSplitPage" | "EventHighlightsPage" | "ContributorPage" | "GetVerifiedPage" | "VerifyVideoPage" | "NotFound";

// React Router matches case-insensitively, a trailing slash included: so do these.
const ROUTES: [RegExp, PageModule | null][] = [
  [/^\/$/, null], // Home is in the main bundle.
  [/^\/(teams|matches)\/?$/i, "RecordsPage"],
  [/^\/teams\/[^/]+\/?$/i, "TeamPage"],
  [/^\/teams\/[^/]+\/highlights\/?$/i, "TeamHighlightsPage"],
  [/^\/teams\/[^/]+\/record-split\/?$/i, "TeamRecordSplitPage"],
  [/^\/rankings\/?$/i, "RankingsPage"],
  [/^\/events\/?$/i, "EventsPage"],
  // A season alone (/events/2025) is no event: the page not found, as EventCodeRedirect renders it.
  [/^\/events\/(?!\d{4}\/?$)[^/]+\/?$/i, "EventCodeRedirect"],
  [/^\/events\/[^/]+\/[^/]+\/?$/i, "EventPage"],
  [/^\/events\/[^/]+\/[^/]+\/match\/[^/]+\/?$/i, "MatchReportPage"],
  [/^\/events\/[^/]+\/[^/]+\/display\/?$/i, "EventDisplayPage"],
  [/^\/events\/[^/]+\/[^/]+\/highlights\/?$/i, "EventHighlightsPage"],
  [/^\/predict\/?$/i, "PredictPage"],
  [/^\/predict\/accuracy\/?$/i, null], // a redirect to /methodology
  [/^\/compare\/?$/i, "ComparePage"],
  [/^\/my-team\/?$/i, "MyTeamPage"],
  [/^\/my-teams\/?$/i, "MyTeamsPage"],
  [/^\/shortlist\/?$/i, "ShortlistPage"],
  [/^\/scout\/?$/i, "ScoutPage"],
  [/^\/download\/?$/i, "DownloadPage"],
  [/^\/bundle\/[^/]+\/[^/]+(\/picklist)?\/?$/i, "BundlePage"],
  [/^\/settings\/?$/i, "SettingsPage"],
  [/^\/methodology\/?$/i, "MethodologyPage"],
  [/^\/how-it-works\/search\/?$/i, "SearchDocsPage"],
  [/^\/predict\/how-it-works\/?$/i, null], // a redirect to /methodology
  [/^\/how-it-works\/?$/i, null], // a redirect to /methodology (How it works opens on Predictions)
  [/^\/privacy\/?$/i, "PrivacyPage"],
  [/^\/terms\/?$/i, "TermsPage"],
  [/^\/contact\/?$/i, "ContactPage"],
  [/^\/donate\/?$/i, "DonatePage"],
  [/^\/support\/?$/i, null], // a redirect to /donate
  [/^\/status\/?$/i, "StatusPage"],
  [/^\/supporters\/?$/i, "SupportersPage"],
  [/^\/faq\/?$/i, "FaqPage"],
  [/^\/rules\/?$/i, "RulesPage"],
  [/^\/power-rankings(\/[^/]+)?\/?$/i, "PowerRankingsPage"],
  [/^\/digest\/unsubscribed\/?$/i, "DigestUnsubscribedPage"],
  [/^\/search\/?$/i, "SearchPage"],
  [/^\/related-searches\/?$/i, "RelatedSearchesPage"],
  [/^\/leagues\/[^/]+\/[^/]+\/[^/]+\/?$/i, "LeaguePage"],
  [/^\/contributors\/[^/]+\/?$/i, "ContributorPage"],
  [/^\/get-verified\/?$/i, "GetVerifiedPage"],
  [/^\/verify-video\/?$/i, "VerifyVideoPage"],
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
  [/^\/events\/[^/]+\/[^/]+\/highlights$/, "Event highlights"],
  [/^\/teams\/[^/]+\/highlights$/, "Team highlights"], [/^\/teams\/[^/]+\/record-split$/, "Team record"], [/^\/teams\/[^/]+$/, "Team"], [/^\/teams$/, "Teams"], [/^\/rankings$/, "Rankings"], [/^\/matches$/, "Match records"], [/^\/events\/[^/]+\/[^/]+$/, "Event"], [/^\/events$/, "Events"], [/^\/predict(\/accuracy)?$/, "Predict"],
  [/^\/compare$/, "Compare"], [/^\/my-team$/, "My team"], [/^\/my-teams$/, "My teams"], [/^\/shortlist$/, "Shortlist"], [/^\/scout$/, "Scout"], [/^\/download$/, "Download"],
  [/^\/bundle\/[^/]+\/[^/]+$/, "Event-day bundle"], [/^\/bundle\/[^/]+\/[^/]+\/picklist$/, "Pick list snapshot"],
  [/^\/settings$/, "Settings"], [/^\/(methodology|predict\/how-it-works|how-it-works)$/, "How it works"], [/^\/how-it-works\/search$/, "How FTC One Search works"], [/^\/privacy$/, "Privacy"], [/^\/terms$/, "Terms"], [/^\/contact$/, "Contact"], [/^\/(donate|support)$/, "Donate"], [/^\/supporters$/, "Supporters"], [/^\/status$/, "Status"], [/^\/faq$/, "FAQ"], [/^\/rules$/, "Rules"],
  [/^\/power-rankings(\/[^/]+)?$/, "Power rankings"], [/^\/digest\/unsubscribed$/, "Email digest"], [/^\/search$/, "Search"], [/^\/related-searches$/, "Related searches"],
  [/^\/leagues\/[^/]+\/[^/]+\/[^/]+$/, "League"],
  [/^\/contributors\/[^/]+$/, "Contributor"], [/^\/get-verified$/, "Get Verified"], [/^\/verify-video$/, "Contributor invite"],
];

/** The page's short name in the top bar ("Control Scout / Events"); any other path is the not-found page.
 *  Matched without case and with a trailing slash dropped, as React Router does. */
export const pageTitle = (path: string) => {
  const p = path.toLowerCase().replace(/(.)\/+$/, "$1");
  return TITLES.find(([re]) => re.test(p))?.[1] ?? (p === "/" ? "Home" : "Not found");
};

/** Pages drawn without the site's chrome (no sidebar, top bar, footer or prompts): the pit display, a
 *  fullscreen screen for a pit TV. Matched as React Router does (any case, a trailing slash allowed). */
export const isBareRoute = (path: string) => /^\/events\/[^/]+\/[^/]+\/display\/?$/i.test(path);

