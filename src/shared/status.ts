// GET /api/status: is each part of Control Scout running, for the public /status page (server/uptime.ts).

export type ServiceKey = "site" | "api" | "controlPoint" | "bot";

/** One check: when, and whether it passed. `ok` null means no check ran then (the checker itself was down). */
export interface StatusBar { at: number; ok: boolean | null }

export interface ServiceStatus {
  key: ServiceKey;
  label: string;
  /** In a few words, what the service is for. */
  about: string;
  /** The newest check passed. Null before the first check. */
  up: boolean | null;
  /** Share of checks that passed, 0–100, over the last 24 hours and the last 30 days. Null with no checks. */
  uptime24h: number | null;
  uptime30d: number | null;
  /** The newest STATUS_BARS checks, oldest first. */
  bars: StatusBar[];
}

export interface StatusResponse {
  /** "up": every service passed its newest check; "partial": some didn't; "down": none did; "unknown": no checks yet. */
  overall: "up" | "partial" | "down" | "unknown";
  checkedAt: number | null;
  everyMinutes: number;
  services: ServiceStatus[];
}

export const STATUS_BARS = 45;
export const CHECK_EVERY_MIN = 2;

export function overallOf(services: Pick<ServiceStatus, "up">[]): StatusResponse["overall"] {
  const known = services.filter((s) => s.up !== null);
  if (!known.length) return "unknown";
  const up = known.filter((s) => s.up).length;
  return up === known.length ? "up" : up === 0 ? "down" : "partial";
}
