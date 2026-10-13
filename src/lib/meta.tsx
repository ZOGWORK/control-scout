// Site metadata (seasons, current season, data freshness) loaded once.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useApi } from "./api";
import type { Meta } from "../shared/api";

const Ctx = createContext<Meta | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<Meta>("/api/meta");
  return <Ctx.Provider value={data ?? null}>{children}</Ctx.Provider>;
}

/** Null until loaded. */
export const useMeta = () => useContext(Ctx);

/** The current FTC season (from the server, else from today's date). */
export function useCurrentSeason(): number {
  const m = useMeta();
  if (m) return m.currentSeason;
  const d = new Date();
  return d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · FTC Control Scout` : "FTC Control Scout — free FTC scouting & predictions";
  }, [title]);
}
