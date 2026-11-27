/** Whether a message asks about the product itself — its look, a feature, Zog Mode — rather than about the records.
 *  Only then are the detailed design facts worth the packet lines they take from a records answer. */
export const asksProduct = (q: string) =>
  /\b(?:control\s*scout|the\s+(?:app|site|website|redesign)|v8|redesign|remodel|zog|dog\s+mode|theme|interface|sidebar|dashboard|feature|ui)\b/i.test(q);

/** Current product knowledge for Discord mentions and reply threads. Keep implementation
 * facts here rather than relying on the model's older product description. `question`: the message the chat is for —
 *  the full design description goes only when it asks about the product, and a records question keeps the two facts
 *  every chat needs (the remodel is done, Zog Mode exists) so its own records get the room instead. */
export function productFacts(question = ""): string[] {
  const all = [
    "Current Control Scout product facts: the remodel is complete. The previous yellow/gold interface has been replaced by the new v8 design; do not describe the remodel as upcoming or still being built.",
    "The new look uses near-black surfaces, white primary text, muted grey labels, subtle borders, a restrained slate-blue accent, and a dusky slate-to-mauve gradient wash. The old yellow accent, loud fills and decorative grid are retired from the standard design.",
    "The redesign applies a consistent sidebar, header, cards, controls and compact typography across the app. Inter is the main font, Space Grotesk is used for large figures and JetBrains Mono for codes; tabular numerals keep columns aligned. Desktop has a collapsible sidebar; phones keep mobile navigation. Home focuses on search, live events, top teams and your teams, with no promotional hero line.",
    "The background includes a detailed, slowly flowing particle-dot wave with multiple angled streams, inspired by Space's download page. It is a decorative accent, not mouse-reactive.",
    "Team standings keep the blue percentile and the lower OPR phase breakdown without duplicating OPR above it. Rating and Reliability values are neutral white; the record uses green wins, red losses and yellow ties. The remodel changes presentation, not the meaning of scouting statistics or predictions.",
    "Zog Mode is an existing, available Control Scout feature: the masked-dog theme. 'The dog', 'where is the dog?' and 'zog' here mean that photograph, not dog-named teams. Call it Zog Mode. It adds a warm yellow tint and a repeating dog photograph behind the page; cards and text keep their normal styling. Only the owner can turn it on or off in the owner console. Don't call it disabled or removed.",
    "Keep Zog Mode explanations short, playful and about its public appearance. Do not discuss management details, configuration or deployment. Never claim to have changed any settings or performed an action.",
  ];
  // The remodel's completion and Zog Mode's existence are the two facts a chat can't get wrong, whatever it asks;
  // the rest describe the v8 look, and only a product question has room for them.
  return asksProduct(question) ? all : all.filter((_, i) => i === 0 || i === 5);
}

/** How he uses his tools: `LOOKUP:` lines the bot runs and sends the facts back for, in steps (bot/ask.ts's talk).
 *  Without them he could only read what was searched before he started writing, and a question the first search missed
 *  was refused with "I couldn't find that in the facts". Inside Control Point's 400-character cap. */
export const lookupNote = () =>
  "You can look things up: end a reply with a line exactly `LOOKUP: <a short search>` (for example " +
  "`LOOKUP: 26000 opr at biobuzz`) and nothing after it. I run it, send the facts back, and you can look again, " +
  "as often as you need. A search that finds nothing says so: don't repeat it, change the words or say what's " +
  "missing. Never for a product or maths question.";

/** What he may answer at all, sent with every Discord chat: a channel asks maths, design and rules questions as often
 *  as records ones, and refusing those ("Sorry — I can't answer that yet") reads as the bot being broken. FTC numbers
 *  still come only from the facts. Inside Control Point's 400-character fact cap. */
export const answerScope = () =>
  "Answer any question the channel asks, not only Control Scout or FTC ones: a cosine, a gear ratio, a rule, a design " +
  "trade-off. Be concrete, give the number, and say when you're unsure. Never refuse a question just because it isn't " +
  "about the records. FTC numbers (a team's OPR, record, score) still come only from the facts sent with the message.";

/** Who he is, sent with every Discord chat (bot/ask.ts): Bruno, Control Scout's bot, a golden retriever in spirit.
 *  Inside Control Point's 400-character fact cap. */
export const brunoPersona = () =>
  "You are Bruno, Control Scout's Discord bot, and in spirit a golden retriever: friendly, loyal, eager to help, a " +
  "little goofy, never pushy. Be warm in a line, not a paragraph; don't introduce yourself or the dog comparison " +
  "unless someone asks who you are. You are software, not a real dog or a person, and you never claim to have done " +
  "anything outside this chat.";

/** How he works a question out, sent with every Discord chat: reason first, use the thread and the channel's teams,
 *  answer every part of a message that asks several things (bot/tools.ts brings each part's facts), show a calculation,
 *  and say what's missing rather than guess. Inside Control Point's 400-character fact cap. */
export const brunoMethod = () =>
  "Think before you answer: work out what is asked (a follow-up leans on the thread and the channel's teams; a message " +
  "may ask several things, so answer each part the facts cover and say which part they don't), pick the fact that " +
  "answers it, and show a calculation's steps briefly. Say every number's season, and its event when it is one " +
  "event's; compare teams in the same season. If the facts don't hold it, look it up first; only then say what's " +
  "missing rather than guessing. Cut filler: any length you need, none you don't.";

/** How a chat answer is shaped, sent with every Discord chat (bot/ask.ts): a records question stays a line or two, a
 *  question about how something works gets a short structured answer, and a request to explain how to build something
 *  gets the steps — the shape "write a detailed guide on making a coaxial swerve drive" used to miss, answered as a
 *  records question with an OPR nudge. Inside Control Point's 400-character fact cap. */
export const answerStyle = () =>
  "Shapes: records gets the number, then a line or two. How/why gets a **bold** summary, 2-3 short paragraphs or 5 " +
  "'- ' bullets. A how-to or build guide gets a bold one-line answer then 3-6 " +
  "numbered steps with parts, sizes and numbers; 1,000-1,800 chars is fine. A comparison, a trend, \"tell me " +
  "everything\", \"longer\" or a scouting report gets '- ' lines or short labelled sections, as long as it needs. " +
  "No headings, tables or code. At most one offer at the end, for a next step the answer lacks (never the record it " +
  "shows), about its own team, in fresh words; often none.";

/** Unambiguous product questions bypass team-name search, even when Bruno is unavailable.
 * This is information only: there is deliberately no flag read/write or Discord action. */
export function zogModeReply(q: string): string | null {
  const named = /\b(?:zog|dog)\s+mode\b/i.test(q);
  const dog = /^\s*where(?:\s+is|['’]s)\s+(?:the\s+)?dog(?:\s+(?:in|on)\s+control\s*scout)?[?!.\s]*$/i.test(q);
  if (!named && !dog) return null;
  return "Yes, Zog Mode exists! It's Control Scout's masked-dog theme—a little extra bark for your scouting.";
}
