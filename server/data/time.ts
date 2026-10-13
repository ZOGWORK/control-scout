// FIRST reports match times in the event's local time with no offset
// ("2025-11-16T11:58:48.832") and gives each event an IANA zone
// ("Australia/Sydney"). This turns the pair into a real instant, so
// "before the match" means before the match — not before a UTC guess.

/** Offset (ms) of `zone` from UTC at the instant `utcMs`. */
function zoneOffset(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Event-local wall time + IANA zone → epoch ms. Times that already carry an
 * offset are parsed as given. Null when the time or zone is missing/invalid
 * (callers must treat that as "unknown", never as "now").
 */
export function localToUtcMs(local: string | null | undefined, zone: string | null | undefined): number | null {
  if (!local) return null;
  if (/(Z|[+-]\d\d:?\d\d)$/.test(local)) { const t = Date.parse(local); return Number.isFinite(t) ? t : null; }
  if (!zone) return null;
  const guess = Date.parse(`${local}Z`);
  if (!Number.isFinite(guess)) return null;
  try {
    // Two passes settle the offset across a DST change.
    let t = guess - zoneOffset(guess, zone);
    t = guess - zoneOffset(t, zone);
    return t;
  } catch { return null; }
}
