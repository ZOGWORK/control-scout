// The home hero's lines in the app: the owner's (set in the console) or the built-in ones. The server's first
// paint carries the owner's lines on every page (server/bootShell.ts, a JSON block read here before the app's
// first render replaces it), so Home draws exactly the lines that paint sized the hero for, with no request.
// Without that paint (a development server), they're asked for once from /api/home/headlines.
import { useMemo } from "react";
import { useApi } from "./api";
import { DEFAULT_HERO_LINES, HERO_LINES_ID, heroLinesFrom, type HeroLine, type HeroLinesResponse } from "../shared/heroLines";

/** The lines in the first paint's JSON block in `doc` (null: none there, so the built-in lines are in use). */
export function readBootLines(doc: Document): HeroLine[] | null {
  const raw = doc.getElementById(HERO_LINES_ID)?.textContent;
  if (!raw) return null;
  try { return heroLinesFrom(JSON.parse(raw)); } catch { return null; }
}

/** Whether the server's first paint was on this page (then its lines, or none, are the server's answer). */
export const hadBootShell = (doc: Document) => !!doc.querySelector("#root .csb");

const BOOT = typeof document === "undefined" ? null : { lines: readBootLines(document), shell: hadBootShell(document) };

const validResponse = (x: unknown): x is HeroLinesResponse => !!x && typeof x === "object" && !!heroLinesFrom((x as HeroLinesResponse).lines);

/** The lines Home rotates through: the first paint's, else (no first paint) the API's, else the built-in ones. */
export function useHeroLines(boot = BOOT): readonly HeroLine[] {
  const asked = useApi<HeroLinesResponse>(boot?.shell ? null : "/api/home/headlines", validResponse);
  const fromApi = useMemo(() => (asked.data ? heroLinesFrom(asked.data.lines) : null), [asked.data]);
  return boot?.lines ?? fromApi ?? DEFAULT_HERO_LINES;
}
