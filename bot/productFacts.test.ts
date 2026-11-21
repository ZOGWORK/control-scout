import { expect, it } from "vitest";
import { productFacts, zogModeReply } from "./productFacts";
import { ungrounded } from "../server/api/searchBrunoAnswer";

it("grounds the completed remodel and available Zog Mode without claiming its background is on", () => {
  const facts = productFacts();
  expect(facts.join(" ")).toContain("remodel is complete");
  expect(facts.join(" ")).toContain("yellow/gold");
  expect(facts.join(" ")).toContain("multiple angled streams");
  expect(facts.join(" ")).toContain("existing, available");
  expect(facts.join(" ")).not.toMatch(/currently (?:enabled|disabled)|Dog Mode/);
  expect(facts.join(" ")).not.toMatch(/owner|console|dogTheme/i);
  expect(ungrounded("The v8 remodel is complete. Zog Mode exists and is available.", facts, "what changed?")).toEqual([]);
});
it("recognizes the screenshot's question but leaves actual dog-named teams to search", () => {
  expect(zogModeReply("where is the dog")).toContain("Zog Mode");
  expect(zogModeReply("turn on zog mode")).toContain("Zog Mode exists");
  expect(zogModeReply("turn on zog mode")).not.toMatch(/owner|console|flag|settings|enabled|disabled|turned on/i);
  expect(zogModeReply("Sea Dog Robotics scores")).toBeNull();
  expect(zogModeReply("team zog rankings")).toBeNull();
  expect(zogModeReply("zog 1234")).toBeNull();
  expect(zogModeReply("who is zog")).toBeNull();
  expect(zogModeReply("zog stats")).toBeNull();
});
