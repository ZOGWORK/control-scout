import { expect, it, vi } from "vitest";
import { ask, realAskDeps } from "./ask";

const state = vi.hoisted(() => ({ dog: false, chat: vi.fn(async () => ({ text: "The v8 remodel is complete. Dog Mode exists.", search: false })) }));
vi.mock("../server/flags", () => ({ isEnabled: async (flag: string) => flag === "dogTheme" ? state.dog : true }));
vi.mock("../server/auth/controlPoint", () => ({ brunoAvailable: () => true, brunoDiscordChat: state.chat }));

it("sends current product knowledge with Discord chats, reserving room beside search records and grounding v8", async () => {
  const deps = await realAskDeps();
  const facts = Array.from({ length: 40 }, (_, n) => `Search record ${n}: ${"x".repeat(200)}`);
  const reply = await deps.chat!("what changed in Control Scout?", facts, []);
  expect(reply?.text).toContain("v8 remodel is complete");
  const context = state.chat.mock.calls[0] as unknown as [string, string[]];
  expect(context[1].join(" ")).toContain("remodel is complete");
  expect(context[1].join(" ")).toContain("currently disabled globally");
  expect(context[1].join(" ")).toContain("Search record 0");
  expect(context[1].length).toBeLessThanOrEqual(40);
  expect(context[1].join("\n").length).toBeLessThan(8000);
  state.dog = true;
  await deps.chat!("is Dog Mode enabled?", [], []);
  const enabled = state.chat.mock.calls[1] as unknown as [string, string[]];
  expect(enabled[1].join(" ")).toContain("currently enabled globally");

  // Exercise the outer ask/chatWith fit too: the real chat must still trim the
  // already-fitted search facts against the smaller product-reserved budget.
  await ask("what changed?", {
    ...deps,
    search: async (q) => ({ q, hits: [], pages: [], step: "deterministic", weak: false }),
    facts: async () => facts,
  }, "https://controlscout.org");
  const throughAsk = state.chat.mock.calls[2] as unknown as [string, string[]];
  expect(throughAsk[1].length).toBeLessThanOrEqual(40);
  expect(throughAsk[1].join("\n").length).toBeLessThan(7500);
  expect(throughAsk[1].join(" ")).toContain("remodel is complete");
  expect(throughAsk[1].join(" ")).toContain("Search record 0");
});
