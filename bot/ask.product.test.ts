import { expect, it, vi } from "vitest";
import { ask, realAskDeps } from "./ask";

const state = vi.hoisted(() => ({ flag: vi.fn(async () => true), chat: vi.fn(async () => ({ text: "The v8 remodel is complete. Zog Mode exists.", search: false })) }));
vi.mock("../server/flags", () => ({ isEnabled: state.flag }));
vi.mock("../server/auth/controlPoint", () => ({ brunoAvailable: () => true, brunoDiscordChat: state.chat }));

it("sends current product knowledge with Discord chats, reserving room beside search records and grounding v8", async () => {
  const deps = await realAskDeps();
  const facts = Array.from({ length: 40 }, (_, n) => `Search record ${n}: ${"x".repeat(200)}`);
  const reply = await deps.chat!("what changed in Control Scout?", facts, []);
  expect(reply?.text).toContain("v8 remodel is complete");
  const context = state.chat.mock.calls[0] as unknown as [string, string[]];
  expect(context[1].join(" ")).toContain("remodel is complete");
  expect(context[1].join(" ")).toContain("existing, available");
  // How to shape the answer goes with the facts: records short, how/why in paragraphs or bullets, a build guide in steps.
  expect(context[1].join(" ")).toContain("Shapes: records gets the number");
  expect(context[1].join(" ")).toContain("'- ' bullets");
  expect(context[1].join(" ")).toContain("Search record 0");
  expect(context[1].length).toBeLessThanOrEqual(40);
  expect(context[1].join("\n").length).toBeLessThan(8000);
  // Control Point refuses a packet with a fact over 400 characters: every line, product facts included, is under it.
  expect(context[1].every((f) => f.length <= 400)).toBe(true);

  // What the server has taught the bot rides with the facts too (bot/memory.ts), inside the same caps.
  await deps.chat!("what was our auto OPR?", facts, [], ["This server asks about teams 4215, 6980 most: when a question doesn't name a team, it means one of these, and say which one you picked.", "The person asking goes by Alex here."]);
  const withMemory = state.chat.mock.calls.at(-1) as unknown as [string, string[]];
  expect(withMemory[1].join(" ")).toContain("teams 4215, 6980");
  expect(withMemory[1].join(" ")).toContain("Alex here");
  expect(withMemory[1].join(" ")).toContain("Shapes: records gets the number");
  expect(withMemory[1].length).toBeLessThanOrEqual(40);
  expect(withMemory[1].join("\n").length).toBeLessThan(8000);
  expect(withMemory[1].every((f) => f.length <= 400)).toBe(true);
  expect(state.flag.mock.calls.every((args) => (args as unknown as string[])[0] === "discordBruno")).toBe(true);

  // Exercise the outer ask/chatWith fit too: the real chat must still trim the
  // already-fitted search facts against the smaller product-reserved budget.
  await ask("what changed?", {
    ...deps,
    search: async (q) => ({ q, hits: [], pages: [], step: "deterministic", weak: false }),
    facts: async () => facts,
  }, "https://controlscout.org");
  const throughAsk = state.chat.mock.calls[1] as unknown as [string, string[]];
  expect(throughAsk[1].length).toBeLessThanOrEqual(40);
  expect(throughAsk[1].join("\n").length).toBeLessThan(7500);
  expect(throughAsk[1].join(" ")).toContain("remodel is complete");
  expect(throughAsk[1].join(" ")).toContain("Search record 0");
});

it("a structured explanation of a few paragraphs is posted as he wrote it: bold, bullets, paragraphs", async () => {
  const text = [
    "**A coaxial swerve keeps both drive motors on one axis.**",
    "",
    "The wheel's turning effort stays on the module's pivot, so it can drive and steer at once.",
    "- **Coaxial**: both motors and gears share a shaft.",
    "- **Offset**: the motors sit beside the pivot, so the module is wider.",
  ].join("\n");
  const deps = await realAskDeps();
  const answer = state.chat.getMockImplementation()!;
  try {
    state.chat.mockImplementation(async () => ({ text, search: false }));
    const reply = await ask("explain a coaxial swerve", { ...deps, facts: async () => [], search: async (q) => ({ q, hits: [], pages: [], step: "deterministic", weak: false }) }, "https://controlscout.org");
    // Kept whole: a longer answer isn't trimmed to a sentence on the way out.
    expect(reply.chat?.text).toBe(text);
  } finally { state.chat.mockImplementation(answer); }
});

it("a reply with a number the facts don't have is reported, not thrown away here: ask decides whether it could be a record", async () => {
  // The screenshot's "coxial suspension swerve explain": an explanation's own numbers ("1:1") must not cost the answer.
  const deps = await realAskDeps();
  const answer = state.chat.getMockImplementation()!;
  try {
    state.chat.mockImplementation(async () => ({ text: "A coaxial swerve often runs 1:1.", search: false }));
    const reply = await deps.chat!("coxial suspension swerve explain", [], []);
    expect(reply?.text).toContain("1:1");
    expect(reply?.unknown).toEqual(["1", "1"]); // both sides of "1:1"
  } finally { state.chat.mockImplementation(answer); }
});

it("says why a chat didn't happen, so a deployment is diagnosed from the bot's log", async () => {
  const deps = await realAskDeps();
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const answer = state.chat.getMockImplementation()!;
  try {
    state.chat.mockImplementation(async () => { throw Object.assign(new Error("Control Point answered 400"), { status: 400 }); });
    expect(await deps.chat!("hi", [], [])).toBeNull();
    expect(info.mock.calls.flat().join(" ")).toContain("[bot] chat failed: Control Point answered 400");

    state.chat.mockImplementation(answer);
    state.flag.mockResolvedValueOnce(false);
    expect(await deps.chat!("hi", [], [])).toBeNull();
    expect(info.mock.calls.flat().join(" ")).toContain("[bot] chat off: the discordBruno switch is off");
  } finally { state.chat.mockImplementation(answer); info.mockRestore(); }
});

it("answers Zog Mode requests as read-only product information without searching teams or calling AI", async () => {
  const deps = await realAskDeps();
  const search = vi.fn(deps.search), chat = vi.fn(deps.chat!);
  for (const q of ["where is the dog", "what is zog mode", "enable dog mode", "disable zog mode"]) {
    const reply = await ask(q, { ...deps, search, chat }, "https://controlscout.org");
    expect(reply.embed.title).toBe("Zog Mode");
    expect(reply.embed.description).toContain("Zog Mode exists!");
    expect(reply.embed.description).not.toMatch(/owner|console|flag|settings/i);
    expect(reply.embed.description).not.toMatch(/is disabled|turned (?:on|off)/);
  }
  expect(search).not.toHaveBeenCalled();
  expect(chat).not.toHaveBeenCalled();
});
