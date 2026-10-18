// Countries as the team directory reports them, normalised for the home page's
// atlas and the /teams?country= filter. FIRST's labels are free text ("USA",
// "Türkiye", "eSwatini" and "Eswatini" both, "Chinese Taipei"), so every label
// is folded and looked up here: a known one becomes an ISO 3166-1 country, and
// anything else ("Independent", blank, a label we haven't seen) stays unmapped,
// never dropped, so mapped + unmapped always add up to the season's listings.
// `numeric` is the ISO numeric code that published boundary files key countries by.

export interface Country {
  /** ISO 3166-1 alpha-2, the filter's value (?country=US). */
  code: string;
  /** ISO 3166-1 numeric, zero-padded ("840"): how boundary geometry names a country. */
  numeric: string;
  /** Display name. */
  name: string;
}

// [alpha-2, numeric, display name, ...other labels FIRST or common usage gives it]
const TABLE: [string, string, string, ...string[]][] = [
  ["US", "840", "United States", "USA", "US", "United States of America", "U.S.A."],
  ["CA", "124", "Canada"], ["MX", "484", "Mexico"],
  ["GB", "826", "United Kingdom", "UK", "Great Britain", "England", "Scotland", "Wales", "Northern Ireland"],
  ["KZ", "398", "Kazakhstan"], ["RO", "642", "Romania"], ["CN", "156", "China", "People's Republic of China"],
  ["AU", "036", "Australia"], ["LY", "434", "Libya"], ["BR", "076", "Brazil", "Brasil"],
  ["TR", "792", "Türkiye", "Turkey", "Turkiye"], ["FR", "250", "France"], ["VN", "704", "Vietnam", "Viet Nam"],
  ["IN", "356", "India"], ["IL", "376", "Israel"], ["KR", "410", "South Korea", "Korea", "Republic of Korea", "Korea, Republic of"],
  ["ZA", "710", "South Africa"], ["TH", "764", "Thailand"], ["NL", "528", "Netherlands", "The Netherlands", "Holland"],
  ["IT", "380", "Italy"], ["TW", "158", "Chinese Taipei", "Taiwan"], ["JM", "388", "Jamaica"], ["LT", "440", "Lithuania"],
  ["ID", "360", "Indonesia"], ["VE", "862", "Venezuela"], ["NZ", "554", "New Zealand"], ["MD", "498", "Moldova", "Republic of Moldova"],
  ["GR", "300", "Greece"], ["CY", "196", "Cyprus"], ["NG", "566", "Nigeria"], ["UZ", "860", "Uzbekistan"], ["UA", "804", "Ukraine"],
  ["DE", "276", "Germany"], ["MY", "458", "Malaysia"], ["QA", "634", "Qatar"], ["AR", "032", "Argentina"],
  ["AE", "784", "United Arab Emirates", "UAE"], ["JP", "392", "Japan"], ["PY", "600", "Paraguay"], ["SA", "682", "Saudi Arabia"],
  ["MA", "504", "Morocco"], ["PL", "616", "Poland"], ["CO", "170", "Colombia"], ["KG", "417", "Kyrgyzstan"], ["AF", "004", "Afghanistan"],
  ["HU", "348", "Hungary"], ["AD", "020", "Andorra"], ["SZ", "748", "Eswatini", "eSwatini", "Swaziland"], ["BB", "052", "Barbados"],
  ["AO", "024", "Angola"], ["EC", "218", "Ecuador"], ["AL", "008", "Albania"], ["ZW", "716", "Zimbabwe"], ["ES", "724", "Spain"],
  ["GH", "288", "Ghana"], ["DO", "214", "Dominican Republic"], ["CZ", "203", "Czechia", "Czech Republic"], ["BY", "112", "Belarus"],
  ["TT", "780", "Trinidad and Tobago"], ["ET", "231", "Ethiopia"], ["CM", "120", "Cameroon"], ["BE", "056", "Belgium"],
  ["AZ", "031", "Azerbaijan"], ["SI", "705", "Slovenia"], ["PH", "608", "Philippines"], ["PE", "604", "Peru"], ["PA", "591", "Panama"],
  ["HT", "332", "Haiti"], ["EE", "233", "Estonia"], ["BD", "050", "Bangladesh"], ["ZM", "894", "Zambia"], ["TM", "795", "Turkmenistan"],
  ["CH", "756", "Switzerland"], ["SG", "702", "Singapore"], ["PT", "620", "Portugal"], ["PK", "586", "Pakistan"], ["NO", "578", "Norway"],
  ["LS", "426", "Lesotho"], ["IE", "372", "Ireland"], ["EG", "818", "Egypt"], ["KY", "136", "Cayman Islands"], ["AT", "040", "Austria"],
  ["AG", "028", "Antigua and Barbuda"], ["UY", "858", "Uruguay"], ["LK", "144", "Sri Lanka"], ["SN", "686", "Senegal"],
  ["SM", "674", "San Marino"], ["MN", "496", "Mongolia"], ["MK", "807", "North Macedonia", "Macedonia"], ["LA", "418", "Laos", "Lao PDR"],
  ["KW", "414", "Kuwait"], ["JO", "400", "Jordan"], ["GN", "324", "Guinea"], ["GE", "268", "Georgia"], ["CR", "188", "Costa Rica"],
  ["CL", "152", "Chile"], ["TD", "148", "Chad"], ["BS", "044", "Bahamas", "The Bahamas"], ["AM", "051", "Armenia"], ["AI", "660", "Anguilla"],
  ["DZ", "012", "Algeria"], ["UG", "800", "Uganda"], ["TZ", "834", "Tanzania"], ["SE", "752", "Sweden"], ["SD", "729", "Sudan"],
  ["SB", "090", "Solomon Islands"], ["RS", "688", "Serbia"], ["RW", "646", "Rwanda"], ["PS", "275", "Palestine"], ["MW", "454", "Malawi"],
  ["LR", "430", "Liberia"], ["LV", "428", "Latvia"], ["CI", "384", "Côte d'Ivoire", "Ivory Coast", "Cote d'Ivoire"], ["IQ", "368", "Iraq"],
  ["GT", "320", "Guatemala"], ["SV", "222", "El Salvador"], ["DK", "208", "Denmark"], ["KM", "174", "Comoros"], ["KH", "116", "Cambodia"],
  ["BN", "096", "Brunei"], ["BW", "072", "Botswana"], ["BA", "070", "Bosnia and Herzegovina", "Bosnia-Herzegovina", "Bosnia"],
  ["BT", "064", "Bhutan"], ["BM", "060", "Bermuda"], ["BJ", "204", "Benin"], ["BH", "048", "Bahrain"], ["BO", "068", "Bolivia"],
  ["BI", "108", "Burundi"], ["CV", "132", "Cabo Verde", "Cape Verde"], ["HR", "191", "Croatia"], ["CU", "192", "Cuba"], ["FI", "246", "Finland"],
  ["GM", "270", "Gambia", "The Gambia"], ["IR", "364", "Iran"], ["KE", "404", "Kenya"], ["ML", "466", "Mali"], ["MT", "470", "Malta"],
  ["ME", "499", "Montenegro"], ["NE", "562", "Niger"], ["KP", "408", "North Korea"], ["OM", "512", "Oman"], ["PG", "598", "Papua New Guinea"],
  ["SX", "534", "Sint Maarten"], ["SO", "706", "Somalia"], ["SY", "760", "Syria"], ["RU", "643", "Russia", "Russian Federation"],
  ["IS", "352", "Iceland"], ["SK", "703", "Slovakia"], ["BG", "100", "Bulgaria"], ["TN", "788", "Tunisia"], ["LB", "422", "Lebanon"],
  ["NP", "524", "Nepal"], ["HK", "344", "Hong Kong"], ["MO", "446", "Macao", "Macau"], ["HN", "340", "Honduras"], ["NI", "558", "Nicaragua"],
  ["TJ", "762", "Tajikistan"], ["LU", "442", "Luxembourg"], ["MU", "480", "Mauritius"], ["NA", "516", "Namibia"], ["MZ", "508", "Mozambique"],
  ["MG", "450", "Madagascar"], ["CD", "180", "DR Congo", "Democratic Republic of the Congo"], ["CG", "178", "Republic of the Congo"],
  ["TG", "768", "Togo"], ["BF", "854", "Burkina Faso"], ["SL", "694", "Sierra Leone"], ["MM", "104", "Myanmar"], ["FJ", "242", "Fiji"],
  ["BZ", "084", "Belize"], ["GY", "328", "Guyana"], ["SR", "740", "Suriname"], ["PR", "630", "Puerto Rico"], ["YE", "887", "Yemen"],
  ["MV", "462", "Maldives"], ["GL", "304", "Greenland"], ["LC", "662", "Saint Lucia"], ["GD", "308", "Grenada"], ["DM", "212", "Dominica"],
  ["KN", "659", "Saint Kitts and Nevis"], ["VC", "670", "Saint Vincent and the Grenadines"],
];

/** Lowercase, accents and punctuation dropped: "Türkiye" → "turkiye", "eSwatini" → "eswatini". */
export const countryKey = (label: string) => label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const BY_CODE = new Map<string, Country>();
const BY_KEY = new Map<string, Country>();
for (const [code, numeric, name, ...aliases] of TABLE) {
  const c: Country = { code, numeric, name };
  BY_CODE.set(code, c);
  for (const label of [name, ...aliases]) BY_KEY.set(countryKey(label), c);
}

/** The country a directory label names, or null (blank, "Independent", unknown). */
export function countryOf(label: string | null | undefined): Country | null {
  if (label == null) return null;
  const k = countryKey(label);
  return k ? BY_KEY.get(k) ?? null : null;
}

/** A country by its alpha-2 code (any case), or null. */
export const countryByCode = (code: string | null | undefined): Country | null => (code ? BY_CODE.get(code.toUpperCase()) ?? null : null);

/** Every known country (for lists and tests). */
export const COUNTRIES: readonly Country[] = [...BY_CODE.values()];
