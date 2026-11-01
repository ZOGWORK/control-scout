// @vitest-environment jsdom
// Bruno's written answer on /search (./BrunoAnswer.tsx): asked once a question settles and the results are in,
// shown labelled as his while he writes and after; nothing for a name or a number, with the switch off, or when he
// has no answer; an older question's answer never shows for a newer one.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
const flags = { brunoAnswers: true };
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: (n: keyof typeof flags) => flags[n] }));

const { BrunoAnswer, BRUNO_SETTLE_MS } = await import("./BrunoAnswer");

const Q = "how many times did 4215 go to states";
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); flags.brunoAnswers = true; });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); });
const settle = () => act(async () => { vi.advanceTimersByTime(BRUNO_SETTLE_MS + 5); });
const answer = (text: string | null) => act(async () => { pending.shift()!.resolve(text ? { text } : null); });

describe("Bruno's answer on /search", () => {
  it("asks once the question settles and the results are in, then shows his answer, labelled", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} ready={false} />);
    await settle();
    expect(pending).toHaveLength(0);
    rerender(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(pending.map((p) => p.url)).toEqual([`/api/search/bruno?q=${encodeURIComponent(Q)}`]);
    expect(screen.getByRole("note", { name: "Bruno AI's answer" }).getAttribute("aria-busy")).toBe("true");
    await answer("Hypnotic Robotics (4215) went to states 3 times since 2023–24.");
    const note = screen.getByRole("note", { name: "Bruno AI's answer" });
    expect(note.textContent).toContain("Bruno AI");
    expect(note.textContent).toContain("went to states 3 times since 2023–24.");
    expect(note.textContent).toContain("Written by Bruno AI from the records below");
  });
  it("asks with the page's own preferred teams", async () => {
    render(<BrunoAnswer q={Q} prefer="team:4215,team:6980" ready />);
    await settle();
    expect(pending[0].url).toBe(`/api/search/bruno?q=${encodeURIComponent(Q)}&prefer=${encodeURIComponent("team:4215,team:6980")}`);
  });
  it("shows nothing when he has no answer", async () => {
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await answer(null);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("never asks for a name or a number, or with the switch off", async () => {
    const { rerender } = render(<BrunoAnswer q="4215" ready />);
    await settle();
    rerender(<BrunoAnswer q="hypnotic opr" ready />);
    await settle();
    flags.brunoAnswers = false;
    rerender(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(pending).toHaveLength(0);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("an older question's answer never shows under a newer one", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} ready />);
    await settle();
    const first = pending.shift()!;
    rerender(<BrunoAnswer q="when did 23268 go to worlds" ready />);
    await act(async () => { first.resolve({ text: "Old answer." }); });
    expect(screen.queryByText("Old answer.")).toBeNull();
    await settle();
    await answer("Ultraviolet (23268) went to Worlds 2 times.");
    expect(screen.getByText("Ultraviolet (23268) went to Worlds 2 times.")).toBeTruthy();
  });
});
