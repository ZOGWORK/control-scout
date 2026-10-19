// Shared by the server's static first paint (server/bootShell.ts) and the app that replaces it.

/** The static first-visit privacy banner's element id: the app's ConsentBanner takes over from it in place. */
export const BOOT_CONSENT_ID = "cs-boot-consent";

/** Where the static banner leaves a choice it couldn't save (storage blocked or full): the app's consent
 *  store (src/lib/consent.ts) adopts it as this page view's unsaved choice. */
export const BOOT_CHOICE_GLOBAL = "__csConsent";

/** The home page's headline (two lines, the second in the accent colour) and the line under it, in the static
 *  first paint and in the app: the same words at the same size, so the app's copy doesn't count as a new,
 *  later "largest paint". The brand itself stays in the app's chrome (sidebar and top bar). */
export const HOME_HEADLINE = ["The whole field.", "In your corner."] as const;
export const HOME_LEAD = "Find your team. Follow the competition. Make your next call with the full picture.";
/** What the site is, in plain words, under the hero's buttons: in the static first paint too, so a crawler
 *  that never runs the app still reads it. */
export const HOME_ABOUT = "Control Scout is free FTC scouting and match predictions for every team and event. No account needed.";

/** The id of the app's stylesheet <link>, which the server makes non-blocking (server/seo.ts nonBlockingCss):
 *  the app waits for it to load before its first render (src/main.tsx), so nothing ever shows unstyled. */
export const APP_CSS_ID = "cs-css";
