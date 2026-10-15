// The records filter language, as it appears in shareable URLs (stable
// forever — bookmarked links must keep working):
//
//   ?filter=and-penaltyPointsCommittedTot.lt.2+or-totalPointsOpr.gte.55+autoPointsAvg.gte.30--
//
//   group      = ("and" | "or") "-" [ item *( sep item ) ] "-"
//   item       = group | condition
//   condition  = key "." op "." value
//   sep        = "+" | " "            ("+" arrives as a space once a query string is decoded)
//   op         = lt | lte | eq | ne | gt | gte          (numbers)
//              | eq | ne | contains                      (text; case-insensitive)
//   value      = number: -?digits[.digits]
//              | text: percent-encoded, with "-", ".", "+" and space always encoded
//
// The same format as FTC Scout's records URLs, plus `contains` for text stats.
// An empty group ("and--") matches everything. Used by the server (parse →
// SQL) and the web app (builder ⇄ URL), so both always agree.

import { STAT_BY_KEY, statFor, type RecordScope, type StatDef } from "./statCatalog.js";

export type NumberOp = "lt" | "lte" | "eq" | "ne" | "gt" | "gte";
export type TextOp = "eq" | "ne" | "contains";
export type FilterOp = NumberOp | TextOp;

export const NUMBER_OPS: readonly NumberOp[] = ["eq", "ne", "gt", "gte", "lt", "lte"];
export const TEXT_OPS: readonly TextOp[] = ["contains", "eq", "ne"];
export const OP_LABELS: Record<FilterOp, string> = { eq: "=", ne: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "contains" };

export interface FilterCondition { kind: "cond"; key: string; op: FilterOp; value: number | string }
export interface FilterGroup { kind: "group"; type: "and" | "or"; children: FilterNode[] }
export type FilterNode = FilterGroup | FilterCondition;

/** Limits that keep a pasted URL from turning into a pathological query. */
export const FILTER_LIMITS = { maxLength: 4000, maxDepth: 8, maxConditions: 64, maxTextValue: 100 } as const;

export class FilterError extends Error {
  constructor(message: string, readonly position: number | null = null) {
    super(position == null ? `filter: ${message}` : `filter: ${message} (at character ${position + 1})`);
  }
}

const OPS = new Set<string>(["lt", "lte", "eq", "ne", "gt", "gte", "contains"]);
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const KEY = /^[a-z][A-Za-z0-9]*$/;

/**
 * Parse a filter string. With `scope`, keys and operators are checked against
 * the stat catalog (unknown key, a key from another record kind, `contains` on
 * a number, `lt` on text, a non-numeric value for a number…); without it only
 * the syntax is checked. Throws FilterError with the position of the problem.
 */
export function parseFilter(input: string, scope?: RecordScope): FilterGroup {
  if (input.length > FILTER_LIMITS.maxLength) throw new FilterError(`too long (max ${FILTER_LIMITS.maxLength} characters)`);
  let i = 0;
  let conditions = 0;

  const isSep = (c: string | undefined) => c === "+" || c === " ";

  const group = (depth: number): FilterGroup => {
    if (depth > FILTER_LIMITS.maxDepth) throw new FilterError(`groups nest deeper than ${FILTER_LIMITS.maxDepth}`, i);
    const m = /^(and|or)-/.exec(input.slice(i, i + 4));
    if (!m) throw new FilterError(`expected a group opening "and-" or "or-"`, i);
    i += m[0].length;
    const g: FilterGroup = { kind: "group", type: m[1] as "and" | "or", children: [] };
    if (input[i] === "-") { i++; return g; } // empty group
    for (;;) {
      g.children.push(item(depth));
      if (input[i] === "-") { i++; return g; }
      if (isSep(input[i])) { i++; continue; }
      if (i >= input.length) throw new FilterError(`group opened but never closed — add "-"`, i);
      throw new FilterError(`expected "+" before the next item or "-" to close the group`, i);
    }
  };

  const item = (depth: number): FilterNode => (/^(and|or)-/.test(input.slice(i, i + 4)) ? group(depth + 1) : condition());

  const condition = (): FilterCondition => {
    const start = i;
    const dot1 = input.indexOf(".", i);
    if (dot1 < 0) throw new FilterError(`expected a condition like autoPointsAvg.gte.30`, i);
    const key = input.slice(i, dot1);
    if (!KEY.test(key)) throw new FilterError(`"${key}" isn't a stat key (camelCase letters and digits)`, i);
    const dot2 = input.indexOf(".", dot1 + 1);
    if (dot2 < 0) throw new FilterError(`condition "${key}" needs an operator and a value (${key}.gte.30)`, i);
    const op = input.slice(dot1 + 1, dot2);
    if (!OPS.has(op)) throw new FilterError(`unknown operator "${op}" (use lt, lte, eq, ne, gt, gte, or contains for text)`, dot1 + 1);
    i = dot2 + 1;
    // A number may start with "-"; a text value never contains a raw "-".
    const num = /^-?\d+(?:\.\d+)?/.exec(input.slice(i));
    let raw: string;
    if (num && (i + num[0].length >= input.length || isSep(input[i + num[0].length]) || input[i + num[0].length] === "-")) raw = num[0];
    else { const end = input.slice(i).search(/[+ -]/); raw = end < 0 ? input.slice(i) : input.slice(i, i + end); }
    if (!raw) throw new FilterError(`condition "${key}.${op}" has no value`, i);
    const valueAt = i;
    i += raw.length;
    if (++conditions > FILTER_LIMITS.maxConditions) throw new FilterError(`more than ${FILTER_LIMITS.maxConditions} conditions`, start);
    let text: string;
    try { text = decodeURIComponent(raw); } catch { throw new FilterError(`badly encoded value "${raw}"`, valueAt); }
    const def = scope ? checkKey(key, scope, start) : STAT_BY_KEY.get(key);
    const numeric = def ? def.type === "number" : op !== "contains" && NUMBER.test(text);
    if (numeric) {
      if (op === "contains") throw new FilterError(`"contains" only works on text stats; ${key} is a number`, dot1 + 1);
      if (!NUMBER.test(text)) throw new FilterError(`${key} is a number — "${text}" isn't`, valueAt);
      return { kind: "cond", key, op: op as NumberOp, value: Number(text) };
    }
    if (op !== "eq" && op !== "ne" && op !== "contains") throw new FilterError(`${key} is text: use contains, eq or ne`, dot1 + 1);
    if (text.length > FILTER_LIMITS.maxTextValue) throw new FilterError(`text value longer than ${FILTER_LIMITS.maxTextValue} characters`, valueAt);
    return { kind: "cond", key, op, value: text };
  };

  const root = group(1);
  if (i !== input.length) throw new FilterError(`unexpected text after the filter closed`, i);
  return root;
}

function checkKey(key: string, scope: RecordScope, at: number): StatDef {
  const def = statFor(key, scope);
  if (def) return def;
  if (STAT_BY_KEY.has(key)) throw new FilterError(`"${key}" isn't available for ${scope === "match" ? "match" : scope === "teamSeason" ? "team-season" : "team-event"} records`, at);
  throw new FilterError(`unknown stat "${key}"`, at);
}

/** Encode a text value so it never contains a separator ("-", ".", "+", space). */
export function encodeFilterText(s: string): string {
  return encodeURIComponent(s).replace(/[-.!~*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

const fmtNumber = (n: number) => {
  if (!Number.isFinite(n)) throw new FilterError(`value ${n} isn't a finite number`);
  // Plain decimal notation (the grammar has no exponents).
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/\.?0+$/, "") : s;
};

/** Serialise a filter tree; parseFilter(serializeFilter(g)) deep-equals g. Uses "+" between items. */
export function serializeFilter(g: FilterGroup): string {
  const node = (n: FilterNode): string => n.kind === "group"
    ? `${n.type}-${n.children.map(node).join("+")}-`
    : `${n.key}.${n.op}.${typeof n.value === "number" ? fmtNumber(n.value) : encodeFilterText(n.value)}`;
  return node(g);
}

/** Check a tree built in code (e.g. by the builder UI) against the catalog: round-trips through the parser. */
export function validateFilter(g: FilterGroup, scope: RecordScope): FilterGroup {
  return parseFilter(serializeFilter(g), scope);
}

/** Keys used anywhere in a filter. */
export function filterKeys(g: FilterNode, out = new Set<string>()): Set<string> {
  if (g.kind === "cond") out.add(g.key); else for (const c of g.children) filterKeys(c, out);
  return out;
}
