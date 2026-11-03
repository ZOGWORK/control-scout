// The paraphrase sets (docs/search-layers.md, section 8 of the redundancy brief): for every intent, phrasings that
// must all return the canonical form's answer. A test set, not examples: ./searchLayers.test.ts runs every member.
// Teams: 4215 Hypnotic Robotics and 6980 Bad Wolf (the test fixture's, and real teams on the live site).

export interface ParaphraseSet {
  intent: string;
  canonical: string;
  /** Each tagged with the brief's dimension: reversed, question, statement, of, filler, long, slang, name, scope. */
  members: [string, string][];
}

export const PARAPHRASE_SETS: ParaphraseSet[] = [
  { intent: "location", canonical: "4215 location", members: [
    ["question", "where is 4215 from"], ["reversed", "4215 from where"], ["reversed", "4215 where from"], ["question", "where does 4215 come from"],
    ["statement", "4215 located"], ["name", "hypnotic robotics location"], ["of", "location of 4215"], ["filler", "please 4215 location"],
    ["filler", "4215 please location"], ["filler", "4215 location please"], ["slang", "4215 location rn"],
    ["long", "hey where is the team called hypnotic robotics located right now please"], ["statement", "4215 hometown"],
  ] },
  { intent: "school", canonical: "4215 school", members: [
    ["question", "what school is 4215"], ["of", "school of 4215"], ["filler", "4215 school please"], ["reversed", "school 4215"],
    ["name", "hypnotic robotics school"], ["long", "what is the school of this team called hypnotic robotics right now"],
  ] },
  { intent: "sponsors", canonical: "4215 sponsors", members: [
    ["question", "who sponsors 4215"], ["of", "sponsors of 4215"], ["filler", "4215 sponsors pls"], ["reversed", "sponsors 4215"], ["name", "hypnotic robotics sponsors"],
  ] },
  { intent: "rookie-year", canonical: "4215 rookie year", members: [
    ["of", "rookie year of 4215"], ["reversed", "rookie year 4215"], ["filler", "4215 rookie year please"],
    ["long", "what is the rookie year of the team called hypnotic robotics please"],
  ] },
  { intent: "opr", canonical: "4215 opr", members: [
    ["of", "what is the opr of 4215"], ["question", "what is 4215 opr"], ["question", "show me 4215 opr"], ["reversed", "opr 4215"],
    ["filler", "rn 4215 opr"], ["filler", "4215 rn opr"], ["filler", "4215 opr rn"], ["slang", "4215 opr right now"],
    ["filler", "what is 4215 opr right now"], ["filler", "what is the opr of 4215 rn"], ["name", "hypnotic robotics opr"],
    ["filler", "currently 4215 opr"], ["filler", "4215 opr at the moment"],
    ["long", "what is the opr of the team called hypnotic robotics right now please"],
  ] },
  { intent: "opr (season)", canonical: "4215 opr decode", members: [
    ["long", "what was the opr of this team called hypnotic robotics in the decode year"], ["name", "hypnotic robotics opr decode"],
    ["scope", "decode 4215 opr"], ["scope", "4215 decode opr"], ["scope", "4215 opr 2025-26"], ["scope", "2025-26 opr 4215"],
    ["filler", "4215 opr decode please"],
  ] },
  { intent: "opr (phase)", canonical: "4215 auto opr", members: [
    ["of", "auto opr of 4215"], ["reversed", "auto opr 4215"], ["statement", "4215 auto"], ["filler", "4215 auto opr rn"], ["question", "what is 4215 auto opr"],
  ] },
  { intent: "rating", canonical: "4215 prediction rating", members: [
    ["of", "prediction rating of 4215"], ["reversed", "prediction rating 4215"], ["filler", "4215 prediction rating please"],
    ["long", "what is the prediction rating for the team called hypnotic robotics right now"],
  ] },
  { intent: "record", canonical: "4215 record", members: [
    ["reversed", "record 4215"], ["of", "record of 4215"], ["filler", "4215 record please"], ["name", "hypnotic robotics record"],
  ] },
  { intent: "record (season)", canonical: "4215 record 2024-25", members: [
    ["scope", "2024-25 4215 record"], ["scope", "4215 2024-25 record"], ["of", "record of 4215 in 2024-25"], ["filler", "4215 record 2024-25 please"],
  ] },
  { intent: "matches", canonical: "4215 matches", members: [
    ["reversed", "matches 4215"], ["of", "matches of 4215"], ["filler", "4215 matches please"], ["question", "show me 4215 matches"],
  ] },
  { intent: "awards", canonical: "4215 awards", members: [
    ["reversed", "awards 4215"], ["of", "awards of 4215"], ["filler", "4215 awards please"], ["statement", "4215 trophies"], ["name", "hypnotic robotics awards"],
  ] },
  { intent: "awards (by name)", canonical: "4215 inspire award", members: [
    ["reversed", "inspire award 4215"], ["filler", "4215 inspire award please"],
  ] },
  { intent: "events (season)", canonical: "4215 events in 2025-26", members: [
    ["scope", "2025-26 4215 events"], ["reversed", "events 2025-26 4215"], ["scope", "4215 2025-26 events"], ["of", "events of 4215 in 2025-26"],
    ["filler", "4215 events in 2025-26 please"], ["statement", "4215 competitions 2025-26"],
  ] },
  { intent: "events (place)", canonical: "4215 events in new jersey", members: [
    ["scope", "new jersey 4215 events"], ["scope", "4215 new jersey events"], ["filler", "4215 events in new jersey please"],
  ] },
  { intent: "next match", canonical: "4215 next match", members: [
    ["of", "next match of 4215"], ["reversed", "next match 4215"], ["filler", "4215 next match please"],
  ] },
  { intent: "next event", canonical: "4215 next event", members: [
    ["of", "next event of 4215"], ["reversed", "next event 4215"], ["filler", "4215 next event please"],
  ] },
  { intent: "last event", canonical: "4215 last event", members: [
    ["reversed", "last event 4215"], ["filler", "4215 last event please"], ["statement", "4215 most recent event"],
  ] },
  { intent: "worlds", canonical: "4215 worlds", members: [
    ["reversed", "worlds 4215"], ["filler", "4215 worlds please"], ["name", "hypnotic robotics worlds"],
  ] },
  { intent: "winners (event)", canonical: "who won new jersey championship", members: [
    ["filler", "who won new jersey championship please"], ["statement", "new jersey championship winners"],
  ] },
  { intent: "winners (award)", canonical: "who won inspire at new jersey championship", members: [
    ["filler", "who won inspire at new jersey championship please"],
  ] },
  { intent: "leaderboard (stat and place)", canonical: "top opr in new jersey", members: [
    ["scope", "best opr nj"], ["scope", "nj best opr"], ["filler", "top opr in new jersey please"], ["scope", "new jersey top opr"], ["statement", "highest opr in nj"],
  ] },
  { intent: "leaderboard (phase)", canonical: "top auto opr", members: [
    ["filler", "top auto opr please"], ["statement", "best auto opr"], ["slang", "best auto rn"],
  ] },
  { intent: "count", canonical: "how many teams in new jersey", members: [
    ["filler", "how many teams in nj please"], ["statement", "number of teams in new jersey"],
  ] },
  { intent: "meaning", canonical: "what is opr", members: [
    ["statement", "define opr"], ["reversed", "opr meaning"], ["filler", "what is opr please"], ["question", "what does opr mean"],
  ] },
  { intent: "versus", canonical: "4215 vs 6980", members: [
    ["filler", "4215 vs 6980 please"], ["statement", "compare 4215 and 6980"], ["statement", "4215 versus 6980"],
    ["question", "is 4215 better than 6980"], ["name", "hypnotic robotics vs bad wolf"],
  ] },
];
