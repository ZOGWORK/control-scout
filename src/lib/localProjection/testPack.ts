// Test fixture for the local estimate: a small qualifier in a real-schema season pack (Q1–Q2 played, Q3–Q4
// scheduled, official slots with an already-qualified and an ineligible team), a lite pack of fresh ratings,
// and the prepareLocal deps that read them.
import { FITTED_MODEL, RatingBook, type BonusFlags } from "@control-scout/predict-engine";
import { readEventDetail, wrap, type SeasonDb } from "../offline/readers";
import { packDb } from "../offline/testFixture";
import type { LitePack } from "../packs";
import type { LiteLearned } from "../../shared/liteLearned";
import { readPackFacts } from "./forecaster";

export const S = 2025, CODE = "USNJQ5";
const TEAMS = [101, 102, 103, 104, 105, 106, 107, 108];
const bonus = (movement: boolean, goal: boolean, pattern: boolean): string => JSON.stringify({ movement, goal, pattern } satisfies BonusFlags);
const matchRow = (n: number, played: boolean, red: number, blue: number, redBonus: string | null = null) => ({
  season: S, code: CODE, level: "qual", series: 0, number: n, label: `Q${n}`, description: `Q${n}`, time: `2025-11-08T09:${String(n * 7).padStart(2, "0")}:00`, played: played ? 1 : 0,
  ...(played ? { red_total: red, red_np: red, red_auto: 20, red_teleop: red - 40, red_endgame: 20, red_pen: 0, red_bonus: redBonus, blue_total: blue, blue_np: blue, blue_auto: 15, blue_teleop: blue - 35, blue_endgame: 20, blue_pen: 0, blue_bonus: null } : {}),
  source: "first",
});
const lineup = (n: number, red: number[], blue: number[]) => [...red.map((t, i) => ({ t, a: "red", s: i + 1 })), ...blue.map((t, i) => ({ t, a: "blue", s: i + 1 }))]
  .map(({ t, a, s }) => ({ season: S, code: CODE, level: "qual", series: 0, number: n, team: t, alliance: a, station: s, surrogate: 0, dq: 0, on_field: 1 }));

export async function seasonPack(): Promise<SeasonDb> {
  const db = await packDb(S, {
    teams: TEAMS.map((n) => ({ number: n, name: `Team ${n}` })),
    events: [{ season: S, code: CODE, name: "NJ Qualifier 5", type: "Qualifier", region: "USNJ", city: "Edison", state: "NJ", country: "USA", start: "2025-11-08", end: "2025-11-08", timezone: "America/New_York", remote: 0, source: "first" }],
    event_teams: TEAMS.map((t) => ({ season: S, code: CODE, team: t })),
    matches: [matchRow(1, true, 120, 80, bonus(true, false, true)), matchRow(2, true, 90, 110), matchRow(3, false, 0, 0), matchRow(4, false, 0, 0)],
    match_teams: [...lineup(1, [101, 102], [103, 104]), ...lineup(2, [105, 106], [107, 108]), ...lineup(3, [101, 103], [105, 107]), ...lineup(4, [102, 104], [106, 108])],
    advancement: [{ season: S, code: CODE, slots: 3, advances_to: "USNJCMP", rows: JSON.stringify([{ team: 104, status: "ALREADY_ADVANCING", declined: false }, { team: 108, status: "INELIGIBLE", declined: false }]) }],
  });
  return { season: S, db: wrap(db) };
}

export const book = () => { const b = new RatingBook(FITTED_MODEL.rating); b.startSeason(S); return b; };
export const lite = (version = "v1", learned?: LiteLearned): LitePack => ({ format: 1, version, builtAt: "2025-11-08T09:30:00Z", engineVersion: "x", books: { [S]: book().toData() }, teams: [], ...(learned ? { learned } : {}) });
export const detail = (sdb: SeasonDb) => readEventDetail(sdb, CODE)!;
export const deps = (sdb: SeasonDb, o: { version?: string; packVersion?: string; learned?: LiteLearned } = {}) => ({
  lite: async () => lite(o.version, o.learned),
  facts: async () => ({ facts: readPackFacts(sdb.db, S, CODE), version: o.packVersion ?? "v1" }),
  now: Date.parse("2025-11-08T12:00:00Z"),
});
