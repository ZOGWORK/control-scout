// Which seasons have a quick reference, without the content itself: the event page and the menu ask this,
// and importing ./index would pull every season's text into their chunks. index.test.ts keeps it in step.
export const RULE_SEASON_IDS: readonly number[] = [2026];

export const hasRuleReference = (season: number) => RULE_SEASON_IDS.includes(season);
