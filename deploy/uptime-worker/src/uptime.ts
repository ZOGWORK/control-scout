// Uptime check for controlscout.org: the logic shared by the Cloudflare Worker
// (worker.ts, every minute) and the local runner (local.ts). Pure apart from the
// injected fetch, clock and logger, so the tests drive it without a network.
//
// Each tick:
//   1. checkSite(): GET /api/health (200, JSON, "ready": true) and GET / (200,
//      HTML, the app shell's <div id="root">), in parallel, each with a timeout.
//   2. step(): the debounce. FAIL_THRESHOLD consecutive failed ticks (default 2,
//      so 1-2 minutes) before "down"; a reminder at most every REMIND_MINUTES
//      while it stays down; "recovered" on the first good tick after that.
//   3. formatAlert() + postDiscord(): one Discord message per alert. Without a
//      webhook configured it only logs. A message whose post fails waits in an
//      outbox and is retried, in order, on the next tick.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type Log = (line: string) => void;

export interface CheckResult {
  name: "api" | "home";
  label: string;
  url: string;
  ok: boolean;
  /** HTTP status, or null when no response arrived (timeout, refused, DNS). */
  status: number | null;
  latencyMs: number;
  /** Why it failed, in a few words. Unset when ok. */
  reason?: string;
}

export interface SiteResult {
  ok: boolean;
  at: number;
  checks: CheckResult[];
}

export const SHELL_MARKER = 'id="root"';

export interface CheckOptions {
  timeoutMs?: number;
  now?: () => number;
}

async function timed(
  fetchFn: FetchLike,
  url: string,
  timeoutMs: number,
  now: () => number,
): Promise<{ status: number | null; contentType: string; body: string; latencyMs: number; error?: string }> {
  const started = now();
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "cache-control": "no-cache", "user-agent": "control-scout-uptime" },
    });
    // The whole body has to arrive within the same timeout.
    const body = await res.text();
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", body, latencyMs: now() - started };
  } catch (e) {
    const latencyMs = now() - started;
    if (timedOut) return { status: null, contentType: "", body: "", latencyMs, error: `timed out after ${Math.round(timeoutMs / 1000)} s` };
    // Node's fetch says only "fetch failed"; the cause has the useful part (ECONNREFUSED, ENOTFOUND…).
    const err = e as { message?: string; cause?: { code?: string; message?: string } };
    const why = err?.cause?.code || err?.cause?.message || err?.message || String(e);
    return { status: null, contentType: "", body: "", latencyMs, error: `connection failed (${oneLine(why, 120)})` };
  } finally {
    clearTimeout(timer);
  }
}

/** Collapses whitespace and cuts to `max` characters, for log lines and Discord fields. */
export function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function checkApi(fetchFn: FetchLike, site: string, timeoutMs: number, now: () => number): Promise<CheckResult> {
  const url = `${site}/api/health`;
  const r = await timed(fetchFn, url, timeoutMs, now);
  const base = { name: "api" as const, label: "API (/api/health)", url, status: r.status, latencyMs: r.latencyMs };
  if (r.error) return { ...base, ok: false, reason: r.error };
  if (r.status !== 200) return { ...base, ok: false, reason: `HTTP ${r.status}` };
  let json: unknown;
  try { json = JSON.parse(r.body); } catch { return { ...base, ok: false, reason: "not JSON" }; }
  if ((json as { ready?: unknown } | null)?.ready !== true) return { ...base, ok: false, reason: "not ready (ready is not true)" };
  return { ...base, ok: true };
}

async function checkHome(fetchFn: FetchLike, site: string, timeoutMs: number, now: () => number): Promise<CheckResult> {
  const url = `${site}/`;
  const r = await timed(fetchFn, url, timeoutMs, now);
  const base = { name: "home" as const, label: "Home page (/)", url, status: r.status, latencyMs: r.latencyMs };
  if (r.error) return { ...base, ok: false, reason: r.error };
  if (r.status !== 200) return { ...base, ok: false, reason: `HTTP ${r.status}` };
  if (!r.contentType.toLowerCase().startsWith("text/html")) return { ...base, ok: false, reason: `not HTML (${r.contentType || "no content type"})` };
  if (!r.body.includes(SHELL_MARKER)) return { ...base, ok: false, reason: "app shell missing" };
  return { ...base, ok: true };
}

/** Both checks, in parallel. `site` has no trailing slash. */
export async function checkSite(fetchFn: FetchLike, site: string, opts: CheckOptions = {}): Promise<SiteResult> {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const at = now();
  const checks = await Promise.all([checkApi(fetchFn, site, timeoutMs, now), checkHome(fetchFn, site, timeoutMs, now)]);
  return { ok: checks.every((c) => c.ok), at, checks };
}

// --- debounce -----------------------------------------------------------------

export interface MonitorState {
  /** Consecutive failed ticks. */
  failures: number;
  /** When the current run of failures started (ms), or null. */
  firstFailureAt: number | null;
  /** True once a "down" alert went out, until "recovered". */
  down: boolean;
  /** When the last down/reminder alert went out (ms), or null. */
  lastAlertAt: number | null;
}

export const INITIAL_STATE: MonitorState = { failures: 0, firstFailureAt: null, down: false, lastAlertAt: null };

export interface StepOptions {
  /** Consecutive failed ticks before "down". Default 2. */
  threshold?: number;
  /** Minimum gap between "still down" reminders. Default 30 min. */
  remindMs?: number;
}

export type Alert =
  | { kind: "down"; since: number; result: SiteResult }
  | { kind: "reminder"; since: number; result: SiteResult }
  | { kind: "recovered"; since: number; result: SiteResult };

/** One tick of the debounce: the next state and, maybe, an alert to send. */
export function step(state: MonitorState, result: SiteResult, opts: StepOptions = {}): { state: MonitorState; alert: Alert | null } {
  const threshold = Math.max(1, opts.threshold ?? 2);
  const remindMs = opts.remindMs ?? 30 * 60_000;
  const now = result.at;

  if (result.ok) {
    if (state.down) return { state: { ...INITIAL_STATE }, alert: { kind: "recovered", since: state.firstFailureAt ?? now, result } };
    return { state: { ...INITIAL_STATE }, alert: null };
  }

  const failures = state.failures + 1;
  const firstFailureAt = state.firstFailureAt ?? now;
  if (!state.down) {
    if (failures >= threshold) {
      return { state: { failures, firstFailureAt, down: true, lastAlertAt: now }, alert: { kind: "down", since: firstFailureAt, result } };
    }
    return { state: { ...state, failures, firstFailureAt }, alert: null };
  }
  if (state.lastAlertAt === null || now - state.lastAlertAt >= remindMs) {
    return { state: { ...state, failures, firstFailureAt, lastAlertAt: now }, alert: { kind: "reminder", since: firstFailureAt, result } };
  }
  return { state: { ...state, failures, firstFailureAt }, alert: null };
}

// --- Discord message -------------------------------------------------------------

export interface DiscordPayload {
  username: string;
  content: string;
  embeds: Array<{
    title: string;
    url: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    timestamp: string;
  }>;
  allowed_mentions: { parse: string[] };
}

const RED = 0xe5484d;
const AMBER = 0xf5a524;
const GREEN = 0x30a46c;

/** "4 min", "1 h 5 min". */
export function duration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** "HTTP 503", "HTTP 200" plus why it still failed, or (no response) just why. */
function statusAndReason(c: CheckResult): string[] {
  if (c.status === null) return [c.reason ?? "no response"];
  const status = `HTTP ${c.status}`;
  return c.reason && c.reason !== status ? [status, c.reason] : [status];
}

function describeCheck(c: CheckResult): string {
  return oneLine([c.ok ? "OK" : "FAILED", ...statusAndReason(c), `${c.latencyMs} ms`].join(" · "), 1000);
}

/** The Discord message for an alert. `site` is the public URL, e.g. https://controlscout.org. */
export function formatAlert(alert: Alert, site: string): DiscordPayload {
  const host = site.replace(/^https?:\/\//, "");
  const failed = alert.result.checks.filter((c) => !c.ok);
  const failedText = failed.map((c) => `${c.label}: ${[...statusAndReason(c), `${c.latencyMs} ms`].join(", ")}.`).join(" ");
  const sinceUnix = Math.floor(alert.since / 1000);
  const lasted = duration(alert.result.at - alert.since);

  let title: string, description: string, color: number, content: string;
  if (alert.kind === "down") {
    title = `${host} is down`;
    color = RED;
    content = `**${host} is down.** ${failedText}`;
    description = `Failing since <t:${sinceUnix}:T> (<t:${sinceUnix}:R>).`;
  } else if (alert.kind === "reminder") {
    title = `${host} is still down (${lasted})`;
    color = AMBER;
    content = `**${host} is still down** after ${lasted}. ${failedText}`;
    description = `Failing since <t:${sinceUnix}:T>. Reminders keep coming while it stays down.`;
  } else {
    title = `${host} is back up`;
    color = GREEN;
    content = `**${host} is back up** after about ${lasted} down.`;
    description = `Down from <t:${sinceUnix}:T> to <t:${Math.floor(alert.result.at / 1000)}:T> (about ${lasted}).`;
  }
  return {
    username: "Control Scout uptime",
    content: oneLine(`${content} ${site}`, 1900),
    embeds: [{
      title: oneLine(title, 250),
      url: site,
      description,
      color,
      fields: alert.result.checks.map((c) => ({ name: c.label, value: describeCheck(c), inline: false })),
      timestamp: new Date(alert.result.at).toISOString(),
    }],
    // Never ping anyone from text that came back in a response.
    allowed_mentions: { parse: [] },
  };
}

/** Posts to the webhook. No webhook: logs and returns "skipped". Never logs the URL. */
export async function postDiscord(
  fetchFn: FetchLike,
  webhookUrl: string | undefined,
  payload: DiscordPayload,
  log: Log,
  timeoutMs = 8_000,
): Promise<"sent" | "skipped" | "failed"> {
  if (!webhookUrl) {
    log(`UPTIME_DISCORD_WEBHOOK is not set; not posting: ${payload.content}`);
    return "skipped";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (res.ok) return "sent";
    log(`Discord webhook answered HTTP ${res.status}: ${oneLine(await res.text().catch(() => ""), 200)}`);
    return "failed";
  } catch (e) {
    log(`Discord webhook post failed: ${oneLine((e as Error)?.message || String(e), 200)}`);
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

// --- one tick ---------------------------------------------------------------------

export interface UptimeConfig {
  site: string;
  webhookUrl?: string;
  threshold?: number;
  remindMs?: number;
  timeoutMs?: number;
}

/**
 * What is saved between ticks: the debounce state, plus the messages that
 * haven't reached Discord yet (oldest first). Keeping the two apart means a
 * failed post never rewinds the health history: a "down" whose post failed
 * stays queued even if the site recovers before the retry, and the "back up"
 * that follows is queued behind it, so Discord still sees both, in order.
 */
export interface StoredState extends MonitorState {
  outbox?: DiscordPayload[];
}

export interface StateStore {
  get(): Promise<StoredState | undefined>;
  put(state: StoredState): Promise<void>;
}

/** Undelivered messages kept at most; the oldest go first when it's full. */
export const OUTBOX_MAX = 10;

type Delivery = "sent" | "skipped" | "failed";

/** Reads a numeric env var; falls back when unset or not a positive number. */
export function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Builds the config from Worker vars / process.env. Strips a trailing slash from SITE. */
export function configFrom(env: Record<string, string | undefined>): UptimeConfig {
  return {
    site: (env.SITE || "https://controlscout.org").replace(/\/+$/, ""),
    webhookUrl: env.UPTIME_DISCORD_WEBHOOK || undefined,
    threshold: num(env.FAIL_THRESHOLD, 2),
    remindMs: num(env.REMIND_MINUTES, 30) * 60_000,
    timeoutMs: num(env.TIMEOUT_MS, 10_000),
  };
}

/** Check, debounce, alert, save. Returns what happened, for logs and tests. */
export async function tick(
  cfg: UptimeConfig,
  deps: { fetch: FetchLike; store: StateStore; log: Log; now?: () => number },
): Promise<{ result: SiteResult; state: MonitorState; alert: Alert | null; delivery: Delivery | null; pending: DiscordPayload[] }> {
  const saved: StoredState = (await deps.store.get()) ?? { ...INITIAL_STATE };
  const { outbox = [], ...prev } = saved;
  const result = await checkSite(deps.fetch, cfg.site, { timeoutMs: cfg.timeoutMs, now: deps.now });
  const { state, alert } = step(prev, result, { threshold: cfg.threshold, remindMs: cfg.remindMs });
  const summary = result.checks.map(describeCheck).join(" | ");
  deps.log(`${result.ok ? "UP" : "FAIL"} (${state.failures} in a row): ${summary}`);
  if (alert) deps.log(`Alert "${alert.kind}"`);

  // Send what's queued, oldest first, then this tick's alert. Stop at the first
  // failure so the order holds; the rest waits for the next tick.
  let queue = alert ? [...outbox, formatAlert(alert, cfg.site)] : outbox;
  let delivery: Delivery | null = null;
  while (queue.length) {
    delivery = await postDiscord(deps.fetch, cfg.webhookUrl, queue[0], deps.log);
    if (delivery === "failed") break;
    queue = queue.slice(1);
  }
  if (queue.length > OUTBOX_MAX) {
    deps.log(`Dropping ${queue.length - OUTBOX_MAX} undelivered alert(s), the oldest`);
    queue = queue.slice(-OUTBOX_MAX);
  }
  if (queue.length) deps.log(`${queue.length} alert(s) not delivered yet; retrying next check`);

  const next: StoredState = queue.length ? { ...state, outbox: queue } : state;
  if (JSON.stringify(next) !== JSON.stringify(saved)) await deps.store.put(next);
  return { result, state, alert, delivery, pending: queue };
}
