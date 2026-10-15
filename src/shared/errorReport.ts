// In-app error reports (docs/error-reporting.md): the payload, its sanitizer
// and the fingerprint's normalisation, shared by the web app (which sanitizes
// before sending) and the server (which validates and sanitizes again, never
// trusting the browser). A report carries only technical facts about a crash:
// never scout entries, notes, emails, tokens, session values or other personal data.

/** What the browser sends to POST /api/reports/error. Nothing else is ever accepted or stored. */
export type ErrorReport = {
  message: string;
  stack: string;
  /** The page's pathname (query and hash dropped). */
  route: string;
  appVersion: string;
  /** ISO time the error happened, on the device's clock. */
  timestamp: string;
  userAgent: string;
};

export const REPORT_LIMITS = { message: 500, stack: 6000, route: 200, appVersion: 64, userAgent: 300, description: 500 } as const;

/** What replaces anything the sanitizer takes out. */
export const REDACTED = "[redacted]";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/** "Bearer abc…", "Basic abc…" */
const AUTH_HEADER = /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** key=value / key: value / "key":"value" where the key names a secret or a session. */
const SECRET_PAIR = /(["']?\b[\w-]*(?:token|secret|password|passwd|pwd|session|sess|cookie|auth|api[_-]?key|apikey|key|code|otp|sig|signature|credential)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&;,"'})\]]+)/gi;
/** JSON Web Tokens. */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
/** GitHub, Resend, Google and similar prefixed keys. */
const PREFIXED_KEY = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|re_[A-Za-z0-9_]{16,}|sk_[A-Za-z0-9_]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Long opaque strings (session ids, hashes, base64): 32+ characters of letters and digits that include a digit. */
const OPAQUE = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g;
/** Phone-number-like runs: 7+ digits with separators (team numbers have at most 6). */
const PHONE = /(?<![\w.:/])\+?\d[\d\s().-]{7,}\d(?![\w.])/g;
/** A query string or fragment in a URL: the part that can carry codes and tokens. */
const URL_QUERY = /(\b(?:https?|wss?):\/\/[^\s?#)'"]+)[?#][^\s)'"]*/gi;
/** JSON-ish object or array bodies quoted inside a message (e.g. a parse error echoing data). */
const JSON_BLOB = /[{[]\s*"[^"\n]{0,200}"\s*:[^\n]*[}\]]/g;
/** Long quoted strings: likely user content (a note, a name) echoed in an error. */
const LONG_QUOTED = /(["'`])[^"'`\n]{40,}\1/g;

/**
 * Removes personal and secret values from free text (a message or a stack):
 * emails, tokens, keys, session values, JSON bodies, long quoted strings,
 * phone numbers, UUIDs (scout entry ids) and URL query strings. Order matters:
 * the most specific patterns first.
 */
export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  let s = input.slice(0, max * 4);
  s = s.replace(URL_QUERY, "$1");
  s = s.replace(EMAIL, REDACTED);
  s = s.replace(JWT, REDACTED);
  s = s.replace(PREFIXED_KEY, REDACTED);
  s = s.replace(AUTH_HEADER, `$1 ${REDACTED}`);
  s = s.replace(SECRET_PAIR, `$1${REDACTED}`);
  s = s.replace(JSON_BLOB, "{…}");
  s = s.replace(LONG_QUOTED, `$1${REDACTED}$1`);
  s = s.replace(UUID, REDACTED);
  s = s.replace(OPAQUE, REDACTED);
  s = s.replace(PHONE, REDACTED);
  // Control characters (except newline and tab) never belong in a report.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A pathname only: no query, no fragment, no origin. "/" when it isn't one. */
export function sanitizeRoute(v: unknown): string {
  if (typeof v !== "string") return "/";
  let p = v.trim();
  try { if (/^[a-z]+:\/\//i.test(p)) p = new URL(p).pathname; } catch { return "/"; }
  p = p.split(/[?#]/, 1)[0];
  if (!p.startsWith("/")) return "/";
  return sanitizeText(p, REPORT_LIMITS.route) || "/";
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "");

/** A whole report, sanitized field by field. Only the six known fields come out, whatever went in. */
export function sanitizeReport(r: Partial<Record<keyof ErrorReport, unknown>>): ErrorReport {
  const ts = typeof r.timestamp === "string" && !Number.isNaN(Date.parse(r.timestamp)) ? new Date(r.timestamp).toISOString() : new Date().toISOString();
  return {
    message: sanitizeText(r.message, REPORT_LIMITS.message).trim() || "Unknown error",
    stack: sanitizeText(r.stack, REPORT_LIMITS.stack),
    route: sanitizeRoute(r.route),
    appVersion: sanitizeText(clip(r.appVersion, REPORT_LIMITS.appVersion), REPORT_LIMITS.appVersion) || "unknown",
    timestamp: ts,
    userAgent: sanitizeText(clip(r.userAgent, REPORT_LIMITS.userAgent), REPORT_LIMITS.userAgent),
  };
}

/** Checks the shape of a posted report: the field that's wrong, or null when it's fine. */
export function reportShapeError(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON object";
  const b = body as Record<string, unknown>;
  const fields: [keyof ErrorReport, number, boolean][] = [
    ["message", REPORT_LIMITS.message * 4, true], ["stack", REPORT_LIMITS.stack * 2, false], ["route", REPORT_LIMITS.route * 4, true],
    ["appVersion", REPORT_LIMITS.appVersion * 2, true], ["timestamp", 64, true], ["userAgent", REPORT_LIMITS.userAgent * 2, false],
  ];
  for (const [k, max, required] of fields) {
    const v = b[k];
    if (v === undefined || v === null) { if (required) return `${k} is required`; continue; }
    if (typeof v !== "string") return `${k} must be text`;
    if (v.length > max) return `${k} is too long`;
    if (required && !v.trim()) return `${k} is required`;
  }
  if (Number.isNaN(Date.parse(b.timestamp as string))) return "timestamp must be a date";
  return null;
}

// --- Fingerprint ---------------------------------------------------------------------------------

/** A built file's 8-character content hash (Vite's default), e.g. "index-B3xk9_Qa.js" → "index.js", "vendor-react-DkF02aZq.js" → "vendor-react.js". */
const HASHED_ASSET = /([A-Za-z0-9_.-]+?)[-.][A-Za-z0-9_-]{8}(\.m?js|\.css|\.wasm)\b/g;

/** The message with what changes between occurrences of the same bug made stable. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b(?:https?|wss?):\/\/[^/\s]+/gi, "") // origins differ per host
    .replace(HASHED_ASSET, "$1$2")
    .replace(/\[redacted\]/g, "?")
    .replace(/(["'`]).*?\1/g, "$1?$1")
    .replace(/\b0x[0-9a-f]+\b/gi, "N")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

/** One stack line as "function@file" without origin, query, line or column; null if it isn't a frame. */
export function normalizeFrame(line: string): string | null {
  const l = line.trim();
  // Chrome / Edge / Node: "at fn (url:1:2)", "at url:1:2", "at async fn (url:1:2)"
  let m = /^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?$/.exec(l);
  let fn: string | undefined, file: string | undefined;
  if (m) { fn = m[1]; file = m[2]; } else {
    // Firefox / Safari: "fn@url:1:2", "@url:1:2"
    m = /^(.*?)@(.+?)(?::\d+)?(?::\d+)?$/.exec(l);
    if (!m) return null;
    fn = m[1]; file = m[2];
  }
  if (!file || !/[/\\.]|^<anonymous>$|^native$/.test(file)) return null;
  file = file
    .replace(/^(?:https?|wss?):\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(HASHED_ASSET, "$1$2");
  const name = (fn ?? "").replace(/^Object\./, "").replace(/\s*\[as .+\]$/, "").trim() || "<anonymous>";
  return `${name}@${file}`;
}

/** The first `n` frames of a stack, normalized. */
export function topFrames(stack: string, n = 3): string[] {
  const out: string[] = [];
  for (const line of stack.split("\n")) {
    const f = normalizeFrame(line);
    if (f) out.push(f);
    if (out.length >= n) break;
  }
  return out;
}

/** The text that's hashed into a fingerprint: normalized message + first 3 frames. */
export function fingerprintSource(r: Pick<ErrorReport, "message" | "stack">): string {
  return [normalizeMessage(r.message), ...topFrames(r.stack)].join("\n");
}
