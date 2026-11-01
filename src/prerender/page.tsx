// A page's first paint, rendered on the server per request with the real page component (server/firstPaint.ts): team
// and event pages. The page a visitor (or a crawler) gets first IS the page (a team's header, record, rank, OPR,
// events and matches; an event's header, rankings and matches), not a summary that the app then swaps for a loading
// state. It's drawn as a fresh, signed-out device sees it, from the same answers the HTML carries for the app
// (src/lib/pageData.ts), so the app's first render matches it.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamPage from "../pages/TeamPage";
import EventPage from "../pages/EventPage";
import { StaticPersonalProvider } from "../lib/personal";
import { MetaProvider } from "../lib/meta";
import { TooltipProvider } from "../components/ui/overlay";
import { MotionReady } from "../lib/motionSupport";
import { forget, prime } from "../lib/api";
import { withFirstPaint } from "../lib/pageData";

/** The page at `url` ("/teams/4215", "/events/2025/USNJCMP?tab=odds") as HTML, drawn from `data` (API path → answer). */
export function renderAppPage(url: string, data: Record<string, unknown>): string {
  const paths = Object.keys(data);
  for (const p of paths) prime(p, data[p]);
  try {
    return withFirstPaint(paths, () => renderToStaticMarkup(
      // Animations at rest: what the app's first render shows too (its animation features arrive after it).
      <MotionReady.Provider value={false}>
        <StaticPersonalProvider>
          <MetaProvider>
            <TooltipProvider delayDuration={250}>
              <MemoryRouter initialEntries={[url]}>
                <Routes>
                  <Route path="/teams/:number" element={<TeamPage />} />
                  <Route path="/events/:season/:code" element={<EventPage />} />
                </Routes>
              </MemoryRouter>
            </TooltipProvider>
          </MetaProvider>
        </StaticPersonalProvider>
      </MotionReady.Provider>,
    ));
  } finally {
    forget(paths);
  }
}
