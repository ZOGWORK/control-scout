// Tidying the place and school words FIRST's data carries, where they are written (server/data/bundle.ts) and for
// rows already stored (server/data/tidyPlaces.ts). Each rule is about the shape of the text, never one team or town:
// - a letter typed three times or more in a town ("Greeensboro") keeps two;
// - a town that repeats its own state or country after a comma ("McKinney, Texas" in TX, "San Diego, CA, USA") drops it;
// - a school name FIRST cut short ends in its word in full ("Cincinnati Christian High Sch" → "… High School").
import { placeNames } from "./regions.js";

/** A run of one letter three or more times → two. */
const TRIPLED = /(\p{L})\1{2,}/gu;

/** A town as it should read: stray letters doubled back, its own state or country not said twice after a comma. */
export function cleanCity(city: string | null | undefined, state?: string | null, country?: string | null): string | null {
  if (city == null) return null;
  const own = new Set(placeNames(state, country));
  // Empty parts out first ("McKinney, Texas," is "McKinney, Texas"), so the check below sees the real last part.
  let parts = city.replace(TRIPLED, "$1$1").split(",").map((p) => p.trim()).filter(Boolean);
  // The last part names the row's own state or country (a postcode after it allowed: "Orange Beach, AL 36561" in AL).
  while (parts.length > 1 && own.has(parts[parts.length - 1].replace(/\s+\d[\d-]*$/, "").toLowerCase())) parts = parts.slice(0, -1);
  return parts.join(", ") || null;
}

/** School words FIRST shortens at the end of a name, and the word in full. Only the last word: that's where it cuts. */
const SCHOOL_WORDS: Record<string, string> = { Sch: "School", Schl: "School", Acad: "Academy", Elem: "Elementary", Chrn: "Christian" };
const LAST_WORD = new RegExp(`(?<=\\s)(${Object.keys(SCHOOL_WORDS).join("|")})\\.?$`);

/** A school's name with its cut-short last word in full ("Prince of Peace Christian Sch" → "… Christian School"). */
export function cleanSchool(school: string | null | undefined): string | null {
  if (school == null) return null;
  return school.trim().replace(LAST_WORD, (_, w: string) => SCHOOL_WORDS[w]) || null;
}
