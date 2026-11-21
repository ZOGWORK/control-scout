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

/** Unambiguous product questions bypass team-name search, even when Bruno is unavailable.
 * This is information only: there is deliberately no flag read/write or Discord action. */
export function zogModeReply(q: string): string | null {
  const named = /\b(?:zog|dog)\s+mode\b/i.test(q);
  const dog = /^\s*where(?:\s+is|['’]s)\s+(?:the\s+)?dog(?:\s+(?:in|on)\s+control\s*scout)?[?!.\s]*$/i.test(q);
  if (!named && !dog) return null;
  return "Yes, Zog Mode exists! It's Control Scout's masked-dog theme—a little extra bark for your scouting.";
}
