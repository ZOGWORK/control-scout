// A long build written once as a generator that yields between pieces of its work: run to its end at once (runAll,
// the page and tests), or with the event loop let go every slice of work (runYielding, the server), so a rebuild of the
// search index holds no request for its whole length. Either way it is the same code in the same order, so the same
// result.

/** The build run to its end, never let go. */
export function runAll<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The build run with `turn` awaited after each `sliceMs` of work (the server's: a setImmediate). */
export async function runYielding<T>(steps: Generator<void, T>, turn: () => Promise<void>, sliceMs = 20): Promise<T> {
  let since = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - since >= sliceMs) {
      await turn();
      since = performance.now();
    }
  }
}

/** How many items a build's loop works through between yields: small enough to stop near its slice. */
export const STEP_ITEMS = 256;
