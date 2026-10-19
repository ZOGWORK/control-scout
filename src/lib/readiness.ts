// What a season's data status says (the home strip and the team directory): source
// results synced, statistics prepared, or the two out of step for now. Pure, tested.
import type { SeasonReadiness } from "../shared/home";

export interface ReadinessView {
  /** "ok": in step. "wait": statistics behind or not prepared yet (a temporary state). */
  tone: "ok" | "wait";
  /** A few words for the status line. */
  label: string;
  /** A plain-language sentence for states that need one (null when healthy). */
  detail: string | null;
  /** Offer to check again (only while the statistics are behind). */
  retry: boolean;
}

export function readinessView(r: SeasonReadiness | null | undefined): ReadinessView {
  switch (r?.state) {
    case "ready": return { tone: "ok", label: "Statistics up to date", detail: null, retry: false };
    case "catching-up": return {
      tone: "wait", label: "Statistics catching up", retry: true,
      detail: "Newer results have arrived since the statistics were last prepared, so counts of teams with results may be a little behind for a few minutes.",
    };
    case "preparing": return {
      tone: "wait", label: "Statistics being prepared", retry: true,
      detail: "Results are in, but this season’s statistics haven’t been prepared yet. Counts of teams with results appear once they are.",
    };
    default: return { tone: "wait", label: "Statistics status unknown", retry: true, detail: "We couldn’t tell whether the statistics are up to date." };
  }
}

/** A moment in full, with its time zone ("Oct 19, 2026, 12:43 AM EDT"): for a title and screen readers. */
export function fullTime(iso: string, locale?: string, timeZone?: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone });
}
