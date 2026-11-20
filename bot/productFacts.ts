/** Current product knowledge for Discord mentions and reply threads. Keep implementation
 * facts here rather than relying on the model's older product description. */
export function productFacts(dogEnabled: boolean | null): string[] {
  return [
    "Current Control Scout product facts: the remodel is complete. The previous yellow/gold interface has been replaced by the new v8 design; do not describe the remodel as upcoming or still being built.",
    "The new look uses near-black surfaces, white primary text, muted grey labels, subtle borders, a restrained slate-blue accent, and a dusky slate-to-mauve gradient wash. The old yellow accent, loud fills and decorative grid are retired from the standard design.",
    "The redesign applies a consistent sidebar, header, cards, controls, compact typography and spacing across the app. Inter is the main font, Space Grotesk is used for large figures, and JetBrains Mono for codes and keyboard hints; tabular numerals keep columns aligned. Desktop has a collapsible sidebar; phones retain mobile navigation. Home focuses on search and live events, top teams and your teams, without a promotional hero line.",
    "The background includes a detailed, slowly flowing particle-dot wave with multiple angled streams, inspired by Space's download page. It is a decorative accent, not mouse-reactive. The owner can globally enable or disable the particle wave in the owner console.",
    "Team standings keep the blue percentile and the lower OPR phase breakdown without duplicating OPR above it. Rating and Reliability values are neutral white; the record uses green wins, red losses and yellow ties. The remodel changes presentation, not the meaning of scouting statistics or predictions.",
    "Dog Mode is the name of an existing optional Control Scout feature. The owner console calls its switch Dog theme (dogTheme). When enabled globally, it adds a warm yellow tint and a repeating photograph of the dog in a mask behind the page; cards and text retain their normal styling. It is off by default and is separate from the standard remodel and particle-wave switch. Bruno can explain it but cannot enable it through Discord.",
    dogEnabled === null ? "Dog Mode's current global setting could not be read. It exists and defaults to off; do not claim it is currently enabled or disabled."
      : `Dog Mode is currently ${dogEnabled ? "enabled" : "disabled"} globally, according to the current owner feature flag.`,
  ];
}
