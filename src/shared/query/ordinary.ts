// Ordinary words: the words a question is said in, never by themselves a team's name (docs/search-pipeline.md,
// "Names"). A team's name made only of them ("I Forgot", "Lost In Time", "The Average Savages" called "average") is a
// team only when the query refers to a team there: its number beside it, "team" before it, or its whole name typed
// where a team is asked about. In a question that asks which team ("who won …", "which event …"), or as part of a
// name, they are words. Data only: no team, event or place is named here.
import { LEXICON } from "./lexicon.js";
import { COMMON_WORDS, QUESTION_WORDS, STOPWORDS, TOPIC_WORDS } from "../searchQuery.js";

/** Everyday English beyond search's own words: the frame of a question and what people say around it. Function words,
 *  common verbs in their forms, common adjectives with their comparatives and superlatives, and common nouns of time,
 *  amount and talk. Words that mostly appear in team names (animals, elements, weather, machines) are left out. */
const EVERYDAY = `
a about above after against ago all almost alone along already also although always am among an and another any
anybody anyone anything anyway anywhere are around as ask asked asking asks at away back bad badly be became because
become becomes been before began begin behind being believe below beside besides best better between beyond big bigger
biggest both bring brought but by call called calling came can cannot cant care case certain certainly change changed
check checked choke choked chokes choking choose chose chosen clear clearly close closer come comes coming could couldnt
day days did didnt different do does doesnt doing done dont down during each early earlier easier easiest easy either
else end ended enough even ever every everybody everyone everything everywhere exactly except fact fairly far feel felt
few fewer fewest find finding finds fine first for forget forgets forgetting forgot forgotten found from full gave get
gets getting give given gives giving go goes going gone good got gotten great greater greatest guess guys had hadnt half
happen happened happening happens hard harder hardest has hasnt have havent having he hear heard her here hers herself
him himself his hope how however i id if ill im in instead into is isnt it its itself just keep kept kind knew know
known knows last late later latest least leave left less let lets like liked likes little long longer longest look looked
looking looks lot lots made make makes making many may maybe me mean meant might mine mind month months more most mostly
much must my myself near need needed needs never new newer newest next nice no nobody none nor not nothing now of off
often oh ok okay old older oldest on once one ones only onto or other others otherwise our ours ourselves out over own
part people perhaps place please pls point put quite rather real really remember remembered right said same saw say
saying says see seem seemed seems seen several shall she should shouldnt show showed shown shows since so some somebody
someone something sometimes somewhere soon sorry still stuff such suppose supposed sure take taken takes taking tell
telling tells than thank thanks that thats the their theirs them themselves then there theres these they theyre thing
things think thinking thinks this those though thought through thus time times to today together told too took tough
tougher toughest toward towards tried tries try trying turn turned under unless until up upon us use used using usually
very want wanted wants was wasnt way ways we week weeks well went were werent what whatever whats when whenever where
whether which while who whoever whole whom whose why will with within without wonder wondering wont would wouldnt wow
yeah year years yes yet you your youre yours yourself yourselves date dates
`;
/** Search's own words that are everyday English too: ordinary in a name, never an aside to drop. */
const ASKED = `
win wins winning won lose loses losing lost beat beats beaten play plays played playing score scores scored scoring
average typical actual actually predicted expected hardest easiest strongest weakest toughest
worlds world states state champs champ championship championships again
`;
/** What people say around a question and never ask with: forgetting, wondering, politeness, a shrug. Dropped from a
 *  query's end ("…, i forgot", "… date please"); every other plain word may carry the question ("near me", "anything"). */
const ASIDE = `
forgot forget forgets forgetting forgotten remember remembered wonder wondering guess suppose think thinking thought
please pls plz thanks thank thx sorry honestly nah lol idk btw anyway date dates
`;
const words = (t: string) => t.split(/\s+/).filter(Boolean);
/** The aside words alone, without search's own words. */
const PLAIN = new Set(words(ASIDE));
/** Every word search's lexicon reads as something other than filler. */
const READ = new Set(LEXICON.filter((e) => !e.syms.every((x) => x.k === "filler")).flatMap((e) => e.words));

/** Every ordinary word: everyday English, and every word search's own readers read (its lexicon, its topic, common,
 *  question and stop words). */
export const ORDINARY = new Set<string>([
  ...words(EVERYDAY), ...words(ASKED), ...words(ASIDE),
  ...LEXICON.flatMap((e) => e.words),
  ...COMMON_WORDS, ...TOPIC_WORDS, ...QUESTION_WORDS, ...STOPWORDS,
]);

/** The words of `s`, lower case, letters and digits only (a possessive dropped). */
const wordsOf = (s: string) => s.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether every word of `s` is an ordinary word (none is a number): a name made only of them is no team by itself. */
export function onlyOrdinary(s: string): boolean {
  const ws = wordsOf(s);
  return ws.length > 0 && ws.every((w) => ORDINARY.has(w) || ORDINARY.has(w.replace(/s$/, "")));
}

/** Whether `q` asks which team (or which event, which division): "who won …", "who has …", "whose …", "which …". The
 *  team is the answer, so an ordinary word in it never names one. */
export function asksWhich(q: string): boolean {
  return /(?:^|[^\p{L}])(?:who|whom|whose|whos|which)(?=[^\p{L}]|$)/u.test(q.toLowerCase().replace(/[’']/g, ""));
}

/** Whether `w` only talks around a question ("forgot", "date", "honestly"): an aside word, none of search's own words
 *  (its lexicon, topics and the plural of one), so dropping it from a query's end never drops what was asked. */
export function asideWord(w: string): boolean {
  const x = w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const plain = x.replace(/s$/, "");
  return !!x && PLAIN.has(x) && !READ.has(x) && !TOPIC_WORDS.has(x) && !TOPIC_WORDS.has(plain) && !READ.has(plain) && !COMMON_WORDS.has(x);
}
