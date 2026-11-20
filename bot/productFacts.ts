/** Current product knowledge for Discord mentions and reply threads. Keep implementation
 * facts here rather than relying on the model's older product description. */
export function productFacts(): string[] {
  return [
    "Current Control Scout product facts: the remodel is complete. The previous yellow/gold interface has been replaced by the new v8 design; do not describe the remodel as upcoming or still being built.",
    "The new look uses near-black surfaces, white primary text, muted grey labels, subtle borders, a restrained slate-blue accent, and a dusky slate-to-mauve gradient wash. The old yellow accent, loud fills and decorative grid are retired from the standard design.",
    "The redesign applies a consistent sidebar, header, cards, controls, compact typography and spacing across the app. Inter is the main font, Space Grotesk is used for large figures, and JetBrains Mono for codes and keyboard hints; tabular numerals keep columns aligned. Desktop has a collapsible sidebar; phones retain mobile navigation. Home focuses on search and live events, top teams and your teams, without a promotional hero line.",
    "The background includes a detailed, slowly flowing particle-dot wave with multiple angled streams, inspired by Space's download page. It is a decorative accent, not mouse-reactive. The owner can globally enable or disable the particle wave in the owner console.",
    "Team standings keep the blue percentile and the lower OPR phase breakdown without duplicating OPR above it. Rating and Reliability values are neutral white; the record uses green wins, red losses and yellow ties. The remodel changes presentation, not the meaning of scouting statistics or predictions.",
    "Zog Mode is an existing, available Control Scout feature: the dog-photo theme. 'The dog', 'where is the dog?', and 'zog' in this feature context refer to the masked dog's photograph, not dog-named robotics teams. Call the feature Zog Mode. When its background is showing, it adds a warm yellow tint and a repeating photograph behind the page; cards and text retain their normal styling. Its availability is separate from whether the owner has chosen to show the background. Do not describe the feature as disabled, removed or nonexistent, or claim the background is currently showing.",
    "Zog Mode is controlled only by the owner in the website's owner console (the internal flag is dogTheme). Discord users cannot enable, disable or otherwise change it. Bruno can explain the feature but must never claim to have changed its setting. This is separate from the standard remodel and the particle-wave switch.",
  ];
}

/** Unambiguous product questions bypass team-name search, even when Bruno is unavailable.
 * This is information only: there is deliberately no flag read/write or Discord action. */
export function zogModeReply(q: string): string | null {
  const named = /\b(?:zog|dog)\s+mode\b/i.test(q)
    || (/\bzog\b/i.test(q) && !/\b(?:teams?|robotics|scores?|rankings?|matches?)\b/i.test(q));
  const dog = /^\s*where(?:\s+is|['’]s)\s+(?:the\s+)?dog(?:\s+(?:in|on)\s+control\s*scout)?[?!.\s]*$/i.test(q);
  if (!named && !dog) return null;
  return "Zog Mode is Control Scout's available dog-photo theme—the masked dog appears behind the app's pages when the owner chooses to show it. Only the owner can change it in the website's owner console. Discord users cannot turn it on or off, and I can't change it through Discord.";
}
