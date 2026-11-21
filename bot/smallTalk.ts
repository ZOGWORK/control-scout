// Small talk: a mention that isn't a records question still gets an answer. When the model's chat (Control Point's
// Bruno) is off, unconfigured, slow or has nothing to say, "hi" used to post "Sorry — I can't answer that yet" with
// the closest matches, which reads like a search box that broke rather than a bot that's listening. These replies are
// the bot's own: they say what it is, they never claim a favourite or a fact about a team, and they point at what it
// does know. Only short messages that search found nothing for reach here (bot/ask.ts), so a real question is never
// answered with one of these.
//
// A reply is a sentence or two, in the bot's voice, and names no number: nothing here can be mistaken for data.

/** How many words a message may have and still be small talk: a longer one that search couldn't answer is a real
 *  question, and gets the honest "can't answer that" card instead. */
export const SMALL_TALK_WORDS = 12;

type Rule = { test: RegExp; say: string };

/** In order: the first rule the message matches speaks. Nothing here is about a team, an event or a season. */
const RULES: Rule[] = [
  // "who's your favorite person in this server", "do you have a favourite team": the bot has none, and says so plainly.
  {
    test: /\b(favou?rite|best friend|crush|love (me|you)|marry)\b/i,
    say: "I don't have favourites — not a person, not a team. I don't have opinions either, only the records: ask me who's ranked highest and I'll show you the numbers.",
  },
  { test: /\b(are|r) (you|u) (a )?(bot|robot|ai|human|real|person)\b|\bwho are you\b|\bwhat are you\b/i, say: "I'm Control Scout, a bot for FTC scouting: real records for every team, event and match, plus predictions from the same engine as controlscout.org. Not a person — just a lot of data and a friendly voice." },
  { test: /\b(who (made|built|created) you|who runs you|who owns you)\b/i, say: "Control Scout is a free FTC scouting bot, built on controlscout.org's data and prediction engine. Everything it says about teams comes from the stored results." },
  { test: /\b(how (are|r) (you|u)|how's it going|hows it going|what's up|whats up|sup)\b/i, say: "Running fine, thanks — thinking about FTC records, as usual. What do you want to know?" },
  { test: /\b(good bot|nice bot|great bot|well done|good job|you('| a)?re (great|awesome|cool|the best))\b/i, say: "Thanks — I try. Ask me about any team, event or match and I'll get you the numbers." },
  { test: /\b(hi|hey|hello|yo|howdy|good (morning|afternoon|evening))\b/i, say: "Hey — I'm Control Scout. Ask me about any FTC team, event or match, or something like \"who won decode\"." },
  { test: /\b(thanks|thank you|thx|ty|appreciate it)\b/i, say: "Anytime. If you want more, ask about a team's record, an event's winners, or a match's odds." },
  { test: /\b(bye|goodbye|see ya|see you|later|good night|gn)\b/i, say: "See you — I'll be here with the records." },
  { test: /\b(tell me a joke|joke|funny|make me laugh)\b/i, say: "I'm better with records than jokes — every FTC joke I know ends in a penalty. Try \"who won worlds\" instead." },
  { test: /\b(what can you do|what do you do|help|commands)\b/i, say: "I look up any team (record, OPR, events, awards), any event (teams, scores, winners) and any match, and I can predict a qualification match's odds. Ask in plain words, or try /team, /event, /predict, /rankings — /help lists them all." },
  { test: /\b(test(ing)?|are you (there|alive|on)|ping)\b/i, say: "Here, and listening. Ask me about a team, an event or a match." },
];

/** Whether these words are short enough to be a greeting rather than a question search couldn't answer. */
export const shortEnough = (q: string) => q.trim().split(/\s+/).filter(Boolean).length <= SMALL_TALK_WORDS;

/** The bot's reply to a short message that isn't a records question, or null: a real question, a long one, or words
 *  that name a team or a number (those belong to search, never to small talk). */
export function smallTalk(q: string): string | null {
  const t = q.trim().replace(/\s+/g, " ");
  if (!t || !shortEnough(t)) return null;
  // A number is a team, a season or a score: that's a records question however short ("6980", "2025 worlds").
  if (/\d/.test(t)) return null;
  for (const r of RULES) if (r.test.test(t)) return r.say;
  return null;
}
