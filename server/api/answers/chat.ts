// The answer to a query that isn't a search of FTC data (./../query/chat.ts chatKind): a short, true card about the
// site, or a plain note saying what search can't see, never a guess at a team or an event from its words. Every line
// is what the site's own pages say (src/shared/faq.ts, the About settings, /how-it-works/search).
import type { SearchAnswer, SearchCardLine, SearchPageLink } from "../../../src/shared/api.js";
import { pagesFor } from "../../../src/shared/search.js";
import { chatKind, type ChatKind } from "../query/chat.js";

const MANUAL = "https://ftc-resources.firstinspires.org/ftc/game/manual";
const HOW = "/how-it-works/search";

const CARDS: Record<ChatKind, { title: string; lines: SearchCardLine[]; pages: SearchPageLink[] }> = {
  // "Who made you", "what is bruno": what Control Scout and Bruno are, as the FAQ says it.
  meta: {
    title: "About Control Scout and Bruno",
    lines: [
      { text: "Control Scout is free FTC scouting and predictions for every team, event and match", detail: "Search answers from its stored FTC records: teams, events, matches, rankings and predictions", href: "/faq#what" },
      { text: "Bruno is Control Point's AI", detail: "Control Point is Control Scout's sister app, the team workspace: the two share accounts and the same prediction engine", href: "https://tryctrlpoint.org" },
      { text: "Control Scout is not affiliated with or endorsed by FIRST", detail: "Match data is © FIRST", href: "/faq#first" },
      { text: "Questions and feedback go to the contact page", detail: "Report a bug or wrong data, suggest a feature, or ask a question", href: "/contact" },
    ],
    pages: [{ title: "FAQ", href: "/faq" }, { title: "Contact", href: "/contact" }],
  },
  // "Where do i get a <part>": not in the records; the rules for what a robot may use are FIRST's.
  "off-topic": {
    title: "Not in FTC results data",
    lines: [
      { text: "Search answers from FTC results: teams, events, matches, rankings and predictions", detail: "Where to get parts, or anything else, isn't in those records", href: HOW },
      { text: "Which parts a robot may use is in the season's Competition Manual", detail: "FIRST's official rules, robot building among them", href: MANUAL },
    ],
    pages: [{ title: "How FTC One Search works", href: HOW }],
  },
  // "Was that the same in all the matches you said": search reads each query alone. With the page's last search,
  // Bruno answers from that search's records (searchBrunoAnswer.ts `after`).
  "follow-up": {
    title: "A question about an earlier answer",
    lines: [
      { text: "Search reads each search on its own, so it can't see what it answered before", detail: "Ask again with the team or event in it, and what you want to know about it", href: HOW },
    ],
    pages: [{ title: "How FTC One Search works", href: HOW }],
  },
  // "lol": nothing asked, so nothing is guessed from it.
  reaction: {
    title: "Nothing to look up in that",
    lines: [
      { text: "Search looks up FTC teams, events and matches", detail: "Type a team number, a team or event name, or a question", href: HOW },
    ],
    pages: [{ title: "How FTC One Search works", href: HOW }],
  },
};

/** The card for `q` when search found nothing in it and it isn't a search of FTC data; else null. A spelling's guess
 *  ("did you mean") is no answer to a question about an earlier answer: "… you said here" is never "… you card here".
 *  Any other kind keeps a correction (a team's name typed nearly right beside "you" is that team's). */
export function chatAnswer(q: string, found: SearchAnswer): SearchAnswer | null {
  const answered = !!(found.stat || found.card || (found.step !== "recovery" && found.hits.length));
  if (answered && found.step !== "did-you-mean") return null;
  const kind = chatKind(q);
  if (!kind || (answered && kind !== "follow-up")) return null;
  const c = CARDS[kind];
  return {
    q: found.q, hits: [], step: "deterministic", weak: false, chat: kind,
    pages: [...c.pages, ...pagesFor(found.q).filter((p) => !c.pages.some((x) => x.href === p.href))],
    card: { kind: "info", title: c.title, lines: c.lines },
    understood: { kind: "question", label: c.title },
  };
}
