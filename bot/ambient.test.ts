// The ambient ask channel (bot/ambient.ts) and the first-run welcome (bot/welcome.ts): a channel name is the opt-in,
// case and spaces don't matter, and the welcome says the three things a new server should do.
import { describe, expect, it } from "vitest";
import { ASK_CHANNEL, isAskChannel } from "./ambient";
import { welcomeEmbed } from "./welcome";

describe("the ask channel", () => {
  it("is one channel name, matched however it is capitalised or spaced", () => {
    expect(ASK_CHANNEL).toBe("ask-control-scout");
    expect(isAskChannel({ name: "ask-control-scout" })).toBe(true);
    expect(isAskChannel({ name: "  Ask-Control-Scout " })).toBe(true);
    expect(isAskChannel({ name: "control-scout-ask" })).toBe(false);
    expect(isAskChannel({ name: "general" })).toBe(false);
    expect(isAskChannel(null)).toBe(false);
  });
});

describe("the welcome", () => {
  it("names the follow, the ask channel and the privacy line, in one short embed", () => {
    const e = welcomeEmbed();
    expect(e.title).toBe("Control Scout is here");
    expect(e.description).toContain("/follow team:4215 channel:#scouting");
    expect(e.description).toContain("#ask-control-scout");
    expect(e.description).toContain("/help");
    expect(e.description).toMatch(/read only messages that mention me/);
    // Short enough to read in a channel, not a manual.
    expect(e.description!.length).toBeLessThan(1_200);
    expect(e.fields).toBeUndefined();
  });
});
