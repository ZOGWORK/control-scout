// Does every home suggestion chip (src/shared/homeSuggestions.ts) answer with a real card, and is it spelled right?
// Asks a site's search API for each query, signed out and read-only, and fails when one:
//   - gives no answer card (`stat` or `card`), or a card that says nothing was found;
//   - is misspelled: search's spelling correction (server/api/spelling.ts, its vocabulary built from the stored
//     team, school, event, venue, city and region names) offers "Did you mean" for the query, or for the chip's
//     label searched alone;
//   - names a team by name (`teams`) in a spelling other than the team's own, as its team page stores it.
// Run it before adding a query to the pool, and after a search change ships.
//
//   npm run suggestions:check                                  (the live site)
//   npm run suggestions:check -- --base http://localhost:3000
import { HOME_SUGGESTIONS, suggestionLabel, type HomeSuggestion } from "../src/shared/homeSuggestions.js";
import type { SearchAnswer } from "../src/shared/api.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
const base = (arg("base") ?? "https://controlscout.org").replace(/\/+$/, "");

/** Why this answer isn't a real card, or null when it is. */
export function noCard(a: SearchAnswer): string | null {
  const card = a.stat ?? a.card;
  if (!card) return `no answer card (read as ${a.understood?.kind ?? "nothing"}: ${a.understood?.label ?? "-"})`;
  if (card.none) return `the card says none: ${card.none}`;
  return null;
}

/** Why `text` reads as misspelled to search, or null: search corrected it, or offered a correction beside it. */
export function misspelled(text: string, a: SearchAnswer): string | null {
  return a.didYouMean || a.step === "did-you-mean" ? `“${text}” is misspelled: search offers “${a.didYouMean ?? "?"}”` : null;
}

/** Why a chip names a team other than as the team's own name is spelled, or null. `names`: each team's stored name. */
export function misnamed(s: HomeSuggestion, names: ReadonlyMap<string, string>): string | null {
  for (const t of s.teams ?? []) {
    const name = names.get(t);
    if (!name) return `team ${t} has no name`;
    for (const text of new Set([s.q, suggestionLabel(s)])) {
      if (!text.toLowerCase().includes(name.toLowerCase())) return `“${text}” doesn't spell ${t}'s name, “${name}”`;
    }
  }
  return null;
}

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === 2) throw new Error(`request failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
const ask = (q: string) => get<SearchAnswer>(`/api/search?${new URLSearchParams({ q, limit: "40", answer: "1" })}`);

async function check(s: HomeSuggestion, names: ReadonlyMap<string, string>): Promise<string | null> {
  try {
    const a = await ask(s.q);
    const label = suggestionLabel(s);
    return noCard(a) ?? misspelled(s.q, a) ?? (label === s.q ? null : misspelled(label, await ask(label))) ?? misnamed(s, names);
  } catch (e) { return (e as Error).message; }
}

// Run as a script; imported (its test), only the checks above.
if (/check-suggestions\.ts$/.test(process.argv[1] ?? "")) {
  const names = new Map<string, string>();
  for (const t of new Set(HOME_SUGGESTIONS.flatMap((s) => s.teams ?? []))) {
    try { names.set(t, (await get<{ team: { name: string } }>(`/api/teams/${t}`)).team.name); } catch { /* reported as no name */ }
  }
  const failed: string[] = [];
  for (const s of HOME_SUGGESTIONS) {
    const why = await check(s, names);
    console.log(`${why ? "FAIL" : "ok  "}  ${s.kind.padEnd(11)} ${s.q}${why ? `  → ${why}` : ""}`);
    if (why) failed.push(s.q);
  }
  console.log(`\n${HOME_SUGGESTIONS.length - failed.length} of ${HOME_SUGGESTIONS.length} answer with a card, spelled right, on ${base}`);
  if (failed.length) process.exit(1);
}
