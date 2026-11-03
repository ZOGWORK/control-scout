// Build-time prerender of the plain content pages (privacy, terms, contact, donate, rules): the real page
// component rendered to static HTML, as How it works is (./methodology.tsx), so their words are in the server's first
// response (server/seoMeta.ts) and the sitemap can offer them. None needs an API answer to draw its text.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";
import PrivacyPage from "../pages/PrivacyPage";
import TermsPage from "../pages/TermsPage";
import ContactPage from "../pages/ContactPage";
import DonatePage from "../pages/DonatePage";
import RulesPage from "../pages/RulesPage";
import { StaticPersonalProvider } from "../lib/personal";
import { MetaProvider } from "../lib/meta";
import { TooltipProvider } from "../components/ui/overlay";
import { MotionReady } from "../lib/motionSupport";
import { PRERENDERED_PAGES } from "../shared/prerendered";

const PAGES: Record<string, ComponentType> = { "/privacy": PrivacyPage, "/terms": TermsPage, "/contact": ContactPage, "/donate": DonatePage, "/rules": RulesPage };
/** Each page's path and the file its prerender is written to (src/shared/prerendered.ts). */
export const STATIC_PRERENDERS: readonly { path: string; file: string; page: ComponentType }[] =
  Object.entries(PRERENDERED_PAGES).map(([path, file]) => ({ path, file, page: PAGES[path] }));

/** The page at `path` (one of STATIC_PRERENDERS) as HTML, drawn as a fresh, signed-out device sees it. */
export function renderStaticPage(path: string): string {
  const p = STATIC_PRERENDERS.find((x) => x.path === path);
  if (!p) throw new Error(`no static prerender for ${path}`);
  const Page = p.page;
  return renderToStaticMarkup(
    <MotionReady.Provider value={false}>
      <StaticPersonalProvider>
        <MetaProvider>
          <TooltipProvider delayDuration={250}>
            <MemoryRouter initialEntries={[path]}><Page /></MemoryRouter>
          </TooltipProvider>
        </MetaProvider>
      </StaticPersonalProvider>
    </MotionReady.Provider>,
  );
}
