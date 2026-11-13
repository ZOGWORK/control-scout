// Browsers that aren't a person. Prompts meant for people (the add-to-home-screen nudge) stay away from them, so
// crawlers, link previews, Lighthouse/PageSpeed and screenshot runs see the page as it is.

const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|lighthouse|pagespeed|headlesschrome|phantomjs|prerender|facebookexternalhit|embedly|whatsapp|preview|google-inspectiontool|chrome-lighthouse/i;

/** A crawler, a link preview, or a browser driven by automation (navigator.webdriver). */
export function isAutomated(nav: Pick<Navigator, "userAgent"> & { webdriver?: boolean } = navigator): boolean {
  return nav.webdriver === true || BOT_UA.test(nav.userAgent ?? "");
}
