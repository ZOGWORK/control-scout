// Preset chips → filter groups, and toggling them inside the current filter.
// A chip's group sits directly in the root AND, so chips combine ("Elite OPR"
// + "Clean drivers") and the builder shows exactly what each one added.
import type { FilterCondition, FilterGroup, FilterNode } from "../../shared/filterDsl";
import type { RecordScope } from "../../shared/statCatalog";
import { FILTER_PRESETS, type FilterPreset, type PresetCondition } from "../../config/filterPresets";

export const presetsFor = (scope: RecordScope, predictable: boolean): FilterPreset[] =>
  FILTER_PRESETS.filter((p) => p.kind === (scope === "match" ? "match" : "team") && (predictable || !p.predictableOnly));

/** Looks up the value the top `pct` % of a season's records reach for a stat (highest first for gte, lowest for lte). */
export type ThresholdLookup = (key: string, pct: number, dir: "asc" | "desc") => Promise<number | null>;

/** The value a condition uses in a season: its listed threshold, else the season's top-% value, rounded to keep URLs tidy. */
export async function conditionFor(c: PresetCondition, season: number, lookup: ThresholdLookup): Promise<FilterCondition | null> {
  if ("value" in c) return { kind: "cond", key: c.key, op: c.op, value: c.value };
  const listed = c.thresholds[season];
  if (listed != null) return { kind: "cond", key: c.key, op: c.op, value: listed };
  const v = await lookup(c.key, c.topPct, c.op === "gte" ? "desc" : "asc");
  if (v == null || !Number.isFinite(v)) return null;
  return { kind: "cond", key: c.key, op: c.op, value: c.op === "gte" ? Math.floor(v * 10) / 10 : Math.ceil(v * 10) / 10 };
}

/** The chip's filter group for a season (null when a threshold can't be found, e.g. a season with no data). */
export async function presetGroup(p: FilterPreset, season: number, lookup: ThresholdLookup): Promise<FilterGroup | null> {
  const conds = await Promise.all(p.conditions.map((c) => conditionFor(c, season, lookup)));
  if (conds.some((c) => c == null)) return null;
  return { kind: "group", type: "and", children: conds as FilterCondition[] };
}

/**
 * Does a node have the chip's shape (its conditions' stats and operators, in
 * order)? Values aren't compared, so a chip stays "on" for a link made with an
 * older threshold, and tapping it takes that condition out again.
 */
export function matchesPreset(n: FilterNode, p: FilterPreset): boolean {
  if (n.kind !== "group" || n.type !== "and" || n.children.length !== p.conditions.length) return false;
  return n.children.every((c, i) => c.kind === "cond" && c.key === p.conditions[i].key && c.op === p.conditions[i].op);
}

/** Is this chip on: a direct child of a root AND (or the whole filter)? */
export function hasPreset(filter: FilterGroup | null, p: FilterPreset): boolean {
  if (!filter) return false;
  return matchesPreset(filter, p) || (filter.type === "and" && filter.children.some((c) => matchesPreset(c, p)));
}

/** Take the chip out of the filter (null when nothing is left). */
export function removePreset(filter: FilterGroup, p: FilterPreset): FilterGroup | null {
  if (matchesPreset(filter, p)) return null;
  if (filter.type !== "and") return filter;
  const rest = filter.children.filter((c) => !matchesPreset(c, p));
  return rest.length ? { ...filter, children: rest } : null;
}

/**
 * Add the chip's group (already resolved for the season) alongside the filter, AND.
 * `known` are the table's chips: a filter that is one of them as a whole (a link
 * like `and-totalPointsNpOpr.gte.80-`) is kept as its own group, so it stays on.
 */
export function addPreset(filter: FilterGroup | null, group: FilterGroup, known: readonly FilterPreset[] = []): FilterGroup {
  // Nested even when alone, so a second chip joins it rather than merging into it.
  if (!filter || !filter.children.length) return { kind: "group", type: "and", children: [group] };
  // An OR filter, or a whole-filter chip, is kept whole and the new chip is required too.
  if (filter.type !== "and" || known.some((p) => matchesPreset(filter, p))) return { kind: "group", type: "and", children: [filter, group] };
  return { ...filter, children: [...filter.children, group] };
}

