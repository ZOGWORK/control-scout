// Types for scripts/merge-lock.mjs (plain Node, so any merger can run it without tsx).
export declare const LOCK_REF: string;
export declare const LOCK_STALE_MS: number;
export declare function lockMessage(holder: string, pr: number | string, now?: number): string;
export declare function readLock(message: string | null | undefined): { at: number; holder: string; pr: number } | null;
export declare function lockStale(message: string | null | undefined, now?: number, staleMs?: number): boolean;
export declare function take(holder: string, pr: number | string, now?: number): { taken: boolean; by?: string };
export declare function release(holder: string): string;
