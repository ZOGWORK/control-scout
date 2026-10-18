// The atlas's numbers, kept apart from its drawing so they can be tested: which
// country is selected, what it links to, and how the season's listings split
// into countries (drawn or not) and listings no country can be given to.
import type { CountryTotal, HomeOverview } from "../../shared/home";

/** The selected country: the one asked for if it has listings, else the one with the most. */
export function pickCountry(o: Pick<HomeOverview, "countries">, wanted: string | null): CountryTotal | null {
  return o.countries.find((c) => c.code === wanted) ?? o.countries[0] ?? null;
}

/** The team records a country links to: its team-season rows for the overview's season. */
export function countryHref(code: string, season: number, currentSeason: number): string {
  const q = new URLSearchParams({ view: "season" });
  if (season !== currentSeason) q.set("season", String(season));
  q.set("country", code);
  return `/teams?${q}`;
}

export interface Reconciliation {
  total: number;
  /** Listings in countries the map draws. */
  drawn: number;
  /** Listings in countries too small for the map's scale (still in the list). */
  undrawn: number;
  /** Listings with no country (blank, "Independent", an unrecognised label). */
  unmapped: number;
  /** Countries the map doesn't draw, by name. */
  undrawnCountries: CountryTotal[];
}

/**
 * How the season's listings split. `drawnIds` is the set of ISO numeric codes the
 * loaded geometry has (null until it loads: every country counts as drawn until then).
 * drawn + undrawn + unmapped = total, always.
 */
export function reconcile(o: Pick<HomeOverview, "countries" | "unmapped" | "coverage">, drawnIds: ReadonlySet<string> | null): Reconciliation {
  const undrawnCountries = drawnIds ? o.countries.filter((c) => !drawnIds.has(c.numeric)) : [];
  const sum = (xs: { listings: number }[]) => xs.reduce((a, x) => a + x.listings, 0);
  const undrawn = sum(undrawnCountries);
  const unmapped = sum(o.unmapped);
  return { total: o.coverage.teamListings, drawn: sum(o.countries) - undrawn, undrawn, unmapped, undrawnCountries };
}

/** A label for listings without a country. */
export const unmappedLabel = (label: string | null) => (label == null ? "Country not reported" : `Reported as “${label}”`);
