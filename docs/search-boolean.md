# Search: boolean operators

FTC One Search reads `and`, `or` and `not` between teams the way a web search does, and reads double quotes as one
exact phrase. The code is `server/api/searchBoolean.ts`; its tests (the brief's ten cases and more) are
`server/api/searchBoolean.test.ts`. Fixed rules, no model.

## Operators

| Operator | Written | Means |
|---|---|---|
| AND | `and`, `&` (any case) | every team named is in the match, on either alliance |
| OR | `or`, `\|` | any of the teams is in the match; a match with several is listed once |
| NOT | `not`, or `-` right before a term (`-6980`) | the team after it isn't in the match |
| Exact phrase | `"Raider Robotics"` | those words together, in that order, as one name |

Precedence is fixed: NOT binds tightest, then AND, then OR. There are no parentheses. `4215 and 6980 or 23268 not
14270` is (4215 AND 6980) OR (23268 AND NOT 14270). `and not` and `or not` work as written.

A team "is in a match" when its robot was on the field for it (a no-show isn't). Matches are the stored, scored
matches at official in-person events, as every record on the site.

## What the query asks comes first

The operators never change the kind of answer; they say which teams it covers.

| Query | Answer |
|---|---|
| `4215 and 6980`, `4215 and 6980 matches` | the matches with both teams, newest first (25 shown, the total said) |
| `4215 or 6980` | the matches with either team, each once |
| `4215 not 6980`, `4215 -6980` | 4215's matches without 6980 in them |
| `4215 and 6980 opr`, `4215 or 6980 opr` | both teams' OPR side by side, read as `4215 vs 6980 opr` (the same for the prediction rating) |
| `4215 and 6980 record` (any other stat) | each team's own answer to `<team> record` (this season's, said so, when no season is named and the stat needs one), drawn as the search's team table (src/components/search/TeamTable.tsx): each team's season OPR, its phases, penalties and record, the stat asked as its own column, its values as the headline; with a Compare link, and each team's link opens what its own answer opens |
| `4215 not 6980 opr` | 4215's OPR, saying 6980 was left out |
| `"Raider Robotics"` | the teams named exactly that first, then names holding the phrase word for word; never a name with the words apart |
| `"Robotics Raider"` | "No team or event name holds "Robotics Raider" word for word", with the closest names offered; the quotes are never dropped |
| `"bad wolf" opr` | the one team named exactly "Bad Wolf", and its OPR; a name several teams share (`"raider robotics" opr`) lists them and asks which, by number |
| `"4215 opr"` | a quoted question is read as the question |

A season, "this season" or a match type can follow a match list (`4215 and 6980 matches 2024-25`, `4215 or 6980 in
playoffs`). An AND with nothing in common says so plainly ("Hypnotic Robotics (4215) and Bad Wolf (6980) have no shared
matches."), shows each team's own match count, and links the OR list.

## What stays as it was

- A query with no operator and no quotes never reaches this reader: it goes through the layers (docs/search-layers.md)
  exactly as before.
- **`vs` and `versus` are untouched**: `4215 vs 6980` is still Compare.
- **Head to head stays head to head.** `have 4215 and 6980 played each other`, `4215 and 6980 head to head`, `compare
  4215 and 6980`, `who would win 4215 or 6980`, `4215 or 6980 who wins` and `who has a better record 4215 or 6980`
  keep their own readings. Words before the first team, or words like "vs", "head to head", "who", "better",
  "against" or "each other" after the last, leave the query to them. The difference is deliberate: head to head is
  the matches they played *against* each other, with a record; AND is every match they were both in, partners or
  opponents, with how many of each.
- A team name holding an operator word is a name: `nuts and bolts`, `wingus & dingus` and `batteries not included`
  are those teams, and `nuts and bolts and 4215` is two teams.
- A year beside a team number is a season, as before (`4215 and 2025` is not two teams).
- `not` before a word that isn't a team (`4215 not opr`) is declined plainly: NOT leaves a team out of a list, it can't
  leave out a stat. The answer says so and links `4215 opr` and `4215 matches`; it never shows the team page as if it
  had answered.
- Every term must be one team: a number on record, a full name, or a quoted name only one team has. Anything else
  (an unknown number, a word that isn't a team) leaves the query to the other readers.

## Limits

At most 8 teams in one expression; a match list shows 25 matches and says how many there are. Each team's matches
come from the same cached match set the stat answers read (`server/api/answers/matchSet.ts`); nothing is rated or
worked out from scratch inside a search.
