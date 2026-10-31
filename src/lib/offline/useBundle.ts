// Reading an event-day bundle from a page (docs/event-bundle.md). The bundle code loads lazily, and a page
// asks for a snapshot only once live data didn't come: no signal, or nothing for OFFLINE_TIMEOUT_MS (venue
// wifi that "connects" but carries nothing). Live always takes over when it loads.
import { useEffect, useState } from "react";
import { OFFLINE_TIMEOUT_MS } from "../api";
import { bundleFor, useSavedBundles } from "./bundleMeta";
import type { EventBundle, HtmlSnapshot, SavedBundle } from "../../shared/eventBundle";

export interface FoundSnapshot { meta: SavedBundle; report: HtmlSnapshot }

/** The decoded bundle for an event (null while loading or when none is saved). */
export function useBundle(season: number | null, code: string | null): { meta: SavedBundle | null; bundle: EventBundle | null; loading: boolean } {
  const list = useSavedBundles();
  const meta = season != null && code ? bundleFor(season, code) : null;
  const [got, setGot] = useState<{ version: string; bundle: EventBundle | null } | null>(null);
  useEffect(() => {
    if (!meta) return;
    let live = true;
    import("./bundles").then((m) => m.loadBundle(meta.season, meta.code)).then((bundle) => { if (live) setGot({ version: meta.version, bundle }); }, () => live && setGot({ version: meta.version, bundle: null }));
    return () => { live = false; };
  }, [meta?.season, meta?.code, meta?.version, list]);
  const bundle = meta && got?.version === meta.version ? got.bundle : null;
  return { meta, bundle, loading: !!meta && got?.version !== meta.version };
}

/**
 * The frozen "Know your match" report for this match from the event's bundle, once `why` says live data didn't
 * come: "offline" at once, "waiting" after OFFLINE_TIMEOUT_MS of loading. Null otherwise (and as soon as `why`
 * goes null, i.e. live data loaded).
 */
export function useBundleSnapshot(season: number | null, code: string | null, key: string | null, why: "offline" | "waiting" | null): FoundSnapshot | null {
  const has = season != null && !!code && !!bundleFor(season, code);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (why !== "waiting" || !has) return;
    const t = setTimeout(() => setWaited(true), OFFLINE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [why, has, key]);
  const want = has && (why === "offline" || (why === "waiting" && waited));
  const { meta, bundle } = useBundle(want ? season : null, want ? code : null);
  const report = bundle?.reports.find((r) => r.key === key);
  return want && meta && report ? { meta, report } : null;
}
