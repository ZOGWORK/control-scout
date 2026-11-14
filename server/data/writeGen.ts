// In-process data writes, for readers that copy many tables without the data lock (the season packs, packs/build.ts):
// the live lane and the stats job mark their write spans, so a reader can tell that nothing was written while it read.
// The live lane writes rows BEFORE it moves data:version, so the version alone can't show that. Only this process's
// writers are seen: a separate process (`npm run packs`) relies on the data:settled check alone.

let inFlight = 0;
let gen = 0;

/** Run `fn` as a data write: in flight until it ends (even when it throws), and the generation moves on at both ends. */
export async function writing<T>(fn: () => Promise<T>): Promise<T> {
  inFlight++; gen++;
  try { return await fn(); } finally { inFlight--; gen++; }
}

/** Writes in flight now, and the generation (moves whenever a write starts or ends). */
export const writeState = (): { inFlight: number; gen: number } => ({ inFlight, gen });
