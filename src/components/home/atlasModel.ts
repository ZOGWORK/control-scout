// The atlas's numbers, kept apart from its drawing so they can be tested: which
// country is selected, what it links to, and how the season's listings split
// into countries (drawn or not) and listings no country can be given to.
import type { CountryTotal, HomeOverview, SeasonReadiness } from "../../shared/home";

/** The selected country: the one asked for if it has listings, else the one with the most. */
export function pickCountry(o: Pick<HomeOverview, "countries">, wanted: string | null): CountryTotal | null {
  return o.countries.find((c) => c.code === wanted) ?? o.countries[0] ?? null;
}

/**
 * Where a country leads, for the overview's season: its team-season records ("season", the teams with
 * results, ranked by their statistics) or the directory of every team registered there ("listed").
 */
export function countryHref(code: string, season: number, currentSeason: number, view: "season" | "listed" = "season"): string {
  const q = new URLSearchParams({ view });
  if (season !== currentSeason) q.set("season", String(season));
  q.set("country", code);
  return `/teams?${q}`;
}

/** The directory of every team listed for the season, any country (where listings no country can be given to are). */
export function directoryHref(season: number, currentSeason: number): string {
  const q = new URLSearchParams({ view: "listed" });
  if (season !== currentSeason) q.set("season", String(season));
  return `/teams?${q}`;
}

/** What the atlas says about a country's teams with results (DATA-F01: a zero is only a fact when the statistics are ready). */
export type ResultsLine =
  /** Teams with results, linked. `behind`: from the last preparation, newer results are still being added. */
  | { kind: "link"; count: number; behind: boolean }
  /** The statistics are ready and no team from this country has played: the true zero. */
  | { kind: "none" }
  /** Results have been played this season but the statistics aren't prepared yet: no count at all. */
  | { kind: "preparing" }
  /** None in the last preparation, but newer results are waiting for the next one (or readiness is unknown). */
  | { kind: "pending" };

export function resultsLine(c: Pick<CountryTotal, "withResults">, readiness: SeasonReadiness | undefined): ResultsLine {
  const state = readiness?.state;
  if (state === "preparing") return { kind: "preparing" };
  if (c.withResults > 0) return { kind: "link", count: c.withResults, behind: state === "catching-up" };
  return state === "ready" ? { kind: "none" } : { kind: "pending" };
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
