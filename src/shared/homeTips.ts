// The tips line at the bottom of Home (src/components/home/HomeTips.tsx): one short tip at a time, a new one every
// TIP_MS. Search tips name a KIND of search, never a query to copy; every kind here answers on the live site. App tips
// point at a page or a Settings section. The free, no-account line (HOME_ABOUT) is one of them.
import { HOME_ABOUT } from "./boot";

export interface HomeTip {
  id: string;
  /** The words before the link (or all of them, with no link). */
  text: string;
  /** A page the tip is about, linked inside the line, then the words after it. */
  link?: { to: string; label: string; after?: string };
  /** Shown only to someone not signed in (it asks them to make an account). */
  signedOut?: boolean;
}

/** How long each tip stays up. */
export const TIP_MS = 10_000;

export const HOME_TIPS: readonly HomeTip[] = Object.freeze([
  { id: "about", text: HOME_ABOUT },
  // Search: kinds of question, no query to copy.
  { id: "compare", text: "Search can compare up to four teams on any stat." },
  { id: "seasons", text: "Ask about a range of seasons, not just this one." },
  { id: "narrow", text: "Add “not rookies” or “no penalties” to narrow a list." },
  { id: "rules", text: "Ask rules questions and get the answer from the game manual." },
  { id: "videos", text: "Search finds match videos and highlights for a team, an event or a place." },
  { id: "awards", text: "Ask who won an award at an event, or which awards a team has won." },
  { id: "next", text: "Ask for a team’s next match to see when it plays." },
  { id: "places", text: "Rank the teams in any state or country by any stat." },
  { id: "typos", text: "Typos are fine: search suggests what you meant." },
  // The app.
  { id: "appearance", text: "Change the theme and background in ", link: { to: "/settings#appearance", label: "Settings › Appearance", after: "." } },
  { id: "account", text: "Make an account to keep your teams and data on all your devices. ", link: { to: "/settings#account", label: "Sign in", after: "" }, signedOut: true },
  { id: "track", text: "Track a team from its page to keep it in ", link: { to: "/my-teams", label: "My teams", after: "." } },
  { id: "shortlist", text: "Add teams to your Shortlist, then line them up in ", link: { to: "/compare", label: "Compare", after: "." } },
  { id: "offline", text: "Save a season on this device to look things up with no signal: ", link: { to: "/download", label: "Offline", after: "." } },
  { id: "lite", text: "On a weak signal, event and team pages offer a light version that loads fast." },
  { id: "notify", text: "Get match reminders and event starts as ", link: { to: "/settings#notifications", label: "notifications", after: "." } },
  { id: "predict", text: "See who’s likely to win any match on ", link: { to: "/predict", label: "Predict", after: "." } },
  { id: "scout", text: "Scout an event match by match with your team on ", link: { to: "/scout", label: "Scout", after: "." } },
  { id: "bug", text: "Spot something wrong? The bug button in the corner sends it to us." },
]);

/** The tips for this visitor: the account one only while signed out. */
export const tipsFor = (signedIn: boolean): HomeTip[] => HOME_TIPS.filter((t) => !(t.signedOut && signedIn));
