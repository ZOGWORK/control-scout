import { StrictMode, Suspense, lazy } from "react";
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
import { MetaProvider } from "./lib/meta";
import { AlertsRunner } from "./lib/alerts";

const Home = lazy(() => import("./pages/Home"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const EventPage = lazy(() => import("./pages/EventPage"));
const PredictPage = lazy(() => import("./pages/PredictPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const MyTeamPage = lazy(() => import("./pages/MyTeamPage"));
const ShortlistPage = lazy(() => import("./pages/ShortlistPage"));
const ScoutPage = lazy(() => import("./pages/ScoutPage"));
const DownloadPage = lazy(() => import("./pages/DownloadPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Offline: the service worker precaches the app so it opens with no signal.
// Production builds only (dev serves unbundled modules).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is a bonus */ }); });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Honour the visitor's reduced-motion setting everywhere (transforms off, fades kept). */}
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <PersonalProvider>
        <MetaProvider>
          <ThemeSync />
          <SearchProvider>
            <Shell>
              <Suspense fallback={<LoadingBlock />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/teams/:number" element={<TeamPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/events/:season/:code" element={<EventPage />} />
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
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Shell>
            <Toaster />
            <AlertsRunner />
          </SearchProvider>
        </MetaProvider>
      </PersonalProvider>
    </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);
