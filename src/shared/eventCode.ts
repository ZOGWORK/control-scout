// Event codes in addresses. FIRST's codes are mostly [A-Z0-9], but its older seasons hold others: mixed case
// ("2019INMeet10", "USILCMM2a"), punctuation ("NL'HKO", "USVTM(KO", "2019INLT!", "63693260770.2649"), spaces
// ("laredomeet 2") and Cyrillic ("RUМОS"). An address may spell a code in any case: the server finds the event
// whatever the case (server/eventCodes.ts), and an event's one canonical address spells its code in upper case,
// URL-encoded (/events/2019/2019INMEET10), the same on the server and in the app (src/lib/meta.tsx canonicalPath).

/** The longest code an address may carry (FIRST's run to about 20). */
export const EVENT_CODE_MAX = 40;

/** Whether `s` (as decoded from an address) can be an event code: 1 to 40 characters, none that would end or
 *  split the path ("/", "\", "?", "#") and no control characters. */
export const isEventCodeParam = (s: string): boolean =>
  s.length >= 1 && s.length <= EVENT_CODE_MAX && !/[/\\?#\u0000-\u001f\u007f]/.test(s);

/** A code as its canonical address spells it. */
export const canonicalEventCode = (code: string): string => code.toUpperCase();

/** An event page's canonical path. */
export const eventPath = (season: number | string, code: string): string => `/events/${season}/${encodeURIComponent(canonicalEventCode(code))}`;
