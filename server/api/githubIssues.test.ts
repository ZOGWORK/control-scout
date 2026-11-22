import { beforeAll, it, expect } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON as S } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { parseIntent } from "./searchIntents";

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  await run("INSERT INTO teams (number,name,city,state,country) VALUES (4215,'Hypnotic Robotics','Town','NJ','USA'),(26000,'Theseus','Brisbane','QLD','Australia')");
  for (const [code, name, type] of [["Q1", "Seneca Valley Qualifier", "Qualifier"], ["SCR", "Longhorn Roundup Scrimmage", "Scrimmage"]])
    await run("INSERT INTO events (season,code,name,type,city,state,country,start,source) VALUES (?,?,?,?, 'Town','NJ','USA',?,'test')", [S, code, name, type, `${S}-11-01`]);
  await run("INSERT INTO team_seasons (season,team) VALUES (?,4215),(?,26000)", [S,S]);
  await run("INSERT INTO matches (season,code,level,series,number,label,played,red_total,red_np,blue_total,blue_np,source) VALUES (?, 'Q1','qual',0,1,'Q1',1,100,100,80,80,'test')", [S]);
  await rebuildSearch();
});

const ask = (q: string) => searchAnswer(q, { limit: 40, full: true, learn: false });

it("does not turn ordinary lowercase words into state codes (Loopy review)", () => {
  for (const q of ["teams around me", "events in or", "rank in hi"])
    expect(parseIntent(q)?.region).toBeFalsy();
  expect(parseIntent("4215 ranking in nj state")?.region?.state).toBe("NJ");
});

it("finds a named event with a game season and no event-kind word (#2021)", async () => {
  expect((await ask("seneca valley bio buzz")).hits.map(h => h.ref)).toContain(`${S}:Q1`);
});
it("finds an exact event name with different word boundaries (#2017, #1165)", async () => {
  expect((await ask("long horn round up scrimmage")).hits.map(h => h.ref)).toContain(`${S}:SCR`);
  expect((await ask("long horn round up scrimmage videos")).stat?.intent).toBe("scope-highlights");
  expect((await ask("long horn other scrimmage")).hits).toEqual([]);
});
it("keeps singular state rankings separate from championship results (#2015)", async () => {
  const a = await ask("4215 ranking in nj state");
  expect(a.stat?.intent).not.toBe("event-rank");
  expect(a.hits.map(h => h.ref)).toContain("USA:NJ");
  expect((await ask("4215 ranking at nj states")).stat?.intent).toBe("event-rank");
});
it("answers conversational Worlds counts instead of falling back to a team (#2019)", async () => {
  expect((await ask("did hypnotic ever go to worlds like twice")).card?.kind).toBe("worlds");
});
it("keeps requests for videos focused on recordings rather than record scores (#1997)", async () => {
  const a = await ask("bio buzz videos");
  expect(a.stat?.title).toBe(`Match videos, ${S}–${String(S+1).slice(2)}`);
  expect(a.stat?.headline).toBeUndefined();
  expect(a.stat?.blocks.some(b => b.kind === "matches")).toBe(false);
});
