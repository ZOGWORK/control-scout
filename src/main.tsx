import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import "./components/arc/arc-theme.css";
import { PersonalProvider } from "./lib/personal";
import { ThemeSync } from "./hooks/useTheme";
import { Shell } from "./components/layout/Shell";
import { SearchProvider } from "./components/layout/Search";
import { Toaster } from "./components/ui/sonner";
import { LoadingBlock } from "./components/states";
import { MetaProvider } from "./lib/meta";

const Home = lazy(() => import("./pages/Home"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const EventPage = lazy(() => import("./pages/EventPage"));
const PredictPage = lazy(() => import("./pages/PredictPage"));
const AccuracyPage = lazy(() => import("./pages/AccuracyPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const MyTeamPage = lazy(() => import("./pages/MyTeamPage"));
const ShortlistPage = lazy(() => import("./pages/ShortlistPage"));
const ScoutPage = lazy(() => import("./pages/ScoutPage"));
const DownloadPage = lazy(() => import("./pages/DownloadPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
                  <Route path="/predict/accuracy" element={<AccuracyPage />} />
                  <Route path="/compare" element={<ComparePage />} />
                  <Route path="/my-team" element={<MyTeamPage />} />
                  <Route path="/shortlist" element={<ShortlistPage />} />
                  <Route path="/scout" element={<ScoutPage />} />
                  <Route path="/download" element={<DownloadPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/methodology" element={<MethodologyPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Shell>
            <Toaster />
          </SearchProvider>
        </MetaProvider>
      </PersonalProvider>
    </BrowserRouter>
  </StrictMode>,
);
