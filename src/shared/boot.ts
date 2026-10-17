// Shared by the server's static first paint (server/bootShell.ts) and the app that replaces it.

/** The static first-visit privacy banner's element id: the app's ConsentBanner takes over from it in place. */
export const BOOT_CONSENT_ID = "cs-boot-consent";

/** The home page's line under the wordmark, in the static first paint and in the app: the same words at the
 *  same size, so the app's copy doesn't count as a new, later "largest paint". */
export const HOME_TAGLINE = "Every FTC team, event and match — with predictions that keep a public score of how often they come true. Free, no login.";

/** The id of the app's stylesheet <link>, which the server makes non-blocking (server/seo.ts nonBlockingCss):
 *  the app waits for it to load before its first render (src/main.tsx), so nothing ever shows unstyled. */
export const APP_CSS_ID = "cs-css";
