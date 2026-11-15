// FTC One Search with no signal, from the event packs saved on this device: the rules are src/shared/searchOffline.ts
// (the server's own answers, a versus of the pack's teams built as the server builds it, or what the query needs that
// the packs don't hold); this loads the packs and marks the answer with the pack it came from. Loaded only once a
// search has failed for want of a network (lib/api.ts), like the rest of lib/offline.
import type { SearchAnswer, TeamSummary } from "../../shared/api";
import { bundleTime, type EventBundle, type SavedBundle } from "../../shared/eventBundle";
import { searchFromPacks, teamSummariesFromPacks, type FromPack } from "../../shared/searchOffline";
import { packParseContext } from "../../shared/query/packContext";
import type { ParseContext } from "../../shared/query/parse";
import { markOffline, type OfflineSource } from "./saved";
import { savedBundles } from "./bundleMeta";
import { loadBundle } from "./bundles";

/** Packs with an event pack in them (bundles saved before it have no `api`), newest data first. */
async function searchPacks(): Promise<{ meta: SavedBundle; bundle: EventBundle }[]> {
  const metas = savedBundles().filter((b) => b.apiPaths?.length).sort((a, b) => bundleTime(b).localeCompare(bundleTime(a)));
  const loaded = await Promise.all(metas.map(async (meta) => ({ meta, bundle: await loadBundle(meta.season, meta.code) })));
  return loaded.filter((x): x is { meta: SavedBundle; bundle: EventBundle } => !!x.bundle?.api);
}

const source = (b: SavedBundle): OfflineSource => ({ season: b.season, savedAt: b.savedAt, dataAsOf: b.dataAsOf, bundle: { builtAt: b.builtAt, name: b.name } });

/** The parser's context, kept while the same packs are loaded (decoded bundles are kept per version: bundles.ts). */
let kept: { bundles: EventBundle[]; day: string; ctx: ParseContext } | null = null;
function contextFor(bundles: EventBundle[], now: number): ParseContext {
  const day = new Date(now).toISOString().slice(0, 10);
  if (kept && kept.day === day && kept.bundles.length === bundles.length && kept.bundles.every((b, i) => b === bundles[i])) return kept.ctx;
  kept = { bundles, day, ctx: packParseContext(bundles, day) };
  return kept.ctx;
}

function marked<T extends object>(got: FromPack<T> | null, packs: { meta: SavedBundle }[]): T | null {
  return got ? markOffline(got.body, source(packs[got.from].meta)) : null;
}

/** The whole answer for /api/search?answer=1 from the saved packs (null: none saved, or a search they don't take). */
export async function packSearchAnswer(path: string, now = Date.now()): Promise<SearchAnswer | null> {
  const packs = await searchPacks();
  if (!packs.length) return null;
  const bundles = packs.map((p) => p.bundle);
  return marked(await searchFromPacks(path, bundles, now, contextFor(bundles, now)), packs);
}

/** /api/teams-summary from the saved packs (null: none holds any of the teams). */
export async function packTeamSummaries(path: string): Promise<{ season: number; teams: TeamSummary[] } | null> {
  const packs = await searchPacks();
  return marked(teamSummariesFromPacks(path, packs.map((p) => p.bundle)), packs);
}
