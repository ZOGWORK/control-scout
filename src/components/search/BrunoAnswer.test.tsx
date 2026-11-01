// @vitest-environment jsdom
// Bruno's written answer on /search (./BrunoAnswer.tsx): asked once a question settles and the results are in,
// shown labelled as his while he writes and after; nothing for a name or a number, with the switch off, or when he
// has no answer; an older question's answer never shows for a newer one.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
// The streamed ask (lib/brunoStream): "fail" breaks at once (the plain ask takes over, as every older test expects);
// "hold" keeps it open for the test to stream parts into, finish, or break.
type Part = { text: string; points?: string[] } | null;
const streams: { url: string; part: (p: Part) => void; resolve: (v: Part) => void; reject: (e: Error) => void }[] = [];
let streamMode: "fail" | "hold" = "fail";
vi.mock("../../lib/brunoStream", () => ({
  streamBrunoAnswer: (url: string, part: (p: Part) => void) => streamMode === "fail"
    ? Promise.reject(new Error("no stream"))
    : new Promise((resolve, reject) => streams.push({ url, part, resolve, reject })),
}));
const flags = { brunoAnswers: true };
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: (n: keyof typeof flags) => flags[n] }));

const { BrunoAnswer, BRUNO_SETTLE_MS } = await import("./BrunoAnswer");

const Q = "how many times did 4215 go to states";
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); flags.brunoAnswers = true; });
afterEach(() => { cleanup(); pending.length = 0; streams.length = 0; streamMode = "fail"; vi.useRealTimers(); });
const settle = () => act(async () => { vi.advanceTimersByTime(BRUNO_SETTLE_MS + 5); });
const answer = (text: string | null, points?: string[]) => act(async () => { pending.shift()!.resolve(text ? { text, points } : null); });

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
  it("shows his points as a bulleted list under the sentence", async () => {
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await answer("Hypnotic Robotics (4215) went to states 2 times since 2023–24.", ["2023–24: ranked #3, OPR 111.5", "2024–25: ranked #7"]);
    const items = screen.getByRole("note", { name: "Bruno AI's answer" }).querySelectorAll("ul > li");
    expect([...items].map((li) => li.textContent)).toEqual(["2023–24: ranked #3, OPR 111.5", "2024–25: ranked #7"]);
  });
  it("asks with the page's own preferred teams", async () => {
    render(<BrunoAnswer q={Q} prefer="team:4215,team:6980" ready />);
    await settle();
    expect(pending[0].url).toBe(`/api/search/bruno?q=${encodeURIComponent(Q)}&prefer=${encodeURIComponent("team:4215,team:6980")}`);
  });
  it("an answer read with other preferred teams never shows under new ones", async () => {
    const { rerender } = render(<BrunoAnswer q={Q} prefer="team:4215" ready />);
    await settle();
    await answer("Hypnotic Robotics (4215) went to states 3 times.");
    rerender(<BrunoAnswer q={Q} prefer="team:6980" ready />);
    expect(screen.queryByRole("note")).toBeNull();
    await settle();
    expect(pending[0].url).toContain(encodeURIComponent("team:6980"));
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

describe("streamed as he writes", () => {
  const note = () => screen.getByRole("note", { name: "Bruno AI's answer" });
  const part = (p: Part) => act(async () => { streams[0].part(p); });
  it("shows each part as it comes, busy, and ends at his answer with its label", async () => {
    streamMode = "hold";
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    expect(streams[0].url).toBe(`/api/search/bruno?q=${encodeURIComponent(Q)}&stream=1`);
    await part({ text: "Hypnotic Robotics (4215) went to", points: [] });
    expect(note().textContent).toContain("Hypnotic Robotics (4215) went to");
    expect(note().getAttribute("aria-busy")).toBe("true");
    expect(note().textContent).not.toContain("Written by Bruno AI");
    await part({ text: "Hypnotic Robotics (4215) went to states 2 times.", points: ["2023–24: ranked #3"] });
    expect(note().querySelectorAll("ul > li")).toHaveLength(1);
    await act(async () => { streams[0].resolve({ text: "Hypnotic Robotics (4215) went to states 2 times.", points: ["2023–24: ranked #3", "2024–25: ranked #7"] }); });
    expect(note().getAttribute("aria-busy")).toBeNull();
    expect(note().querySelectorAll("ul > li")).toHaveLength(2);
    expect(note().textContent).toContain("Written by Bruno AI");
    expect(pending).toHaveLength(0);
  });
  it("a part withdrawn (it failed the check) goes back to waiting", async () => {
    streamMode = "hold";
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await part({ text: "Hypnotic Robotics went to states", points: [] });
    await part(null);
    expect(note().textContent).not.toContain("Hypnotic Robotics");
    await act(async () => { streams[0].resolve(null); });
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("a stream that breaks part-way keeps what's shown, asks the plain way, and shows his answer once", async () => {
    streamMode = "hold";
    render(<BrunoAnswer q={Q} ready />);
    await settle();
    await part({ text: "Hypnotic Robotics (4215) went", points: [] });
    await act(async () => { streams[0].reject(new Error("stream ended early")); });
    expect(pending.map((p) => p.url)).toEqual([`/api/search/bruno?q=${encodeURIComponent(Q)}`]);
    expect(note().textContent).toContain("Hypnotic Robotics (4215) went");
    await answer("Hypnotic Robotics (4215) went to states 2 times.");
    expect(note().querySelectorAll("p.font-medium")).toHaveLength(1);
    expect(note().textContent!.match(/Hypnotic Robotics/g)).toHaveLength(1);
    expect(note().textContent).toContain("went to states 2 times.");
  });
  it("a newer question drops the older stream's parts", async () => {
    streamMode = "hold";
    const { rerender } = render(<BrunoAnswer q={Q} ready />);
    await settle();
    const first = streams.shift()!;
    rerender(<BrunoAnswer q="when did 23268 go to worlds" ready />);
    await act(async () => { first.part({ text: "Old part", points: [] }); first.resolve({ text: "Old answer." }); });
    expect(screen.queryByText("Old part")).toBeNull();
    expect(screen.queryByText("Old answer.")).toBeNull();
  });
});
