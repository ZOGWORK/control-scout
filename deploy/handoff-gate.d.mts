// Types for handoff-gate.mjs (plain Node: the deploy runs it from a release's folder before that release starts).
export function migrationVersions(dbTs: string): number[] | null;
export function searchSchema(searchTs: string): number | null;
export function databaseUrl(envText: string): string | null;
export function restartReasons(o: { migrations: number[] | null; applied: number[]; schema: number | null; storedSearch: number | null }): string[];
