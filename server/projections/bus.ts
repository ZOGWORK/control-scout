// In-process notice: a new projection run was stored (job.ts → the projections stream, routes.ts).
export interface ProjectionNotice { season: number; code: string; computedAt: string; runs: number; through: string | null }

const listeners = new Set<(n: ProjectionNotice) => void>();

export function onProjections(fn: (n: ProjectionNotice) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function publishProjections(n: ProjectionNotice): void {
  for (const fn of [...listeners]) { try { fn(n); } catch { /* one bad listener never stops the rest */ } }
}

export const projectionListeners = () => listeners.size;
