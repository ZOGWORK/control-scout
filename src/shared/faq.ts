// The FAQ (/faq): questions and answers in one place, shared by the page, the server's first paint and its
// FAQPage structured data, so all three always say the same thing. Answers follow the code and the other
// pages (Methodology, Privacy, Terms, Download): when a fact changes there, change it here too.
// Answers are plain text with [label](/path) links; faqText() strips them for structured data.

import { discordInviteUrl } from "./discord";

export interface FaqItem { id: string; q: string; a: string[] }
export interface FaqGroup { id: string; title: string; items: FaqItem[] }

/** The Discord bot's answer, with its invite link; none until the link exists. */
export function discordFaq(invite: string | null): FaqItem[] {
  return invite ? [{ id: "discord", q: "Is there a Discord bot?", a: [
    `Yes. [Add Control Scout to your server](${invite}) and anyone there can use /team, /predict, /event and /rankings; every answer links back to the page it came from. /help lists everything.`,
    "To get posts automatically, someone who can manage the server types /follow team: (your number) in a channel: the bot posts there the evening before each event, the team's schedule once it's out, 15 minutes before each match, each result, and a recap at the end of each day. [My teams](/my-teams) has the commands ready to copy.",
    "The bot reads the same data as the site, so its numbers match what you see here. It needs only Send Messages, Embed Links and Use Slash Commands.",
  ] }] : [];
}

export const FAQ: FaqGroup[] = [
  {
    id: "basics", title: "The basics",
    items: [
      { id: "what", q: "What is Control Scout?", a: [
        "Free FTC scouting and predictions for every team: every team, event and match, with win odds and predicted scores for upcoming matches, and a public record of how often those predictions come true.",
        "It's the sister app of [Control Point](https://tryctrlpoint.org), the team workspace app. Both run the same prediction engine and share accounts.",
      ] },
      { id: "cost", q: "Does it cost anything?", a: [
        "No. Control Scout is free, with no paid plans and no ads. See the [terms](/terms#free).",
      ] },
      { id: "account", q: "Do I need an account?", a: [
        "No. Browsing, search and predictions all work without signing in.",
        "An account only syncs your personal things across devices: your team, the teams and events you track, your shortlist (with its notes and team colours), settings, match-video links, saved predictions and your scouting entries.",
      ] },
      { id: "sign-in", q: "How do I sign in?", a: [
        "With a one-time code sent to your email, with Google, or with Control Point (which also offers Discord and GitHub). One account works on both Control Scout and Control Point.",
        "Anything you saved before signing in is merged into the account, so nothing is lost.",
      ] },
      { id: "first", q: "Is Control Scout part of FIRST?", a: [
        "No. Control Scout is not affiliated with or endorsed by FIRST®. FIRST® Tech Challenge is a registered trademark of FIRST, and match data is © FIRST.",
      ] },
    ],
  },
  {
    id: "data", title: "Data and results",
    items: [
      { id: "source", q: "Where does the data come from?", a: [
        "Teams, events, matches, score breakdowns, rankings, alliances and awards come from the official FIRST Events API, with [FTC Scout](https://ftcscout.org) as a fallback when FIRST can't serve an event.",
        "Results and stats go back to 2019–20; predictions cover 2023–24 onward. See [where the data comes from](/methodology#data).",
      ] },
      { id: "fresh", q: "How up to date is it?", a: [
        "The current season syncs every day, and every 15 minutes on event days. While an event is on, results reach the site within about a minute of FIRST publishing them, and an event's page refreshes on its own. Past seasons are frozen once they're complete.",
      ] },
      { id: "wrong", q: "A score or result looks wrong. What do I do?", a: [
        "Scores come from FIRST. If a result is wrong there too, the event's scorekeeper or FIRST fixes it at the source and Control Scout picks the fix up on its next sync.",
        "If it's only wrong here, [tell us](/contact?topic=data) and we'll check it.",
      ] },
      { id: "opr", q: "What is OPR?", a: [
        "Offensive Power Rating: each robot's average contribution to its alliance's score, worked out by least squares over every played qualification match, split into auto, TeleOp, endgame and penalties. The headline OPR counts non-penalty points, and a team's season OPR is its best event OPR.",
        "OPR is shown for reference; predictions use the engine's own ratings. [How OPR is computed](/methodology#opr).",
      ] },
    ],
  },
  {
    id: "predictions", title: "Predictions",
    items: [
      { id: "how", q: "How are matches predicted?", a: [
        "Each robot gets a rating: its expected points, split by game phase, updated after every match. Two alliances' ratings become a win chance and a likely score, and an event is simulated 2,000 times for advancement odds.",
        "The full method is on [How it works](/methodology).",
      ] },
      { id: "confidence", q: "What do rough guess, fair and solid mean?", a: [
        "Every prediction says how much to trust it. Rough guess means at least one robot has played too few matches this season to be rated well, so its rating leans on last season. Solid means every robot has a real record this season and the ratings have settled. Fair is in between.",
        "Even a solid favourite loses sometimes: a win chance is a probability, not a promise. [How the tiers work](/methodology#confidence).",
      ] },
      { id: "accuracy", q: "How accurate are the predictions?", a: [
        "Every call is scored after the match and the record is public: the share of matches called right, Brier score, calibration and more, on [the track record](/methodology#accuracy).",
        "Calls logged before each match (live) and season replays (backtests) are reported separately and never blended.",
      ] },
      { id: "lab", q: "Can I predict a match that isn't scheduled?", a: [
        "Yes. The [Lab](/predict?view=lab) takes any four teams for win odds and a predicted score, or any team's odds of advancing at any event.",
      ] },
    ],
  },
  {
    id: "teams", title: "Your teams",
    items: [
      { id: "my-team", q: "How do I follow my team?", a: [
        "Open your team's page and choose \"Mark as my team\". Its next match and odds then show on the home page and on [My team](/my-team). Use Track for any other teams and events you want to follow.",
      ] },
      { id: "shortlist", q: "What is the shortlist?", a: [
        "Your private pick list for alliance selection: add teams, drag them into order, keep a note on each and give them colours, which Compare uses too. [Open the shortlist](/shortlist).",
      ] },
      { id: "notifications", q: "Can I get notified before my team's matches?", a: [
        "Yes, when you're signed in. Turn on notifications for each device in [Settings](/settings?section=notifications): before a tracked team's match (15 minutes ahead by push, up to 30 in an open tab), when an upset finishes at an event you follow, and when a followed event starts. Each kind can be switched off.",
      ] },
      { id: "rankings", q: "What are world rankings and power rankings?", a: [
        "[World rankings](/rankings) rank every team by rating, with movement since last week, and can be filtered by country, state or your region.",
        "[Power rankings](/power-rankings) are a weekly top 25 with a short write-up for each team, published every Friday.",
      ] },
      // Only once the bot's invite link exists (src/shared/discord.ts).
      ...discordFaq(discordInviteUrl()),
    ],
  },
  {
    id: "scouting", title: "Scouting",
    items: [
      { id: "scout", q: "How does scouting work?", a: [
        "On [Scout](/scout), record match and pit entries for any team. Entries save on your device the moment you press Save, work without signal, and sync to your account when you're signed in and online.",
      ] },
      { id: "workspace", q: "Can my team scout together?", a: [
        "Yes, through Control Point: sign in with Control Point and your team's workspaces show up in Scout. Everyone in the workspace sees new entries in about a second, and you get assignments, a shared pick list, comments and your team's consensus on each team.",
        "Control Point decides who's in a workspace and who's an admin; Scout follows it. Only that workspace's members can see its entries.",
      ] },
      { id: "video", q: "Where do match recordings go?", a: [
        "Recordings made in the app stay on your device and are never uploaded. Only YouTube links you add are synced.",
      ] },
      { id: "export", q: "Can I export my scouting data?", a: [
        "Yes. Your own entries export as JSON or CSV in [Settings](/settings?section=scouting), and a workspace's entries export as a CSV that opens in Google Sheets.",
      ] },
    ],
  },
  {
    id: "offline", title: "Offline at events",
    items: [
      { id: "offline", q: "Does it work without wifi at a venue?", a: [
        "Yes. Predictions work offline automatically: a small pack of every team's ratings saves itself whenever you're online.",
        "For team pages, event pages and search offline, save the season on [Download](/download) before you go. Pages served from it are marked Offline with the date the data is from.",
      ] },
      { id: "storage", q: "How much space do saved seasons take?", a: [
        "From a few megabytes for a season just starting to about 40 for a full one; [Download](/download) shows each season's size, and Download all the total. Remove seasons there or in [Settings](/settings?section=offline) whenever you like.",
      ] },
    ],
  },
  {
    id: "privacy", title: "Privacy and help",
    items: [
      { id: "tracking", q: "Do you track me?", a: [
        "No ads, no tracking cookies and no third-party trackers. The only cookies are for sign-in.",
        "Anonymous usage statistics are sent only if you choose Allow, and never when your browser sends Do Not Track or Global Privacy Control. See the [privacy policy](/privacy).",
      ] },
      { id: "delete", q: "How do I delete my account?", a: [
        "In [Settings](/settings?section=privacy) under Account & privacy. It removes your account and everything synced to it from Control Scout straight away.",
      ] },
      { id: "contact", q: "How do I report a bug or suggest a feature?", a: [
        "Use the [contact form](/contact): pick bug, data, feature or other, and we'll reply by email. If the app ever crashes it also offers to send a report, without your notes or scouting.",
      ] },
    ],
  },
];

/** Every question, in page order. */
export const FAQ_ITEMS: FaqItem[] = FAQ.flatMap((g) => g.items);

/** An answer paragraph as plain text: [label](href) becomes label. */
export const faqText = (s: string) => s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

/** An answer paragraph split into text and links (for rendering). */
export function faqParts(s: string): ({ text: string } | { text: string; href: string })[] {
  const out: ({ text: string } | { text: string; href: string })[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push({ text: m[1], href: m[2] });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

/** schema.org FAQPage for search engines (the server puts it in /faq's first HTML). */
export function faqJsonLd(origin: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org", "@type": "FAQPage", url: `${origin}/faq`,
    mainEntity: FAQ_ITEMS.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a.map(faqText).join(" ") } })),
  };
}
