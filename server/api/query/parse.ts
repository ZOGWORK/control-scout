// Moved to src/shared/query/parse.ts: pure, so search's parser runs on the device too (the event pack with no
// signal). The server keeps importing it from here.
//
// Here each reading is remembered for a few seconds (the search audit's S11, 2026-11-24): one search parses the same
// text 8 times or more (each layer, each reader, the follow-ups, the sorry note), and the next search often parses it
// again (a retry, People also ask). Only for a context parseContext made (./context.ts), whose key says everything
// the parser reads from it that could change: the names index (a rebuild is a new one), today, and the preferred
// teams. Each caller gets its own copy, so none can change another's.
import { parseQuery as parseFresh, type ParseContext, type Parsed } from "../../../src/shared/query/parse.js";

export * from "../../../src/shared/query/parse.js";

/** On a context parseContext made (stampContext): its key (the day and preferred teams it reads with; its names
 *  index is the context's own) and the very fields that key was made for. */
export const CONTEXT_KEY: unique symbol = Symbol("parse context key");
type Stamp = { key: string } & Pick<ParseContext, "today" | "prefer" | "isEvent" | "teamEvent" | "nearTeam">;
type Keyed = ParseContext & { [CONTEXT_KEY]?: Stamp };

/** `ctx`'s readings remembered by `key` from now on (./context.ts parseContext, once it's whole). */
export function stampContext<C extends ParseContext>(ctx: C, key: string): C {
  const { today, prefer, isEvent, teamEvent, nearTeam } = ctx;
  (ctx as Keyed)[CONTEXT_KEY] = { key, today, prefer, isEvent, teamEvent, nearTeam };
  return ctx;
}

/** The key `ctx`'s readings are remembered by: none for a context parseContext didn't make, or a copy of one with
 *  any of those fields replaced (`{ ...ctx, prefer }`, `{ ...ctx, isEvent }`), which then reads fresh. */
function keyOf(ctx: ParseContext): string | null {
  const st = (ctx as Keyed)[CONTEXT_KEY];
  if (!st) return null;
  const same = st.today === ctx.today && st.prefer === ctx.prefer && st.isEvent === ctx.isEvent
    && st.teamEvent === ctx.teamEvent && st.nearTeam === ctx.nearTeam;
  return same ? st.key : null;
}

const MEMO_MS = 5_000, MEMO_MAX = 2_000;
const memo = new WeakMap<object, Map<string, { at: number; p: Promise<Parsed> }>>();

/** `raw` as the parser reads it with `ctx`: remembered MEMO_MS for a parseContext context, else read fresh. */
export function parseQuery(raw: string, ctx: ParseContext): Promise<Parsed> {
  const k = keyOf(ctx);
  if (k == null) return parseFresh(raw, ctx);
  let kept = memo.get(ctx.names);
  if (!kept) memo.set(ctx.names, (kept = new Map()));
  const key = `${k}\u0000${raw}`, now = Date.now();
  const hit = kept.get(key);
  if (hit && now - hit.at < MEMO_MS) return hit.p.then((p) => structuredClone(p));
  const p = parseFresh(raw, ctx);
  const entry = { at: now, p };
  kept.delete(key);
  kept.set(key, entry);
  if (kept.size > MEMO_MAX) kept.delete(kept.keys().next().value!);
  const map = kept;
  p.catch(() => { if (map.get(key) === entry) map.delete(key); });
  return p.then((x) => structuredClone(x));
}
