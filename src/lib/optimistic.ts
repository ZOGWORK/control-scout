// Optimistic changes (perf brief S1): on slow venue wifi a tap that waits for its round trip feels broken, so a change
// a member repeats at an event shows at once, goes to the server in the background, and takes the server's answer when
// it comes. If the server doesn't take it, the screen goes back to what the server last had and says "Didn't save":
// never a silent failure. Only for changes that are cheap to guess wrong and easy to put back (a status, a switch);
// never deletes, owner or admin actions, or anything the server alone can work out. Reads never use it.
//
// Scouting entries, the personal lists, the shared pick list and the inbox already work this way with their own
// queues (lib/scouting, lib/personal, lib/sharedPicklist, lib/inbox); this is for the plain one-request changes.
import { toast } from "../components/ui/sonner";
import { ApiError } from "./api";

export interface OptimisticChange<R> {
  /** One thing on screen (an assignment's status, an entry's share switch). Its changes go to the server in the order
   * they were made, and only the newest one decides what shows. */
  key: string;
  /** Change the screen now. Returns how to put it back as it was. */
  apply: () => () => void;
  /** The request. */
  send: () => Promise<R>;
  /** The server's answer: put its copy in (it may differ from the guess, e.g. a newer version). */
  reconcile?: (answer: R) => void;
  /** What the change was, for the failure message: "team 18360 marked done". */
  what: string;
  /** Say it didn't save (default: an error toast). */
  report?: (message: string, error: unknown) => void;
}

/** `current`: this was still the newest change to its key when its answer came (an older one's answer changes nothing). */
export type OptimisticResult<R> = { ok: true; value: R; current: boolean } | { ok: false; error: unknown; current: boolean };

/** The failure message: what didn't save, why, and that the screen is back as it was. */
export function didntSave(what: string, error: unknown): string {
  const why = error instanceof ApiError && error.offline
    ? "No connection reached the server."
    : (error instanceof Error && error.message ? error.message.replace(/[.\s]*$/, ".") : "Something went wrong.");
  return `Didn't save: ${what}. ${why} It's back as it was.`;
}

interface Chain {
  /** The last request queued on this key: the next one waits for it. */
  tail: Promise<unknown>;
  /** The newest change's token. */
  latest: number;
  /** Back to before the first change still unconfirmed. */
  undo: () => void;
  /** Back to the newest change the server took (an older one, while a newer one was on its way). */
  confirmed: (() => void) | null;
}

const chains = new Map<string, Chain>();
let tokens = 0;

/** Tests: forget every key. */
export function resetOptimistic() { chains.clear(); }

/**
 * Show a change now and send it. Resolves (never rejects) once its answer is in: taken (`ok`, with the server's answer
 * put on screen through `reconcile`) or not (rolled back and reported, when it's still the newest change to its key).
 */
export function optimistic<R>(c: OptimisticChange<R>): Promise<OptimisticResult<R>> {
  const t = ++tokens;
  const undo = c.apply();
  let chain = chains.get(c.key);
  if (!chain) { chain = { tail: Promise.resolve(), latest: t, undo, confirmed: null }; chains.set(c.key, chain); }
  chain.latest = t;
  const ch = chain;
  const run = ch.tail.then(c.send).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  ch.tail = run;
  return run.then((r) => {
    const current = ch.latest === t;
    if (r.ok) {
      // The server has this one now: a newer change that fails comes back to it, not to before it.
      ch.confirmed = c.reconcile ? () => c.reconcile!(r.value) : () => { c.apply(); };
      if (current) c.reconcile?.(r.value);
    } else if (current) {
      if (ch.confirmed) ch.confirmed(); else ch.undo();
      (c.report ?? ((m) => { toast.error(m); }))(didntSave(c.what, r.error), r.error);
    }
    // An older change that failed says nothing: the newer one decides, and the server gets it next.
    if (current) chains.delete(c.key);
    return { ...r, current };
  });
}
