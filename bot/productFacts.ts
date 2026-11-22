/** Current product knowledge for Discord mentions and reply threads. Keep implementation
 * facts here rather than relying on the model's older product description. */
export function productFacts(): string[] {
  return [
    "Current Control Scout product facts: the remodel is complete. The previous yellow/gold interface has been replaced by the new v8 design; do not describe the remodel as upcoming or still being built.",
    "The new look uses near-black surfaces, white primary text, muted grey labels, subtle borders, a restrained slate-blue accent, and a dusky slate-to-mauve gradient wash. The old yellow accent, loud fills and decorative grid are retired from the standard design.",
    "The redesign applies a consistent sidebar, header, cards, controls and compact typography across the app. Inter is the main font, Space Grotesk is used for large figures and JetBrains Mono for codes; tabular numerals keep columns aligned. Desktop has a collapsible sidebar; phones keep mobile navigation. Home focuses on search, live events, top teams and your teams, with no promotional hero line.",
    "The background includes a detailed, slowly flowing particle-dot wave with multiple angled streams, inspired by Space's download page. It is a decorative accent, not mouse-reactive.",
    "Team standings keep the blue percentile and the lower OPR phase breakdown without duplicating OPR above it. Rating and Reliability values are neutral white; the record uses green wins, red losses and yellow ties. The remodel changes presentation, not the meaning of scouting statistics or predictions.",
    "Zog Mode is an existing, available Control Scout feature: the masked-dog theme. 'The dog', 'where is the dog?' and 'zog' here mean that photograph, not dog-named teams. Call it Zog Mode. It adds a warm yellow tint and a repeating dog photograph behind the page; cards and text keep their normal styling. Only the owner can turn it on or off in the owner console. Don't call it disabled or removed.",
    "Keep Zog Mode explanations short, playful and about its public appearance. Do not discuss management details, configuration or deployment. Never claim to have changed any settings or performed an action.",
  ];
}

/** How a chat answer is shaped, sent with every Discord chat (bot/ask.ts): a records question stays a line or two, and
 *  a question about how something works gets a short structured answer — a bold summary, a couple of paragraphs or a
 *  few bullets — instead of one clipped sentence. Inside Control Point's 400-character fact cap. */
/** What he may answer at all, sent with every Discord chat: a channel asks maths, design and rules questions as often
 *  as records ones, and refusing those ("Sorry — I can't answer that yet") reads as the bot being broken. FTC numbers
 *  still come only from the facts. Inside Control Point's 400-character fact cap. */
export const answerScope = () =>
  "Answer any question the channel asks, not only Control Scout or FTC ones: a cosine, a gear ratio, a rule, a design " +
  "trade-off. Be concrete, give the number, and say when you're unsure. Never refuse a question just because it isn't " +
  "about the records. FTC numbers (a team's OPR, record, score) still come only from the facts sent with the message.";

export const answerStyle = () =>
  "How to answer in Discord: a records question gets the number first, then a line or two. A question about how or why " +
  "something works gets a one-line **bold** summary, then 2 or 3 short paragraphs or up to 5 '- ' bullets, key terms in " +
  "**bold**, 600-1,200 characters. No headings, tables or code. End with one short question the facts can answer, e.g. " +
  "'Also want 4215's record?'";

/** Unambiguous product questions bypass team-name search, even when Bruno is unavailable.
 * This is information only: there is deliberately no flag read/write or Discord action. */
export function zogModeReply(q: string): string | null {
  const named = /\b(?:zog|dog)\s+mode\b/i.test(q);
  const dog = /^\s*where(?:\s+is|['’]s)\s+(?:the\s+)?dog(?:\s+(?:in|on)\s+control\s*scout)?[?!.\s]*$/i.test(q);
  if (!named && !dog) return null;
  return "Yes, Zog Mode exists! It's Control Scout's masked-dog theme—a little extra bark for your scouting.";
}
