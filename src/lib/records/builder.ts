// The filter builder's editing state: the URL filter tree (src/shared/filterDsl.ts)
// plus ids and raw text, so a half-typed condition ("auto avg ≥ |") can live in
// the builder without being a valid filter yet. Pure functions, unit tested.
import { NUMBER_OPS, TEXT_OPS, validateFilter, type FilterGroup, type FilterNode, type FilterOp } from "../../shared/filterDsl";
import { STAT_BY_KEY, statFor, type RecordScope, type StatDef } from "../../shared/statCatalog";

export interface BCond { id: string; kind: "cond"; key: string | null; op: FilterOp; value: string }
export interface BGroup { id: string; kind: "group"; type: "and" | "or"; children: BNode[] }
export type BNode = BGroup | BCond;

let seq = 0;
export const newId = () => `n${++seq}`;

export const emptyGroup = (type: "and" | "or" = "and"): BGroup => ({ id: newId(), kind: "group", type, children: [] });
export const emptyCond = (key: string | null = null, op: FilterOp = "gte"): BCond => ({ id: newId(), kind: "cond", key, op, value: "" });

/** URL tree → builder tree (numbers become their text). */
export function toBuilder(g: FilterGroup | null): BGroup {
  if (!g) return emptyGroup();
  const node = (n: FilterNode): BNode => n.kind === "group"
    ? { id: newId(), kind: "group", type: n.type, children: n.children.map(node) }
    : { id: newId(), kind: "cond", key: n.key, op: n.op, value: String(n.value) };
  return node(g) as BGroup;
}

/** Operators a stat allows (text: contains/eq/ne; numbers: the six comparisons). */
export const opsFor = (def: StatDef | undefined): readonly FilterOp[] => (def?.type === "text" ? TEXT_OPS : NUMBER_OPS);

const NUM = /^-?\d+(?:\.\d+)?$/;

/**
 * Builder tree → URL tree, with a message per condition that isn't complete
 * yet (keyed by node id). Empty groups are dropped; a root with nothing left is null.
 */
export function fromBuilder(root: BGroup, scope: RecordScope): { filter: FilterGroup | null; errors: Map<string, string> } {
  const errors = new Map<string, string>();
  const node = (n: BNode): FilterNode | null => {
    if (n.kind === "group") {
      const children = n.children.map(node).filter((c): c is FilterNode => c != null);
      return children.length ? { kind: "group", type: n.type, children } : null;
    }
    if (!n.key) { errors.set(n.id, "Pick a statistic"); return null; }
    const def = statFor(n.key, scope);
    if (!def) { errors.set(n.id, STAT_BY_KEY.has(n.key) ? "Not available in this table" : "Unknown statistic"); return null; }
    if (!opsFor(def).includes(n.op)) { errors.set(n.id, def.type === "text" ? "Text stats use contains, = or ≠" : "Pick a comparison"); return null; }
    const v = n.value.trim();
    if (!v) { errors.set(n.id, "Enter a value"); return null; }
    if (def.type === "number") {
      if (!NUM.test(v)) { errors.set(n.id, "Enter a number like 30 or 12.5"); return null; }
      return { kind: "cond", key: n.key, op: n.op, value: Number(v) };
    }
    if (v.length > 100) { errors.set(n.id, "Keep text under 100 characters"); return null; }
    return { kind: "cond", key: n.key, op: n.op, value: v };
  };
  const filter = node(root) as FilterGroup | null;
  if (filter && !errors.size) {
    try { validateFilter(filter, scope); } catch (e) { errors.set(root.id, (e as Error).message.replace(/^filter: /, "")); }
  }
  return { filter, errors };
}

// --- Tree edits (immutable) ---------------------------------------------------

export function updateNode(root: BGroup, id: string, fn: (n: BNode) => BNode): BGroup {
  const walk = (n: BNode): BNode => {
    if (n.id === id) return fn(n);
    return n.kind === "group" ? { ...n, children: n.children.map(walk) } : n;
  };
  return walk(root) as BGroup;
}

export function removeNode(root: BGroup, id: string): BGroup {
  const walk = (g: BGroup): BGroup => ({ ...g, children: g.children.filter((c) => c.id !== id).map((c) => (c.kind === "group" ? walk(c) : c)) });
  return walk(root);
}

export function addChild(root: BGroup, groupId: string, child: BNode): BGroup {
  return updateNode(root, groupId, (g) => (g.kind === "group" ? { ...g, children: [...g.children, child] } : g));
}

/** A condition by id (null when it's gone, e.g. its group was removed). */
export function findCond(root: BGroup, id: string): BCond | null {
  for (const c of root.children) {
    if (c.kind === "cond" ? c.id === id : false) return c as BCond;
    if (c.kind === "group") { const f = findCond(c, id); if (f) return f; }
  }
  return null;
}

/** Depth of the deepest group (root = 1). */
export function depthOf(g: BGroup): number {
  return 1 + Math.max(0, ...g.children.map((c) => (c.kind === "group" ? depthOf(c) : 0)));
}

export function countConditions(n: BNode): number {
  return n.kind === "cond" ? 1 : n.children.reduce((a, c) => a + countConditions(c), 0);
}
