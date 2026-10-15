// Region names people type for the codes FIRST stores ("New Jersey" for NJ),
// shared by the Events filter and the search index. Codes are per country:
// "MT" is Montana in the USA but Mato Grosso in Brazil. "Name|aliases".

const US: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia|Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam",
  VI: "Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands", AE: "Armed Forces Europe", AP: "Armed Forces Pacific",
};

const CA: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec|Québec", SK: "Saskatchewan", YT: "Yukon",
};

const AU: Record<string, string> = {
  NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", SA: "South Australia", WA: "Western Australia",
  TAS: "Tasmania", ACT: "Australian Capital Territory|Canberra", NT: "Northern Territory",
};

const GB: Record<string, string> = { ENG: "England", SCT: "Scotland", WLS: "Wales", NIR: "Northern Ireland" };

const STATES: Record<string, Record<string, string>> = { USA: US, Canada: CA, Australia: AU, "United Kingdom": GB };

/** Other names for the country names FIRST uses. */
const COUNTRY: Record<string, string> = {
  USA: "United States of America US America",
  "United Kingdom": "UK Great Britain Britain",
  "United Arab Emirates": "UAE",
  Türkiye: "Turkey",
  "South Korea": "Korea",
};

/** The full names for a place's codes, e.g. ("NJ", "USA") → "New Jersey United States of America US America". */
export function regionNames(state: string | null | undefined, country: string | null | undefined): string {
  const st = state && country ? STATES[country]?.[state.toUpperCase()]?.replace("|", " ") : undefined;
  return [st, country ? COUNTRY[country] : undefined].filter(Boolean).join(" ");
}

/** "USA:NJ" → "New Jersey" (the code itself when unknown). */
export function regionLabel(key: string): string {
  const [country, state] = key.split(":");
  return (state && STATES[country]?.[state]?.split("|")[0]) || state || country;
}

export interface Region { key: string; country: string; state: string; name: string }

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const ALL: (Region & { names: string[] })[] = Object.entries(STATES).flatMap(([country, m]) =>
  Object.entries(m).map(([state, v]) => ({ key: `${country}:${state}`, country, state, name: v.split("|")[0], names: v.split("|").map(fold) })));

/** Regions a search names: a full name or its start ("new jers"), or a US/Canadian code typed alone ("NJ"). */
export function findRegions(q: string): Region[] {
  const f = fold(q);
  if (f.length < 2) return [];
  const exact = ALL.filter((r) => r.names.includes(f) || ((r.country === "USA" || r.country === "Canada") && r.state.toLowerCase() === f));
  if (exact.length || f.length < 4) return exact.map(({ names: _, ...r }) => r);
  return ALL.filter((r) => r.names.some((n) => n.startsWith(f))).slice(0, 3).map(({ names: _, ...r }) => r);
}
