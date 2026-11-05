// Does every home suggestion chip (src/shared/homeSuggestions.ts) answer with a real card? Asks a site's search API
// for each query, signed out and read-only, and fails when one gives no answer card (`stat` or `card`), or a card
// that says nothing was found. Run it before adding a query to the pool, and after a search change ships.
//
//   npm run suggestions:check                                  (the live site)
//   npm run suggestions:check -- --base http://localhost:3000
import { HOME_SUGGESTIONS } from "../src/shared/homeSuggestions.js";
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

async function check(q: string): Promise<string | null> {
  const url = `${base}/api/search?${new URLSearchParams({ q, limit: "40", answer: "1" })}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return noCard((await res.json()) as SearchAnswer);
    } catch (e) {
      if (attempt === 2) return `request failed: ${(e as Error).message}`;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

const failed: string[] = [];
for (const s of HOME_SUGGESTIONS) {
  const why = await check(s.q);
  console.log(`${why ? "FAIL" : "ok  "}  ${s.kind.padEnd(11)} ${s.q}${why ? `  → ${why}` : ""}`);
  if (why) failed.push(s.q);
}
console.log(`\n${HOME_SUGGESTIONS.length - failed.length} of ${HOME_SUGGESTIONS.length} answer with a card on ${base}`);
if (failed.length) process.exit(1);
