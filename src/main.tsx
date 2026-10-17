import { StrictMode, Suspense, lazy, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MotionConfig } from "motion/react";
import "./index.css";
import "./components/arc/arc-theme.css";
import { PersonalProvider } from "./lib/personal";
import { ThemeSync } from "./hooks/useTheme";
import { Shell } from "./components/layout/Shell";
import { SearchProvider } from "./components/layout/Search";
import { Toaster } from "./components/ui/sonner";
import { LoadingBlock } from "./components/states";
import { CanonicalSync, MetaProvider } from "./lib/meta";
import { AlertsRunner } from "./lib/alerts";
import { LitePackSync } from "./lib/packSync";
import { ScoutQueueSync } from "./lib/scoutSpace";
import { ConsentBanner } from "./components/layout/ConsentBanner";
import { PageViews } from "./lib/analytics";
import { installErrorReporting, setReportingPaused } from "./lib/errorReporting";
import { onFlags, startFlags } from "./lib/flags";
import { OwnerRoute } from "./pages/OwnerRoute";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { ErrorReportPrompt } from "./components/layout/ErrorReportPrompt";
import { FirstRunTour } from "./components/layout/FirstRunTour";
import { InstallNudge } from "./components/layout/InstallNudge";
import { captureInstallPrompt } from "./lib/installNudge";
// The landing page is part of the main bundle, not lazy: its API calls then start in
// the same render as the app's own (/api/meta, /api/auth/me), with no second round.
import Home from "./pages/Home";
import { pageModule, type PageModule } from "./shared/routes";
import { APP_CSS_ID } from "./shared/boot";
import { installPrefetch } from "./lib/prefetch";

/** A lazily loaded page that can also be loaded ahead of its first render: once loaded,
 *  it renders straight away (React.lazy would still suspend for one round). */
function lazyPage(load: () => Promise<{ default: ComponentType<any> }>) {
  let Loaded: ComponentType<any> | null = null;
  const preload = () => load().then((m) => { Loaded = m.default; });
  const Lazy = lazy(() => load().then((m) => { Loaded = m.default; return m; }));
  const Page = (props: Record<string, unknown>) => (Loaded ? <Loaded {...props} /> : <Lazy {...props} />);
  return Object.assign(Page, { preload });
}

const PAGES = {
  TeamPage: lazyPage(() => import("./pages/TeamPage")),
  EventsPage: lazyPage(() => import("./pages/EventsPage")),
  RecordsPage: lazyPage(() => import("./pages/RecordsPage")),
  RankingsPage: lazyPage(() => import("./pages/RankingsPage")),
  EventPage: lazyPage(() => import("./pages/EventPage")),
  PredictPage: lazyPage(() => import("./pages/PredictPage")),
  ComparePage: lazyPage(() => import("./pages/ComparePage")),
  MyTeamPage: lazyPage(() => import("./pages/MyTeamPage")),
  ShortlistPage: lazyPage(() => import("./pages/ShortlistPage")),
  ScoutPage: lazyPage(() => import("./pages/ScoutPage")),
  DownloadPage: lazyPage(() => import("./pages/DownloadPage")),
  SettingsPage: lazyPage(() => import("./pages/SettingsPage")),
  MethodologyPage: lazyPage(() => import("./pages/MethodologyPage")),
  PrivacyPage: lazyPage(() => import("./pages/PrivacyPage")),
  TermsPage: lazyPage(() => import("./pages/TermsPage")),
  ContactPage: lazyPage(() => import("./pages/ContactPage")),
  MatchReportPage: lazyPage(() => import("./pages/MatchReportPage")),
  PowerRankingsPage: lazyPage(() => import("./pages/PowerRankingsPage")),
  NotFound: lazyPage(() => import("./pages/NotFound")),
} satisfies Record<PageModule, unknown>;
const { TeamPage, EventsPage, RecordsPage, RankingsPage, EventPage, PredictPage, ComparePage, MyTeamPage, ShortlistPage, ScoutPage, DownloadPage, SettingsPage, MethodologyPage, PrivacyPage, TermsPage, ContactPage, MatchReportPage, PowerRankingsPage, NotFound } = PAGES;

// Offline: the service worker precaches the app so it opens with no signal.
// Production builds only (dev serves unbundled modules).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is a bonus */ }); };
  // The app's code is requested after the first paint (server/seo.ts afterFirstPaint), so the page may already have loaded.
  if (document.readyState === "complete") register(); else window.addEventListener("load", register, { once: true });
}

// A link a pointer rests on (or a finger touches, or focus reaches) starts loading its page's code and
// main data, so the page change usually draws straight away (src/lib/prefetch.ts).
installPrefetch((m) => { PAGES[m].preload().catch(() => { /* the page's own lazy load retries and shows it */ }); });

// The browser's install offer can come before the app has mounted: hold it for the nudge (src/lib/installNudge.ts).
captureInstallPrompt();

// Uncaught errors and unhandled rejections offer a report (src/lib/errorReporting.ts), from the very start.
installErrorReporting();
// Feature flags the owner can switch off (src/lib/flags.ts): error reports stop prompting while theirs is off.
startFlags();
onFlags((f) => setReportingPaused(!f.errorReporting));

// The first render waits for the current page's code (already on its way: the server's HTML
// modulepreloads it), so it draws the page itself rather than a loading block, replacing the
// static first paint in one step. Never longer than 3 s: then the usual Suspense fallback shows.
const firstPage = pageModule(location.pathname);
const ready = Promise.all([
  // A failed page download mustn't skip the stylesheet wait: the page's own lazy load retries (and shows) it.
  firstPage ? Promise.race([PAGES[firstPage].preload(), new Promise((r) => setTimeout(r, 3000))]).catch(() => undefined) : undefined,
  appCss(),
]);

/** The app's stylesheet doesn't block the static first paint (server/seo.ts nonBlockingCss), so the app waits
 *  for it here: its first render is never unstyled. Already loaded (or a dev build, where Vite injects it): no wait.
 *  Never longer than 5 s; a stylesheet that fails to load doesn't keep the app from starting. */
function appCss(): Promise<unknown> {
  const link = document.getElementById(APP_CSS_ID) as HTMLLinkElement | null;
  if (!link || link.media !== "print") return Promise.resolve();
  return new Promise((done) => {
    const finish = () => { link.media = "all"; done(undefined); };
    link.addEventListener("load", finish, { once: true });
    link.addEventListener("error", finish, { once: true });
    setTimeout(finish, 5000);
  });
}
void ready.catch(() => { /* a failed load is retried (and shown) by the page's own lazy load */ }).then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Honour the visitor's reduced-motion setting everywhere (transforms off, fades kept). */}
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <PersonalProvider>
        <MetaProvider>
          <ThemeSync />
          <SearchProvider>
            <Shell>
              <RouteErrorBoundary>
              <Suspense fallback={<LoadingBlock />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/teams" element={<RecordsPage />} />
                  <Route path="/matches" element={<RecordsPage matches />} />
                  <Route path="/teams/:number" element={<TeamPage />} />
                  <Route path="/rankings" element={<RankingsPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/events/:season/:code" element={<EventPage />} />
                  <Route path="/events/:season/:code/match/:key" element={<MatchReportPage />} />
                  <Route path="/predict" element={<PredictPage />} />
                  <Route path="/predict/accuracy" element={<Navigate to={{ pathname: "/methodology", hash: "#accuracy" }} replace />} />
                  <Route path="/compare" element={<ComparePage />} />
                  <Route path="/my-team" element={<MyTeamPage />} />
                  <Route path="/shortlist" element={<ShortlistPage />} />
                  <Route path="/scout" element={<ScoutPage />} />
                  <Route path="/download" element={<DownloadPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/methodology" element={<MethodologyPage />} />
                  <Route path="/predict/how-it-works" element={<MethodologyPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/contact" element={<ContactPage />} />
                  <Route path="/power-rankings" element={<PowerRankingsPage />} />
                  <Route path="/power-rankings/:week" element={<PowerRankingsPage />} />
                  {/* Owners only; everyone else (and the server, for everyone) sees the not-found page. */}
                  <Route path="/owner" element={<OwnerRoute notFound={<NotFound />} />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </Shell>
            <Toaster />
            <ErrorReportPrompt />
            <AlertsRunner />
            <LitePackSync />
            <ScoutQueueSync />
            <CanonicalSync />
            <ConsentBanner />
            <FirstRunTour />
            <InstallNudge />
            <PageViews />
          </SearchProvider>
        </MetaProvider>
      </PersonalProvider>
    </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
));
