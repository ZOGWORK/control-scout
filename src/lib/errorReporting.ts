// In-app error reporting, browser side (docs/error-reporting.md). Uncaught
// errors, unhandled promise rejections and errors caught by the route-level
// error boundary become a small "Something broke — report it?" prompt; nothing
// is sent unless the visitor taps Report (or sends a report from Settings).
//
// A report holds only { message, stack, route, appVersion, timestamp, userAgent },
// sanitized here and again on the server. It is built from the error alone: no
// scout entries, notes, storage, cookies or account details are ever read.
//
// Recursion guard: everything below runs inside try/catch, and while the
// pipeline is busy (building, prompting or sending) any new error is ignored,
// so a failure in the reporting path can never trigger another report.
import { useSyncExternalStore } from "react";
import { normalizeMessage, REPORT_LIMITS, sanitizeReport, sanitizeText, type ErrorReport } from "../shared/errorReport";

declare const __APP_VERSION__: string | undefined;
/** The web app's version: package version + commit, set at build time (vite.config.ts). */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

export const REPORT_URL = "/api/reports/error";
/** At most this many prompts per page load, one at a time, each distinct error once. */
const MAX_PROMPTS = 3;

let busy = false;
let sending = false;
let disabled = false;
let prompts = 0;
const offered = new Set<string>();
let last: ErrorReport | null = null;
let pending: ErrorReport | null = null;
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) { try { f(); } catch { /* a listener's failure stays its own */ } } };

/** Browser noise that isn't a bug in the app: extensions, cross-origin "Script error.", resize loops, aborted requests. */
export function isNoise(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
  const message = typeof error === "string" ? error : typeof e?.message === "string" ? e.message : "";
  const stack = typeof e?.stack === "string" ? e.stack : "";
  if (e?.name === "AbortError") return true;
  if (/^Script error\.?$/i.test(message.trim()) && !stack) return true;
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/(chrome|moz|safari|safari-web)-extension:\/\//.test(stack) && !/\/assets\/|\/src\//.test(stack)) return true;
  return false;
}

/** A sanitized report from an error (or anything thrown). Reads nothing but the error and the page's address. */
export function buildReport(error: unknown, extraStack?: string): ErrorReport {
  const e = error as { name?: unknown; message?: unknown; stack?: unknown } | null;
  let message: string;
  if (error instanceof Error || (e && typeof e.message === "string")) {
    const name = typeof e!.name === "string" && e!.name ? e!.name : "Error";
    message = `${name}: ${String(e!.message)}`;
  } else if (typeof error === "string") message = error;
  // Never serialise an arbitrary thrown object: it could hold app data.
  else message = `Non-error thrown (${error === null ? "null" : typeof error})`;
  const stack = [typeof e?.stack === "string" ? e.stack : "", extraStack ? `Component stack:${extraStack}` : ""].filter(Boolean).join("\n");
  return sanitizeReport({
    message, stack,
    route: typeof location !== "undefined" ? location.pathname : "/",
    appVersion: APP_VERSION,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  });
}

/**
 * Something broke: remember it and, if it's new, offer to report it. Never throws,
 * and ignores errors raised while the reporting pipeline itself is running.
 */
export function captureError(error: unknown, extraStack?: string): void {
  if (busy || sending || disabled) return;
  busy = true;
  try {
    if (isNoise(error)) return;
    const report = buildReport(error, extraStack);
    last = report;
    const key = normalizeMessage(report.message);
    if (pending || offered.has(key) || prompts >= MAX_PROMPTS) return;
    offered.add(key);
    prompts++;
    pending = report;
    emit();
  } catch {
    /* the reporter must never be the thing that breaks */
  } finally {
    busy = false;
  }
}

/** The last error this page load hit (sanitized), for a report sent from Settings. */
export const lastError = () => last;

export type SendResult = "sent" | "limited" | "failed";

/** A send that hasn't answered by then is abandoned, so a stalled connection can't hold the pipeline. */
export const SEND_TIMEOUT_MS = 10_000;

/** Posts one report. Every failure (including the timeout) is swallowed into "failed": it can't throw or reject. */
export async function sendReport(report: ErrorReport): Promise<SendResult> {
  if (sending) return "failed";
  sending = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ctrl = new AbortController();
    const timeout = new Promise<"failed">((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve("failed"); }, SEND_TIMEOUT_MS); });
    const send = fetch(REPORT_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", keepalive: true,
      body: JSON.stringify(sanitizeReport(report)), signal: ctrl.signal,
    }).then((res): SendResult => (res.ok ? "sent" : res.status === 429 ? "limited" : "failed"), (): SendResult => "failed");
    // The timeout wins even if the request ignores the abort.
    return await Promise.race([send, timeout]);
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
    sending = false;
  }
}

/** A report written by the visitor in Settings: their words (sanitized) plus the last error's stack, if there was one. */
export function manualReport(description: string): ErrorReport {
  const text = sanitizeText(description.replace(/\s+/g, " ").trim(), REPORT_LIMITS.description);
  const prior = last;
  return sanitizeReport({
    message: `Bug report: ${text}`,
    stack: prior ? `After: ${prior.message}\n${prior.stack}` : "",
    route: prior?.route ?? (typeof location !== "undefined" ? location.pathname : "/"),
    appVersion: APP_VERSION,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  });
}

/** The prompt was answered (Report or Dismiss). With `report`, only if that report is still the one showing. */
export function clearPrompt(report?: ErrorReport): void {
  if (!pending || (report && pending !== report)) return;
  pending = null;
  emit();
}

/** The prompt's own UI failed: stop prompting for this page load rather than risk a loop. */
export function disableReporting(): void {
  disabled = true;
  pending = null;
  emit();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The report waiting for an answer, or null. */
export const usePendingReport = () => useSyncExternalStore(subscribe, () => pending, () => null);

let installed = false;
/** Listens for uncaught errors and unhandled rejections (once). */
export function installErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => { try { captureError(e.error ?? e.message); } catch { /* guarded */ } });
  window.addEventListener("unhandledrejection", (e) => { try { captureError(e.reason); } catch { /* guarded */ } });
  // Development only (dropped from production builds): any page with ?debug-error throws once, to try the prompt.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("debug-error")) {
    window.setTimeout(() => { throw new Error("Test error from ?debug-error"); }, 500);
  }
}

/** Tests: back to a fresh page load. */
export function resetErrorReporting(): void {
  busy = sending = disabled = false;
  prompts = 0;
  offered.clear();
  last = pending = null;
  emit();
}
