// FIRST reports match times in the event's local time with no offset
// ("2025-11-16T11:58:48.832") and gives each event an IANA zone
// ("Australia/Sydney"). This turns the pair into a real instant, so
// "before the match" means before the match — not before a UTC guess.

/** One formatter per zone: making one costs far more than using it (a page's hundreds of matches). */
const formats = new Map<string, Intl.DateTimeFormat>();
const formatOf = (zone: string) => formats.get(zone) ?? formats.set(zone, new Intl.DateTimeFormat("en-US", {
  timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
})).get(zone)!;

/** Offset (ms) of `zone` from UTC at the instant `utcMs`, read off the formatter. */
function offsetAt(utcMs: number, zone: string): number {
  const parts = formatOf(zone).formatToParts(new Date(utcMs));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

const HOUR_MS = 3_600_000;
/** Each zone's offset through a UTC hour, where its first and last second have the same one (no change inside it:
 *  zones change at most once an hour). formatToParts is the cost of a match's time (a few microseconds each, the
 *  server's pages and checks reading thousands at once: a tenth to a quarter of a second of the event loop held per
 *  read on 2026-11-22, the clip coverage pass, an event's matches, the link checks), and an event's matches share a few
 *  hours. Null: the hour holds a change, read each second as before. */
const hourOffsets = new Map<string, number | null>();
/** Offset (ms) of `zone` from UTC at the instant `utcMs`: the same as reading it off the formatter, kept by the hour. */
function zoneOffset(utcMs: number, zone: string): number {
  const hour = Math.floor(utcMs / HOUR_MS) * HOUR_MS;
  const key = `${zone}|${hour}`;
  let kept = hourOffsets.get(key);
  if (kept === undefined) {
    const first = offsetAt(hour, zone);
    kept = first === offsetAt(hour + HOUR_MS - 1000, zone) ? first : null;
    if (hourOffsets.size >= 50_000) hourOffsets.clear();
    hourOffsets.set(key, kept);
  }
  return kept ?? offsetAt(utcMs, zone);
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
