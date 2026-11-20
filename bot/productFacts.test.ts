import { expect, it } from "vitest";
import { productFacts } from "./productFacts";
import { ungrounded } from "../server/api/searchBrunoAnswer";

it("grounds the completed remodel and Dog Mode without claiming it is on", () => {
  const facts = productFacts(false);
  expect(facts.join(" ")).toContain("remodel is complete");
  expect(facts.join(" ")).toContain("yellow/gold");
  expect(facts.join(" ")).toContain("multiple angled streams");
  expect(facts.at(-1)).toContain("currently disabled globally");
  expect(ungrounded("The v8 remodel is complete. Dog Mode exists but is disabled.", facts, "what changed?")).toEqual([]);
});
it("reports the live flag, and does not turn a failed flag read into a status claim", () => {
  expect(productFacts(true).at(-1)).toContain("currently enabled globally");
  expect(productFacts(null).at(-1)).toContain("could not be read");
});
