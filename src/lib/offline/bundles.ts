// Event-day bundles on the device (docs/event-bundle.md; the format: src/shared/eventBundle.ts). One per
// event: downloading again replaces it. The bytes are kept as downloaded (gzipped JSON, checked against the
// manifest's SHA-256) in the same IndexedDB store as the packs; nothing is decoded until a page needs it with
// no signal (lib/api.ts, lib/offline/answer.ts) or the bundle's own page opens.
import { del, fetchVerified, getv, put, type PackFile } from "../packs";
import { FEATURE_DISABLED, featureOffMessage } from "../../shared/flags";
import { BUNDLE_FORMAT, bundleFinished, bundleKey, type BundleManifest, type EventBundle, type SavedBundle } from "../../shared/eventBundle";
import { bundleFor, savedBundles, writeBundles } from "./bundleMeta";

export interface BundleRequest { season: number; code: string; team: number | null; workspace: string | null }

const query = (r: Pick<BundleRequest, "team" | "workspace">) => {
  const q = new URLSearchParams();
  if (r.team != null) q.set("team", String(r.team));
  if (r.workspace) q.set("workspace", r.workspace);
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** What the bundle for this event would hold, and its size: asked fresh (this is how an update is found). */
export async function fetchBundleManifest(r: BundleRequest): Promise<BundleManifest> {
  let res: Response;
  try { res = await fetch(`/api/bundles/${r.season}/${encodeURIComponent(r.code)}/manifest${query(r)}`, { credentials: "same-origin", cache: "no-store" }); }
  catch { throw new Error(navigator.onLine === false ? "You're offline: bundles download when you're back online." : "Can't reach the server right now. Try again in a moment."); }
  const body = await res.json().catch(() => null) as (BundleManifest & { error?: string; message?: string }) | null;
  if (res.status === 403 && body?.error === FEATURE_DISABLED) throw new Error(body.message ?? featureOffMessage("offlinePacks"));
  if (!res.ok || !body) throw new Error(body?.error ?? `Couldn't build the bundle (${res.status}).`);
  if (body.format !== BUNDLE_FORMAT) throw new Error("This bundle is from a newer version of Control Scout. Refresh the page.");
  return body;
}

const asFile = (m: BundleManifest): PackFile => ({ name: `${m.code}-bundle.json.gz`, url: m.url, bytes: m.bytes, sha256: m.sha256, seasons: [m.season], kind: "lite", contents: "" });

/** Download, check against the manifest, keep (replacing this event's bundle). The data moved on between the
 *  manifest and the file (a new result): the manifest is asked again once, and that one is downloaded. */
export async function downloadBundle(r: BundleRequest, onProgress?: (done: number, total: number) => void, manifest?: BundleManifest): Promise<SavedBundle> {
  let m = manifest ?? await fetchBundleManifest(r);
  let bytes: Uint8Array;
  try { bytes = await fetchVerified(asFile(m), onProgress); }
  catch {
    m = await fetchBundleManifest(r);
    bytes = await fetchVerified(asFile(m), onProgress);
  }
  await put(bundleKey(m.season, m.code), { bytes, version: m.version });
  const saved: SavedBundle = {
    season: m.season, code: m.code, name: m.name, end: m.end, version: m.version, sha256: m.sha256, bytes: bytes.length,
    savedAt: Date.now(), builtAt: m.builtAt, dataAsOf: m.dataAsOf, team: m.team, workspace: m.workspace,
    // A workspace bundle always holds its pick list (empty or not); a public one never does.
    reports: m.sections.find((s) => s.id === "reports")?.items ?? 0, picklist: !!m.workspace,
  };
  writeBundles([...savedBundles().filter((b) => !(b.season === m.season && b.code === m.code)), saved]);
  for (const k of memo.keys()) if (k.startsWith(`${bundleKey(m.season, m.code)}@`)) memo.delete(k);
  return saved;
}

const memo = new Map<string, Promise<EventBundle | null>>();

/** The event's bundle, decoded (null: none saved, or it can't be read). */
export function loadBundle(season: number, code: string): Promise<EventBundle | null> {
  const meta = bundleFor(season, code);
  if (!meta) return Promise.resolve(null);
  const key = bundleKey(meta.season, meta.code);
  // By version too: another tab may have saved a newer bundle for this event since this one was decoded.
  const memoKey = `${key}@${meta.version}`;
  let p = memo.get(memoKey);
  if (!p) {
    p = (async () => {
      const v = await getv<{ bytes: Uint8Array; version: string }>(key);
      if (!v?.bytes) return null;
      const text = await new Response(new Response(v.bytes as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream("gzip"))).text();
      const b = JSON.parse(text) as EventBundle;
      return b.format === BUNDLE_FORMAT && b.manifest.version === meta.version ? b : null;
    })().catch(() => null);
    for (const k of memo.keys()) if (k.startsWith(`${key}@`)) memo.delete(k);
    memo.set(memoKey, p);
  }
  return p;
}

export async function removeBundle(season: number, code: string): Promise<void> {
  const meta = bundleFor(season, code);
  if (!meta) return;
  const key = bundleKey(meta.season, meta.code);
  await del(key);
  for (const k of memo.keys()) if (k.startsWith(`${key}@`)) memo.delete(k);
  writeBundles(savedBundles().filter((b) => !(b.season === meta.season && b.code === meta.code)));
}

/** Remove every bundle whose event is over. Returns how many went. */
export async function pruneFinished(now = new Date()): Promise<number> {
  const done = savedBundles().filter((b) => bundleFinished(b, now));
  for (const b of done) await removeBundle(b.season, b.code);
  return done.length;
}

/** The request that made a saved bundle (same team and workspace), for its update. */
export const requestOf = (b: SavedBundle): BundleRequest => ({ season: b.season, code: b.code, team: b.team, workspace: b.workspace?.id ?? null });
