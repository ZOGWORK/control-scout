// Is an event code in the season asked for, and if not, which season is it in? An old or hand-made
// Predict link can pair an event with the wrong season (?code=FTCCMP1EDIS with this season, when that
// championship was last season's): the page explains that and offers the right season, never a bare 404.
import { useEffect, useState } from "react";
import { load, useApi, type ApiError } from "./api";
import type { EventDetail } from "../shared/api";

export type EventCheck =
  | { status: "loading" }
  | { status: "ok"; event: EventDetail["event"] }
  | { status: "elsewhere"; season: number }
  | { status: "missing" }
  | { status: "error"; error: ApiError | Error; reload: () => void };

const notFound = (e: unknown) => [400, 404].includes((e as ApiError | undefined)?.status ?? 0);

/**
 * Every other season holding this code, newest first: the first that answers (null: none has it). Only missing
 * events are probed. A lookup that fails for another reason (offline, a server error) throws: the search didn't
 * finish, so the event can't be called missing.
 */
export async function findEventSeason(code: string, seasons: number[], except: number): Promise<number | null> {
  for (const s of [...seasons].filter((x) => x !== except).sort((a, b) => b - a)) {
    try {
      await load<EventDetail>(`/api/events/${s}/${code}`, false, true);
      return s;
    } catch (e) {
      if (!notFound(e)) throw e;
    }
  }
  return null;
}

export function useEventCheck(season: number, code: string | null, seasons: number[]): EventCheck | null {
  const detail = useApi<EventDetail>(code ? `/api/events/${season}/${code}` : null);
  const missing = !!code && notFound(detail.error);
  const [found, setFound] = useState<{ key: string; season: number | null; error?: Error } | null>(null);
  const [tries, setTries] = useState(0);
  const key = `${season}|${code}`;
  const list = seasons.join(",");
  useEffect(() => {
    if (!missing || !code) return;
    let live = true;
    findEventSeason(code, list.split(",").map(Number).filter(Boolean), season).then(
      (s) => live && setFound({ key, season: s }),
      (e: Error) => live && setFound({ key, season: null, error: e }),
    );
    return () => { live = false; };
  }, [missing, code, season, list, key, tries]);
  if (!code) return null;
  if (detail.data?.event) return { status: "ok", event: detail.data.event };
  if (detail.error && !missing) return { status: "error", error: detail.error, reload: () => { detail.reload(); } };
  if (!missing) return { status: "loading" };
  if (found?.key !== key) return { status: "loading" };
  if (found.error) return { status: "error", error: found.error, reload: () => { setFound(null); setTries((n) => n + 1); } };
  return found.season ? { status: "elsewhere", season: found.season } : { status: "missing" };
}
