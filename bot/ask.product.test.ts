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
  expect(context[1].join(" ")).toContain("Search record 0");
  expect(context[1].length).toBeLessThanOrEqual(40);
  expect(context[1].join("\n").length).toBeLessThan(8000);
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

it("answers Zog Mode requests as read-only product information without searching teams or calling AI", async () => {
  const deps = await realAskDeps();
  const search = vi.fn(deps.search), chat = vi.fn(deps.chat!);
  for (const q of ["where is the dog", "what is zog mode", "enable dog mode", "disable zog mode"]) {
    const reply = await ask(q, { ...deps, search, chat }, "https://controlscout.org");
    expect(reply.embed.title).toBe("Zog Mode");
    expect(reply.embed.description).toContain("available");
    expect(reply.embed.description).toContain("Discord users cannot turn it on or off");
    expect(reply.embed.description).not.toMatch(/is disabled|turned (?:on|off)/);
  }
  expect(search).not.toHaveBeenCalled();
  expect(chat).not.toHaveBeenCalled();
});
