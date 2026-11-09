// An event's address without its season (/events/USNJNEM2) → the newest season's page. A fresh load gets the
// server's 301 (server/app.ts); this covers the app's own navigation and the service worker's app shell.
import { useCallback, useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { ApiError, apiFetch } from "../lib/api";
import { eventPath } from "../shared/eventCode";
import { ErrorState, LoadingBlock } from "../components/states";
import NotFound from "./NotFound";

type Lookup = { code: string } & ({ path: string } | { missing: true } | { error: ApiError | Error });

export default function EventCodeRedirect() {
  const { code = "" } = useParams();
  const { search, hash } = useLocation();
  const [got, setGot] = useState<Lookup | null>(null);
  const season = /^\d{4}$/.test(code);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setGot(null); setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    if (season) return;
    let live = true;
    apiFetch<{ season: number; code: string }>(`/api/event-code/${encodeURIComponent(code)}`).then(
      (e) => { if (live) setGot({ code, path: eventPath(e.season, e.code) }); },
      // Only the server's 404 means no such event: a lost connection or a server error can be tried again.
      (err: ApiError | Error) => { if (live) setGot(err instanceof ApiError && err.status === 404 && !err.offline ? { code, missing: true } : { code, error: err }); });
    return () => { live = false; };
  }, [code, season, attempt]);
  if (season) return <NotFound />;
  const now = got?.code === code ? got : null;
  if (!now) return <LoadingBlock label="Finding the event" />;
  if ("path" in now) return <Navigate to={`${now.path}${search}${hash}`} replace />;
  if ("missing" in now) return <NotFound />;
  return <ErrorState error={now.error} onRetry={retry} />;
}
