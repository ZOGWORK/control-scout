// In-process data writes, for readers that copy many tables (the season packs, packs/build.ts): the live lane and the
// stats job mark their write spans, so a reader can tell that nothing was written while it read (the live lane writes
// rows BEFORE it moves data:version, so the version alone can't show that). This covers writers in the same process;
// in production the build runs in a child process (DATA_CYCLE=child) and the data lock it holds for the current
// season's reads is what keeps the server's live lane out.

let inFlight = 0;
let gen = 0;
let waiters: (() => void)[] = [];

/** Run `fn` as a data write: in flight until it ends (even when it throws), and the generation moves on at both ends. */
export async function writing<T>(fn: () => Promise<T>): Promise<T> {
  inFlight++; gen++;
  try { return await fn(); } finally {
    inFlight--; gen++;
    if (!inFlight) { const w = waiters; waiters = []; for (const r of w) r(); }
  }
}

/** Writes in flight now, and the generation (moves whenever a write starts or ends). */
export const writeState = (): { inFlight: number; gen: number } => ({ inFlight, gen });

/** Resolves once no write is in flight (at once when none is). */
export const idle = (): Promise<void> => (inFlight ? new Promise((r) => { waiters.push(r); }) : Promise.resolve());
