// Does the device say it has no network? One small function, so every offline check asks the same thing.
// The connection work (src/lib/connection.ts, the offline + Lite program's Phase 4) replaces this body with
// its own answer (`!connection().online`): a one-line swap.
export const deviceOffline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
