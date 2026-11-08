// An event said by its own name with words search reads apart: a kind of event none of its events is ("bergen
// qualifier", failed-search #793) and a tab of a division named without its championship ("jackson division finals",
// failed-search #781). Held out: other names, kinds and tabs.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";

const S = CURRENT_SEASON;
const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev = (code: string, name: string, type: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, 'Town', 'NJ', 'USA', ?, ?, 't')", [S, code, name, type, division, `${S + 1}-02-01`, `${S + 1}-02-01`]);
  await ev("USNJWTLT", "NJ Westfield Willow Conference Tournament", "LeagueTournament");
  await ev("USNJWTM1", "NJ Westfield Willow Conference Meet 1", "LeagueMeet");
  await ev("USNJCMP", "New Jersey Championship", "Championship");
  await ev("USNJCMPMPLE", "New Jersey Championship - Maple Division", "Championship", "USNJCMP");
  // The season before: the championship had other divisions, none named Maple.
  for (const [code, name, division] of [["USNJCMP", "New Jersey Championship", null], ["USNJCMPOAK", "New Jersey Championship - Oak Division", "USNJCMP"], ["USNJCMPELM", "New Jersey Championship - Elm Division", "USNJCMP"]] as const)
    await run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, 'Championship', ?, 'Town', 'NJ', 'USA', ?, ?, 't')", [S - 1, code, name, division, `${S}-02-01`, `${S}-02-01`]);
  await rebuildSearch();
});

describe("an event by its own name", () => {
  it("a kind none of its events is: the events by the name, said so", async () => {
    const a = await ask("willow qualifier");
    expect(a.understood?.label).toBe('No qualifier named "willow": events matching "willow"');
    expect(a.hits.map((h) => h.ref).sort()).toEqual([`${S}:USNJWTLT`, `${S}:USNJWTM1`]);
  });
  it("a division's tab, the division named without its championship", async () => {
    for (const [q, tab] of [["maple division finals", "Playoffs"], ["maple division rankings", "Rankings"]] as const) {
      const a = await ask(q);
      expect(a.understood?.label, q).toBe(`${tab} · New Jersey Championship - Maple Division (${S}–${String(S + 1).slice(2)})`);
    }
  });
  it("a division named with a season it wasn't held in: said so, with that season's divisions and its own season's", async () => {
    const before = `${S - 1}-${String(S).slice(2)}`;
    const a = await ask(`maple division finals ${before}`);
    expect(a.understood?.label).toBe(`No Maple Division in ${S - 1}–${String(S).slice(2)}: it was held in ${S}–${String(S + 1).slice(2)}. ${S - 1}–${String(S).slice(2)}'s divisions: Elm Division, Oak Division`);
    // (Search lists the divisions' championship beside them, as with any division.)
    const refs = a.hits.map((h) => [h.ref, h.section]);
    expect(refs.slice(0, 2)).toEqual([[`${S - 1}:USNJCMPELM`, "playoffs"], [`${S - 1}:USNJCMPOAK`, "playoffs"]]);
    expect(refs).toContainEqual([`${S}:USNJCMPMPLE`, "playoffs"]);
  });
});
