// The search spelling experiment's query set (docs: scripts/search-experiment/README.md).
//
// Every expected answer is written here, from the database by plain SQL lookups (never through search), BEFORE any
// arm is built or run, and committed on its own so the scoring can't drift to favour an arm.
//
// `expect` is what the TOP result must be:
//   { team }            that team number first
//   { event }           that event ("season:CODE") first
//   { empty: true }     no results at all (the page then shows its no-results help, never junk)
//   { page }            a site page (the brief's "Pages group"); see the note on "records"
// `facts`: the top team must also carry an answer line (rank / record / ranking score / OPR).

export type Expect = { team: number } | { event: string } | { empty: true } | { page: string };
export interface Case { q: string; kind: string; expect: Expect; facts?: boolean; note?: string }

export const CASES: Case[] = [
  // From the brief
  { q: "4215", kind: "exact", expect: { team: 4215 } },
  { q: "team 4215", kind: "exact", expect: { team: 4215 } },
  { q: "hypnotic", kind: "name", expect: { team: 4215 } },
  { q: "bad wolf", kind: "name", expect: { team: 6980 } },
  { q: "hypnotic ranking point", kind: "natural", expect: { team: 4215 }, facts: true },
  { q: "hipnotic", kind: "misspelling", expect: { team: 4215 } },
  { q: "hypnotik", kind: "misspelling", expect: { team: 4215 } },
  { q: "hypnotic rankng pont", kind: "misspelling", expect: { team: 4215 }, facts: true },
  { q: "bad wulf", kind: "misspelling", expect: { team: 6980 } },
  {
    q: "records", kind: "page", expect: { page: "/teams" },
    note: "The brief expects a records page in a Pages group. Search is content-only by an earlier product rule (no navigation shortcuts), and /records redirects to /teams. Scored as written; every arm is expected to miss it until that rule is decided.",
  },
  { q: "asdfgh", kind: "gibberish", expect: { empty: true } },
  { q: "", kind: "empty", expect: { empty: true } },

  // More from real names in the data (looked up by SQL first)
  { q: "cyber dragons", kind: "name", expect: { team: 10820 } },
  { q: "cyber dragins", kind: "misspelling", expect: { team: 10820 } },
  { q: "brainstormers", kind: "name", expect: { team: 8644 } },
  { q: "brainstromers", kind: "misspelling", expect: { team: 8644 } },
  { q: "x drive", kind: "name", expect: { team: 16321 } },
  { q: "new jersey championship", kind: "event", expect: { event: "2026:USNJCMP" } },
  { q: "new jersy championship", kind: "misspelling", expect: { event: "2026:USNJCMP" } },
  { q: "pennsylvania championship", kind: "event", expect: { event: "2026:USPACMP" } },
  { q: "pensylvania champs", kind: "misspelling", expect: { event: "2026:USPACMP" } },
  { q: "how many awards did hypnotic robotics win", kind: "natural", expect: { team: 4215 }, facts: true },
  { q: "what is bad wolf's opr", kind: "natural", expect: { team: 6980 }, facts: true },
  { q: "who is team 6980", kind: "natural", expect: { team: 6980 } },
  { q: "hypnotic robtics", kind: "misspelling", expect: { team: 4215 } },
];
