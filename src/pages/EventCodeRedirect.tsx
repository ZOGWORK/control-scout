// An event's address without its season (/events/USNJNEM2) → the newest season's page. A fresh load gets the
// server's 301 (server/app.ts); this covers the app's own navigation and the service worker's app shell.
import { useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { eventPath } from "../shared/eventCode";
import NotFound from "./NotFound";

export default function EventCodeRedirect() {
  const { code = "" } = useParams();
  const { search, hash } = useLocation();
  const [to, setTo] = useState<{ code: string; path: string | null } | null>(null);
  const season = /^\d{4}$/.test(code);
  useEffect(() => {
    if (season) return;
    let live = true;
    apiFetch<{ season: number; code: string }>(`/api/event-code/${encodeURIComponent(code)}`).then(
      (e) => { if (live) setTo({ code, path: eventPath(e.season, e.code) }); },
      () => { if (live) setTo({ code, path: null }); });
    return () => { live = false; };
  }, [code, season]);
  if (season || (to?.code === code && !to.path)) return <NotFound />;
  return to?.code === code && to.path ? <Navigate to={`${to.path}${search}${hash}`} replace /> : null;
}
