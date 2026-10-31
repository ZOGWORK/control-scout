// The question-box quick reference (/rules): a short, searchable summary of each season's game manual plus
// its published Q&A rulings, kept in the repo as static content so it ships inside the app and opens with
// no signal (the service worker precaches every built chunk). Summaries are our own words, never the
// official text: the page always links the official manual and says to check it.

export interface RuleSection {
  /** The manual's section number, e.g. "11.4.5". */
  id: string;
  title: string;
  /** The chapter it sits in, for the section browser ("In-match", "Robot", …). */
  part: string;
}

export interface RuleEntry {
  /** The rule or section number as printed in the manual ("G421", "10.6.1"); also the entry's #anchor. */
  id: string;
  /** RuleSection.id this entry belongs to. */
  section: string;
  title: string;
  /** What breaking it costs, in short, when the manual says. */
  penalty?: string;
  /** One or two sentences, our own words. */
  summary: string;
  /** Extra words people search for that aren't in the title or summary ("pin", "defense"). */
  keywords?: string[];
}

export interface QaRuling {
  /** The Q&A number, e.g. 23 for Q23. */
  n: number;
  /** When it was answered, YYYY-MM-DD. */
  answered: string;
  /** Rule numbers it is about. */
  rules: string[];
  title: string;
  /** The question and the answer, summarised in our words. Always shown as unofficial guidance. */
  summary: string;
}

export interface SeasonReference {
  season: number;
  game: string;
  /** "2026–27" */
  label: string;
  manual: {
    /** The revision this reference follows, as FIRST labels it ("TU07"). */
    revision: string;
    /** That revision's date, YYYY-MM-DD. */
    date: string;
    /** The official manual (PDF) and its web version. */
    url: string;
    htmlUrl: string;
  };
  qa: {
    url: string;
    /** The day the answered questions were last read, YYYY-MM-DD. */
    readOn: string;
  };
  sections: RuleSection[];
  rules: RuleEntry[];
  rulings: QaRuling[];
}
