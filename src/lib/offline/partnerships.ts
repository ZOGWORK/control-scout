// The lite pack's pair history (engine 2.4), loaded once per pack. Only for the
// season it was built through: an older season's call mustn't read later pairs
// (the server applies the same rule, server/predict/engine.ts explain).
import { PartnershipTable, type PartnershipInput } from "@control-scout/predict-engine";
import type { LitePack } from "../packs";
import { decodeLitePairs } from "../../shared/litePairs";

let cache: { pack: LitePack; table: PartnershipTable | null } | null = null;

export function partnershipFor(pack: LitePack | null | undefined, season: number): PartnershipInput | undefined {
  if (!pack) return undefined;
  if (cache?.pack !== pack) cache = { pack, table: PartnershipTable.fromData(decodeLitePairs(pack.pairs)) };
  const table = cache.table;
  return table && table.season === season ? { table, season } : undefined;
}
