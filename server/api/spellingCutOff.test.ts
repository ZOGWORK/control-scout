// A query's last short word dropped as cut off mid-word ("… whe") is never a word of everyday English: "qualifiers in
// june" keeps its month, even with a place named Pune that "june" is one letter off (Loopy on #2249).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { cutOff } from "./spelling";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (31101, 'Deccan Bots', 'Pune', 'MH', 'India')");
});

describe("a query cut off mid-word", () => {
  it("keeps a last word of everyday English", async () => {
    expect(await cutOff("qualifiers in june")).toBeNull();
  });
  it("still drops a stray short word no one knows", async () => {
    expect(await cutOff("qualifiers in jxq")).toBe("qualifiers in");
  });
});
