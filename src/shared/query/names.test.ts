// The place index (./names.ts): a town stored as its own state's code is the state, never a town.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";

// Rows as the data has them: a team whose town was entered as its state's code ("IN", Indiana), beside real towns,
// one of them named as its state is ("New York", New York).
const names = buildNames([
  { number: 1, name: "Code Town", city: "IN", state: "IN", country: "USA" },
  { number: 2, name: "Hoosiers", city: "Indianapolis", state: "IN", country: "USA" },
  { number: 3, name: "Springers", city: "Springfield", state: "IL", country: "USA" },
  { number: 4, name: "Big Apple", city: "New York", state: "NY", country: "USA" },
  // A real town named as its region's code, where the index names no such region.
  { number: 5, name: "Fassi", city: "Fes", state: "FES", country: "Morocco" },
], []);

describe("a town stored as its state's code", () => {
  it("is the state: \"in Indiana\" is Indiana, named in full, never a town called IN", () => {
    expect(names.place("in indiana", "in Indiana")).toBeNull();
    expect(names.place("indiana", "Indiana")).toMatchObject({ kind: "region", country: "USA", state: "IN", name: "Indiana" });
    // The code typed in capitals is the state too, its chip the state's name.
    expect(names.place("in", "IN")).toMatchObject({ kind: "region", state: "IN", name: "Indiana" });
  });
  it("leaves real towns as they were, with their state after them or not", () => {
    expect(names.place("indianapolis", "Indianapolis")).toMatchObject({ kind: "city", state: "IN", name: "Indianapolis" });
    expect(names.place("springfield il", "springfield IL")).toMatchObject({ kind: "city", state: "IL", name: "Springfield" });
    expect(names.place("new york ny", "new york NY")).toMatchObject({ kind: "city", state: "NY", name: "New York" });
    expect(names.place("fes", "Fes")).toMatchObject({ kind: "city", country: "Morocco", name: "Fes" });
  });
});
