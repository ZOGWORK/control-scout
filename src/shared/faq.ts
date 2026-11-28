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
    `Yes. [Add Control Scout to your server](${invite}) and anyone there can use /team, /next, /compare, /predict, /event and /rankings; every answer links back to the page it came from. /help lists everything.`,
    "You can also just ask it things. /ask (your question) answers with the same answer the site's search gives, and mentioning @Control Scout with a question chats with Bruno AI: reply to his answer to keep talking. A server admin can pick one channel with /config channel where every message is answered, each in its own thread.",
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
    id: "videos", title: "Match videos",
    items: [
      { id: "upload", q: "Can I upload my own match videos?", a: [
        "Yes, as YouTube links. Put the video on YouTube (public or unlisted; private videos can't be played), then open the match on Control Scout and add the link under the match's video. Control Scout never hosts the video file itself: it keeps the YouTube link and plays it in the app.",
        "Who sees it depends on you: verified contributors' videos are public for everyone, a team member's are shared with their team, and anyone can keep a link just for themselves. The answers below explain each.",
      ] },
      { id: "public-video", q: "How do I add a video everyone can see?", a: [
        "Get verified, then open the page of a played match: \"Add a Link — public, for everyone\" takes a YouTube link and it shows for every visitor straight away, signed in or not, credited \"Video by\" your actual name. Signed out, the same spot shows a Get Verified button.",
        "Adding videos needs an account with a username and your actual name, both set in [Settings](/settings?section=profile).",
      ] },
      { id: "verified", q: "How do I get verified to add videos?", a: [
        "Sign in and apply on [Get Verified](/get-verified): your team number and name, your role, the events you've recorded, your YouTube channel, one sample match video, who recorded the videos and why you'd like to share them. Tick the agreements and send it.",
        "Applications are reviewed by hand, usually within 1 or 2 business days, and you can withdraw one while it waits. If it isn't approved you'll see why and can apply again after 7 days. Approval makes your videos public, including any you already shared with your team, and adds a verified badge next to your name.",
      ] },
      { id: "team-video", q: "Can I share a video with just my team?", a: [
        "Yes. If you're on a team (through your team's Control Point workspace), a match page offers \"Share with your team\" before you're verified: only your team's signed-in members see the video on Control Scout.",
        "Team-only hides it on Control Scout only: anyone who has the YouTube link can still watch it on YouTube.",
      ] },
      { id: "video", q: "Can I keep a match video just for myself?", a: [
        "Yes, no account needed. Open a match's Video: paste a YouTube link, record with your camera, or choose a video already on your device. Recordings and files stay on your device and are never uploaded; YouTube links are kept in your list and synced to your account when you're signed in. Only you see them.",
      ] },
      { id: "video-missing", q: "Why doesn't my video show on the match?", a: [
        "FIRST's own video plays first when a match has one: yours is saved and shows only if FIRST's isn't there. A match that already has a public video doesn't offer to add another.",
        "A team-only video shows only to your team's signed-in members, and a personal one only to you. Private or deleted YouTube videos are refused.",
      ] },
      { id: "video-limits", q: "Are there limits on adding videos?", a: [
        "Up to 20 links a day per account, and 5 a day on any one match. A video longer than 10 minutes (a whole stream, say) asks for the time the match starts so it plays from the right spot, and using the same video on another match of the event asks you to confirm first.",
      ] },
      { id: "video-wrong", q: "A video is on the wrong match. What do I do?", a: [
        "Open the video's ⋮ menu and choose Report, with the reason: wrong match, wrong event, not a match video, bad quality, noisy audio or something else. Every report is reviewed by hand; a report never hides a video on its own.",
        "If you added the video yourself, the same menu has Edit link and Remove link.",
      ] },
      { id: "video-credit", q: "How am I credited for videos I add?", a: [
        "Each public video says \"Video by\" your actual name (never your username), with your profile picture, and links to your contributor page listing the videos you've added. Signed-in viewers can like a video with the heart.",
      ] },
      { id: "official-videos", q: "Where do the official match videos come from?", a: [
        "From FIRST's own match videos and from events' official YouTube streams: a match in a long stream plays from the moment it starts. Nothing is copied: only the YouTube link and start time are kept.",
        "When a match has no video, its event page says how much of the event was recorded.",
      ] },
      { id: "find-videos", q: "How do I find videos of a team or event?", a: [
        "Search for it with \"videos\" or \"highlights\", like [4215 videos at worlds](/search?q=4215%20videos%20at%20worlds) or [nj states videos](/search?q=nj%20states%20videos): each match plays from its own spot in the stream.",
        "Every team and event also has a highlights page of its standout matches, and an event page's Watch Clips button opens all of its match videos.",
      ] },
      { id: "videos-tab", q: "What is the Videos tab?", a: [
        "[Videos](/videos) is a feed of FTC videos that all play in the app: match clips, this weekend's streams, top plays, close finishes, upsets, creators' videos and Behind the Bot. Filter it by Matches, Creators, Behind the Bot, My teams or This weekend.",
        "Save videos or keep them for later from the watch page; your Saved, Watch later and History lists sync to your account when you're signed in, and stay on your device when you're not.",
      ] },
      { id: "clips", q: "What are Clips?", a: [
        "[Clips](/clips) are short FTC videos, one at a time and full screen: swipe up (or press the down arrow) for the next. Like them, react with an emoji, save them, or share a link to one.",
      ] },
    ],
  },
  {
    id: "search", title: "Search",
    items: [
      { id: "search-what", q: "What can I search for?", a: [
        "Teams (by number, name or city), events (by name, city or code) and matches (like \"4215 matches\"), and questions about them: OPR and its splits, records, ratings, average and best scores, awards, head-to-heads, leaderboards and event history.",
        "It also answers predictions and advancement odds, questions about 2 to 4 teams at once, a range of seasons, two places, two questions joined by \"and\", the game manual's rules, and match videos. Try [best auto in new jersey](/search?q=best%20auto%20in%20new%20jersey) or [top teams in texas](/search?q=top%20teams%20in%20texas). [How search works](/how-it-works/search) lists everything.",
      ] },
      { id: "search-jump", q: "Why did search open a page instead of showing results?", a: [
        "A bare team number, an exact team name or an exact event code goes straight to that team's or event's page. Anything else opens the results.",
      ] },
      { id: "search-ai", q: "Does search use AI?", a: [
        "The results don't: search reads your words by fixed rules, so the same question always gets the same answer, straight from the stored FTC records.",
        "For questions, a separate Bruno AI card may add a short written summary of the results on the page. It is written only from those records, any number it can't back up drops the summary, and it never changes the results. Check the records before relying on it.",
      ] },
      { id: "search-follow", q: "What are People also ask and Related searches?", a: [
        "The next questions people tend to have after a search, about the same teams, event, place or season. Each opens to show its answer, and every one has been checked to have a real answer before it's shown. [Related searches](/related-searches) lists them all for a search.",
      ] },
      { id: "search-limits", q: "What can't search answer?", a: [
        "Anything FIRST hasn't published: robot specs, team rosters and social media. It doesn't search by your location (\"near me\"), and it has no all-time records across different games.",
        "If a search should have worked, [tell us](/contact?topic=feature) what you typed.",
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
        "Yes. Predict's [Custom matchup](/predict?mode=match) takes any four teams for win odds and a predicted score, and [Advancement](/predict?mode=advancement) gives any team's odds of advancing at any event.",
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
        "[Power rankings](/power-rankings) are a weekly top 25 with a short write-up for each team. A new week normally comes out on Friday (a week can come out earlier, and the page says the day it did), and it is checked again every day until the next one. Its ratings are frozen with its write-ups, so a team's rating on its own page may have moved since.",
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
    id: "tools", title: "More tools",
    items: [
      { id: "records", q: "Where are the record tables, and can I export them?", a: [
        "[Teams](/teams) has every team's events and seasons as one big table, and [Match records](/matches) every match: filter by any stat, sort any column, and tick teams to compare them. Both export what you see to Excel or CSV, as do an event page's Rankings and Insights tabs.",
      ] },
      { id: "compare", q: "Can I compare teams side by side?", a: [
        "Yes. [Compare](/compare) takes up to four teams: OPR by game phase, ratings, records, OPR event by event, and every match where they met or played together.",
      ] },
      { id: "regions", q: "How do I see rankings for my state or league?", a: [
        "[Region rankings](/rankings/regions) lists every country and its states or provinces: open one for each team's rank in the region beside its world rank, with movers and leagues. [Leagues](/leagues) has every league's official standings and meets.",
      ] },
      { id: "bracket", q: "Can it predict the playoffs?", a: [
        "Yes. Once alliances are posted, an event's Playoffs tab calls each series and gives every alliance's odds to win the event and to reach the final, from 10,000 simulations of the bracket. It updates after each result.",
      ] },
      { id: "weekend", q: "What's on this weekend?", a: [
        "[This weekend](/weekend) lists the weekend's FTC events and your team's next match, filtered by place like Rankings, or by your region.",
      ] },
      { id: "event-offline", q: "Can I save one event for a venue with no signal?", a: [
        "Yes. Download for offline on an event's page saves that event with its ratings, match reports for the teams there, the rules and the venue's details, and it opens with no signal at all. [Offline](/download) saves whole seasons.",
      ] },
      { id: "lite", q: "Is there a lighter version for slow connections?", a: [
        "Yes: Control Scout Lite, text-only pages with no images or scripts that load fast on weak venue wifi. When a page loads slowly it offers to switch, and you can turn it on in [Settings](/settings?section=network). Every Lite page has a Full version button.",
      ] },
      { id: "install", q: "Can I install it as an app?", a: [
        "Yes. When your browser offers it, Control Scout asks whether to put itself on your home screen, and it then opens like an app. On iPhone or iPad, use Share, then Add to Home Screen in Safari; that's also needed there for notifications.",
      ] },
      { id: "themes", q: "Can I change how it looks?", a: [
        "Yes, in [Settings](/settings?section=appearance): Light, Dim, Dark or System theme, Comfortable or Compact density, text size, the animated background, and the phone tab bar. Your theme syncs to your account when you're signed in.",
      ] },
      { id: "digest", q: "Can I get my teams' results by email?", a: [
        "Yes. Signed in, turn on Email digest in [Settings](/settings?section=notifications): a few emails a week with the results of the teams you follow, how the predictions did and what's coming up. No email when there's nothing to report, and every one has an unsubscribe link.",
      ] },
      { id: "donate", q: "How can I support Control Scout?", a: [
        "[Donate](/donate) through GitHub Sponsors. Control Scout stays free either way: a donation unlocks nothing and isn't tax-deductible, as it's run by an individual developer, not a nonprofit. Public sponsors are thanked on [Supporters](/supporters).",
      ] },
      { id: "api", q: "Is there an API for the data?", a: [
        "There's no public API. For whole seasons, [Offline](/download) has each season as a file, and the record tables export to Excel and CSV. Please don't scrape the site: requests are rate-limited.",
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
