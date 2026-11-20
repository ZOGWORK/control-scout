import { beforeAll, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { highlightsAnswer } from "./highlights";
import { clearAllCaches } from "../../caches";

beforeAll(async () => {
  setDb(openDb(":memory:"));
  await migrate();
  await run("INSERT INTO events (season,code,name,type,country,state,start,source) VALUES (2026,'A','Recorded Qualifier','Qualifier','USA','NJ','2026-11-01','t'),(2026,'B','Other Qualifier','Qualifier','USA','TX','2026-11-01','t')");
  await run(`WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<4001)
    INSERT INTO matches (season,code,level,series,number,label,played,red_total,red_np,blue_total,blue_np,video,source)
    SELECT 2026,'A','qual',0,n,'Q'||n,1,100,100,80,80,CASE WHEN n=4001 THEN 'https://youtu.be/abcdefghijk' ELSE NULL END,'t' FROM nums`);
  await run("INSERT INTO matches (season,code,level,series,number,label,played,red_total,red_np,blue_total,blue_np,video,source) VALUES (2026,'B','qual',0,1,'Q1',1,100,100,80,80,'https://youtu.be/zyxwvutsrqp','t')");
  await run("INSERT INTO events (season,code,name,type,country,state,start,source) VALUES (2026,'C','Many Clips Qualifier','Qualifier','USA','NJ','2026-11-02','t')");
  await run(`WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<201)
    INSERT INTO matches (season,code,level,series,number,label,played,red_total,red_np,blue_total,blue_np,video,source)
    SELECT 2026,'C','qual',0,n,'Q'||n,1,100,100,80,80,'https://youtu.be/abcdefghijk','t' FROM nums`);
  clearAllCaches();
});

it("bounds a large recorded gallery and says that more videos exist", async () => {
  const a = await highlightsAnswer({ season: 2026, at: "", chips: [], videos: true, kind: null, region: null, level: null, finals: false, events: [{season:2026,code:"C"}] });
  const gallery = a.blocks.find(b => b.kind === "videos");
  expect(gallery?.kind).toBe("videos");
  if (gallery?.kind !== "videos") return;
  expect(gallery.tiles).toHaveLength(200);
  expect(gallery.more).toContain("first 200 matches with video");
  expect(gallery.tiles.every(t => t.href.startsWith("/events/2026/C?"))).toBe(true);
});

it("shows recorded qualification videos even above the whole-season read threshold (#1997)", async () => {
  const a = await highlightsAnswer({ season: 2026, at: "", chips: [], videos: true, kind: null, region: null, level: null, finals: false, events: [{season:2026,code:"A"}] });
  const gallery = a.blocks.find(b => b.kind === "videos");
  expect(gallery?.kind).toBe("videos");
  if (gallery?.kind !== "videos") return;
  expect(gallery.tiles.map(t => t.href)).toEqual(["/events/2026/A?match=qual:0:4001"]);
  expect(gallery.more).toBeUndefined();
  expect(a.headline).toBeUndefined();
});
